// Isolates the optional patch that hides GNOME Shell's system media controls.
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
        this.destroyed = false;
    }

    setSystemMediaControlsHidden(isHidden) {
        if (this.destroyed || this.isHidden === isHidden) return;

        this.restoreGeneration++;
        this.injectionManager.clear();
        this.isHidden = false;
        if (!isHidden) {
            const restoreGeneration = this.restoreGeneration;
            this.restoreCurrentSystemMediaControls(restoreGeneration)
                .then(() => {
                    if (!this.destroyed && restoreGeneration === this.restoreGeneration)
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
        if (Mpris.MprisSource?.prototype?._addPlayer) return Mpris.MprisSource;
        if (Mpris.MediaSection?.prototype?._addPlayer) return Mpris.MediaSection;
        return null;
    }

    removeCurrentSystemMediaControls() {
        const mediaSource = this.getSystemMediaSource();
        if (!mediaSource?._players) return;

        for (const [busName, systemPlayer] of [...mediaSource._players.entries()]) {
            try {
                mediaSource._onNameOwnerChanged?.(null, null, [busName, busName, ""]);
                // The synthetic owner loss removes the source entry. Explicitly
                // close the private player proxy because no real D-Bus signal follows.
                systemPlayer._close?.();
            } catch (error) {
                logger.warn("Failed to remove a system media control", error);
            }
        }
    }

    async restoreCurrentSystemMediaControls(restoreGeneration) {
        const mediaSource = this.getSystemMediaSource();
        if (!mediaSource?._proxy?.ListNamesAsync || !mediaSource?._addPlayer) return;

        // Do not invoke Shell's private _onProxyReady() a second time because it
        // would install another NameOwnerChanged subscription. Replay current
        // names only, and discard the result if the setting changes meanwhile.
        const [busNames] = await mediaSource._proxy.ListNamesAsync();
        if (this.isHidden || restoreGeneration !== this.restoreGeneration) return;

        for (const busName of busNames) {
            if (busName.startsWith(MPRIS_PREFIX) && !mediaSource._players?.has?.(busName))
                mediaSource._addPlayer(busName);
        }
    }

    getSystemMediaSource() {
        const messageList = Main.panel.statusArea.dateMenu?._messageList;
        return messageList?._messageView?._mediaSource ?? messageList?._mediaSection ?? null;
    }

    destroy() {
        if (this.destroyed) return;

        if (this.isHidden) {
            const restoreGeneration = ++this.restoreGeneration;
            this.injectionManager.clear();
            this.isHidden = false;
            this.restoreCurrentSystemMediaControls(restoreGeneration).catch((error) =>
                logger.warn("Failed to restore current system media controls during teardown", error),
            );
        }

        this.destroyed = true;
        this.injectionManager.clear();
        this.injectionManager = null;
    }
}
