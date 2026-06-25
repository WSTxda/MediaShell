/**
 * @file SystemMediaControlsPatch.js
 * @module shell.services.SystemMediaControlsPatch
 *
 * Applies the optional patch that hides GNOME Shell's default media controls.
 *
 * ExtensionController toggles this service from settings changes. The service
 * owns the monkey-patch boundary and restoration logic so Shell notification UI
 * changes stay isolated from MPRIS and top-bar code.
 */
import * as Main from "resource:///org/gnome/shell/ui/main.js";
import * as Mpris from "resource:///org/gnome/shell/ui/mpris.js";
import { InjectionManager } from "resource:///org/gnome/shell/extensions/extension.js";

import { MPRIS_PREFIX } from "../../shared/constants/dbus.js";
import { createLogger } from "../../shared/utils/log.js";

const logger = createLogger("SystemMediaControlsPatch");

export default class SystemMediaControlsPatch {
    constructor() {
        this.injectionManager = new InjectionManager();
        this.isHidden = false;
        this.restoreGeneration = 0;
        this.isDestroyed = false;
    }

    setSystemMediaControlsHidden(isHidden) {
        if (this.isDestroyed || this.isHidden === isHidden) return;

        this.restoreGeneration++;
        this.injectionManager.clear();
        this.isHidden = false;
        if (!isHidden) {
            const restoreGeneration = this.restoreGeneration;
            this.restoreCurrentSystemMediaControls(restoreGeneration)
                .then(() => {
                    if (!this.isDestroyed && restoreGeneration === this.restoreGeneration)
                        logger.debug("Restored GNOME Shell system media controls");
                })
                .catch((error) => logger.warn("Failed to restore current system media controls", error));
            return;
        }

        const sourceClass = this.getSystemMediaSourceClass();
        if (!sourceClass?.prototype?._addPlayer) {
            // The system media implementation is private Shell API. Failing open
            // preserves GNOME's controls when a supported release changes shape.
            logger.warn("System media controls could not be patched on this Shell version");
            return;
        }

        this.injectionManager.overrideMethod(sourceClass.prototype, "_addPlayer", () => function () {});
        this.isHidden = true;
        this.removeCurrentSystemMediaControls();
        logger.debug("Hid GNOME Shell system media controls");
    }

    getSystemMediaSourceClass() {
        // Shell 46+: MprisSource owns _addPlayer
        if (Mpris.MprisSource?.prototype?._addPlayer) return Mpris.MprisSource;
        // Shell 40–45: MediaSection owned _addPlayer
        if (Mpris.MediaSection?.prototype?._addPlayer) return Mpris.MediaSection;
        return null;
    }

    removeCurrentSystemMediaControls() {
        const mediaSource = this.getSystemMediaSource();
        // _players is the Map<busName, MprisPlayer> inside the media source
        if (!mediaSource?._players) return;

        for (const [busName, systemPlayer] of [...mediaSource._players.entries()]) {
            try {
                // _onNameOwnerChanged is Shell's internal handler for MPRIS bus
                // disappearance. Calling it with an empty new owner triggers the
                // same cleanup path as a real D-Bus name loss.
                mediaSource._onNameOwnerChanged?.(null, null, [busName, busName, ""]);
                // _close() tears down the private player proxy. Shell would normally
                // call this after the synthetic name loss, but it is not guaranteed.
                systemPlayer._close?.();
            } catch (error) {
                logger.warn("Failed to remove a system media control", error);
            }
        }
    }

    async restoreCurrentSystemMediaControls(restoreGeneration) {
        const mediaSource = this.getSystemMediaSource();
        if (!mediaSource?._proxy?.ListNamesAsync || !mediaSource?._addPlayer) return;

        // _proxy is Shell's own DBus proxy for the session bus — same one used for
        // NameOwnerChanged. _onProxyReady() sets it up; we reuse it here without
        // calling _onProxyReady() again because that would install duplicate
        // subscriptions. Replay current names only, and discard the result if the
        // setting changes meanwhile.
        const [busNames] = await mediaSource._proxy.ListNamesAsync();
        if (this.isHidden || restoreGeneration !== this.restoreGeneration) return;

        for (const busName of busNames) {
            if (busName.startsWith(MPRIS_PREFIX) && !mediaSource._players?.has?.(busName))
                mediaSource._addPlayer(busName);
        }
    }

    getSystemMediaSource() {
        // dateMenu is the calendar panel button. _messageList is its private
        // notification tray actor, stable since GNOME 40.
        const messageList = Main.panel.statusArea.dateMenu?._messageList;
        // Shell 46+ restructured the media section under _messageView._mediaSource.
        // Shell 40–45 exposed it directly as _mediaSection. Both are private.
        return messageList?._messageView?._mediaSource ?? messageList?._mediaSection ?? null;
    }

    destroy() {
        if (this.isDestroyed) return;

        if (this.isHidden) {
            const restoreGeneration = ++this.restoreGeneration;
            this.injectionManager.clear();
            this.isHidden = false;
            this.restoreCurrentSystemMediaControls(restoreGeneration).catch((error) =>
                logger.warn("Failed to restore current system media controls during teardown", error),
            );
        }

        this.isDestroyed = true;
        this.injectionManager.clear();
        this.injectionManager = null;
    }
}
