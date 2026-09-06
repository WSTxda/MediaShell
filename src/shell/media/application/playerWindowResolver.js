/**
 * @file playerWindowResolver.js
 * @module shell.media.application.playerWindowResolver
 *
 * Resolves an MPRIS Chromium-PWA endpoint to a currently running Shell window.
 *
 * Exact Shell.App association is preferred. A bounded asynchronous D-Bus PID
 * lookup is only a fallback when Shell has not associated the PWA window yet.
 * PID narrows the candidate set but never establishes identity by itself: the
 * final match still requires the same structural PWA app ID used by MediaShell's
 * desktop identity resolver. Owner generations reject stale asynchronous work.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Shell from "gi://Shell";

import { resolveChromiumPwaAppId } from "../../../shared/identity/browser.js";
import { createLogger } from "../../../shared/logging/logger.js";
import { isCancellationError } from "../../platform/gioErrors.js";
import { DBusDaemonMethods } from "../../mpris/dbus.js";
import {
  readAppStringSafely,
  readDesktopAppDescriptor,
} from "../identity/appInfo.js";
import {
  PlayerWindowEvidence,
  chooseRecentPwaWindowCandidate,
  resolvePwaWindowEvidence,
} from "./windowIdentity.js";

Gio._promisify(Gio.DBusProxy.prototype, "call", "call_finish");

const DBUS_PROCESS_ID_TIMEOUT_MS = 1000;
const logger = createLogger("PlayerWindowResolver");

function createPlayerMediaIdentity(player) {
  return {
    identity: player?.identity,
    desktopEntry: player?.desktopEntry,
    busName: player?.busName,
  };
}

function readWindowStringSafely(window, getterName) {
  try {
    return String(window?.[getterName]?.() ?? "");
  } catch (error) {
    logger.debugOnce(
      `window:${getterName}`,
      `Window metadata ${getterName} became unavailable during lookup`,
      error,
    );
    return "";
  }
}

function readWindowNumberSafely(window, getterName) {
  try {
    const value = Number(window?.[getterName]?.());
    return Number.isFinite(value) ? value : 0;
  } catch (error) {
    logger.debugOnce(
      `window:${getterName}`,
      `Window metadata ${getterName} became unavailable during lookup`,
      error,
    );
    return 0;
  }
}

function readMetaWindow(windowActor) {
  try {
    return (
      windowActor?.meta_window ??
      windowActor?.metaWindow ??
      windowActor?.get_meta_window?.() ??
      null
    );
  } catch (error) {
    logger.debugOnce(
      "window-actor",
      "A Shell window actor became unavailable during lookup",
      error,
    );
    return null;
  }
}

function readTrackedApp(windowTracker, window) {
  try {
    return windowTracker?.get_window_app?.(window) ?? null;
  } catch (error) {
    logger.debugOnce(
      "window-tracker",
      "Shell window/application association became unavailable during lookup",
      error,
    );
    return null;
  }
}

function readShellAppWindows(shellApp) {
  try {
    return shellApp?.get_windows?.() ?? [];
  } catch (error) {
    logger.debugOnce(
      "shell-app-windows",
      "Shell app windows became unavailable during lookup",
      error,
    );
    return [];
  }
}

function createWindowDescriptor(window, trackedApp) {
  const trackedDescriptor = readDesktopAppDescriptor(trackedApp);
  return {
    trackedDesktopId: trackedDescriptor.desktopId,
    trackedStartupWmClass: trackedDescriptor.startupWmClass,
    wmClass: readWindowStringSafely(window, "get_wm_class"),
    wmClassInstance: readWindowStringSafely(window, "get_wm_class_instance"),
    gtkApplicationId: readWindowStringSafely(window, "get_gtk_application_id"),
  };
}

function isSameShellApp(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  const leftId = readAppStringSafely(() => left.get_id?.());
  const rightId = readAppStringSafely(() => right.get_id?.());
  return Boolean(leftId && rightId && leftId === rightId);
}

/** Resolves exact PWA windows without changing player or application identity. */
export default class PlayerWindowResolver {
  constructor({ desktopAppResolver, createBusDaemonProxy } = {}) {
    if (!desktopAppResolver)
      throw new TypeError("PlayerWindowResolver requires DesktopAppResolver");
    if (typeof createBusDaemonProxy !== "function")
      throw new TypeError(
        "PlayerWindowResolver requires a D-Bus daemon proxy factory",
      );

    this.desktopAppResolver = desktopAppResolver;
    this.createBusDaemonProxy = createBusDaemonProxy;
    this.windowTracker = Shell.WindowTracker.get_default();
    this.shellGlobal = Shell.Global.get();
    this.operationCancellable = new Gio.Cancellable();
    this.lifecycleGeneration = 1;
    this.busDaemonProxy = null;
    this.busDaemonProxyPromise = null;
  }

  get isDestroyed() {
    return this.operationCancellable === null;
  }

  async ensureBusDaemonProxy() {
    if (this.isDestroyed) return null;
    if (this.busDaemonProxy) return this.busDaemonProxy;
    if (this.busDaemonProxyPromise) return this.busDaemonProxyPromise;

    const generation = this.lifecycleGeneration;
    const promise = this.createBusDaemonProxy(this.operationCancellable);
    this.busDaemonProxyPromise = promise;

    try {
      const proxy = await promise;
      if (this.isDestroyed || generation !== this.lifecycleGeneration)
        return null;
      this.busDaemonProxy = proxy;
      return proxy;
    } catch (error) {
      if (!isCancellationError(error))
        logger.debugOnce(
          "dbus-proxy",
          "D-Bus process lookup is unavailable; using MPRIS Raise fallback",
          error,
        );
      return null;
    } finally {
      if (this.busDaemonProxyPromise === promise)
        this.busDaemonProxyPromise = null;
    }
  }

  async resolveUnixProcessId(nameOwner) {
    const busDaemonProxy = await this.ensureBusDaemonProxy();
    if (!busDaemonProxy || !nameOwner || this.isDestroyed) return null;

    try {
      const result = await busDaemonProxy.call(
        DBusDaemonMethods.GET_CONNECTION_UNIX_PROCESS_ID,
        new GLib.Variant("(s)", [nameOwner]),
        Gio.DBusCallFlags.NONE,
        DBUS_PROCESS_ID_TIMEOUT_MS,
        this.operationCancellable,
      );
      const [pid] = result.deepUnpack();
      const normalizedPid = Number(pid);
      return Number.isInteger(normalizedPid) && normalizedPid > 0
        ? normalizedPid
        : null;
    } catch (error) {
      if (!isCancellationError(error))
        logger.debugOnce(
          `dbus-pid:${error?.name ?? "Error"}`,
          "Could not resolve the MPRIS D-Bus owner process; using Raise fallback",
          error,
        );
      return null;
    }
  }

  findPidWindow(pid, pwaAppId, exactShellApp = null) {
    const candidates = [];
    for (const actor of this.shellGlobal?.get_window_actors?.() ?? []) {
      const window = readMetaWindow(actor);
      if (!window || readWindowNumberSafely(window, "get_pid") !== pid)
        continue;

      const trackedApp = readTrackedApp(this.windowTracker, window);
      let evidence = null;
      let matchedShellApp = null;

      if (isSameShellApp(trackedApp, exactShellApp)) {
        evidence = PlayerWindowEvidence.TRACKED_APP;
        matchedShellApp = exactShellApp;
      } else {
        const descriptor = createWindowDescriptor(window, trackedApp);
        evidence = resolvePwaWindowEvidence(pwaAppId, descriptor);
        if (evidence === PlayerWindowEvidence.TRACKED_APP)
          matchedShellApp = trackedApp;
      }

      if (!evidence) continue;
      candidates.push({
        window,
        shellApp: matchedShellApp,
        evidence,
        userTime: readWindowNumberSafely(window, "get_user_time"),
        stableSequence: readWindowNumberSafely(window, "get_stable_sequence"),
      });
    }

    const candidate = chooseRecentPwaWindowCandidate(candidates);
    return candidate
      ? Object.freeze({
          window: candidate.window,
          shellApp: candidate.shellApp,
          pwaAppId,
          evidence: candidate.evidence,
        })
      : null;
  }

  async resolve(player) {
    if (!player || player.isDestroyed || this.isDestroyed) return null;

    const pwaAppId = resolveChromiumPwaAppId(createPlayerMediaIdentity(player));
    if (!pwaAppId) return null;

    const observedOwner = player.nameOwner;
    const observedOwnerGeneration = player.ownerGeneration;
    const lifecycleGeneration = this.lifecycleGeneration;
    if (!observedOwner) return null;

    const exactShellApp = this.desktopAppResolver.resolveShellApp(
      player.identity,
      player.desktopEntry,
      player.busName,
    );
    const exactWindows = readShellAppWindows(exactShellApp);
    if (exactWindows.length > 0)
      return Object.freeze({
        window: exactWindows[0],
        shellApp: exactShellApp,
        pwaAppId,
        evidence: PlayerWindowEvidence.SHELL_APP,
      });

    const pid = await this.resolveUnixProcessId(observedOwner);
    if (
      !pid ||
      this.isDestroyed ||
      lifecycleGeneration !== this.lifecycleGeneration ||
      player.isDestroyed ||
      player.nameOwner !== observedOwner ||
      player.ownerGeneration !== observedOwnerGeneration
    )
      return null;

    return this.findPidWindow(pid, pwaAppId, exactShellApp);
  }

  destroy() {
    const cancellable = this.operationCancellable;
    if (!cancellable) return;

    this.operationCancellable = null;
    this.lifecycleGeneration++;
    cancellable.cancel();
    this.busDaemonProxy = null;
    this.busDaemonProxyPromise = null;
    this.windowTracker = null;
    this.shellGlobal = null;
    this.desktopAppResolver = null;
    this.createBusDaemonProxy = null;
  }
}
