/**
 * @file MediaAppSelectionPolicy.js
 * @module shell.mpris.MediaAppSelectionPolicy
 *
 * Selects active and next media apps from registered MPRIS proxies.
 *
 * The pure policy prioritizes pinned, playing, current, paused, then first valid
 * apps, and exposes deterministic cycling for popup/app-switch actions. Keeping
 * this logic pure lets unit tests cover player selection without DBus or Shell UI.
 */
import { PlaybackStatus } from "../../shared/enums/playback.js";

// Active app selection priority:
//   1. Pinned app — if still in the registry
//   2. Playing app — first app with PlaybackStatus.PLAYING
//   3. Last active app — the app that was active before the registry changed
//   4. Paused app — first app that is not stopped
//   5. First valid app — fallback when nothing else matches
//
// Pinning survives MPRIS reconnects but not extension reload.
export function selectActiveMediaApp(mediaApps, currentBusName = null) {
    const validMediaApps = mediaApps.filter((mediaApp) => !mediaApp.isMediaAppInvalid);
    if (validMediaApps.length === 0) return null;

    const pinned = validMediaApps.find((mediaApp) => mediaApp.isAppPinned());
    if (pinned) return pinned;

    const playing = validMediaApps.find((mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PLAYING);
    if (playing) return playing;

    const current = validMediaApps.find((mediaApp) => mediaApp.busName === currentBusName);
    if (current) return current;

    const paused = validMediaApps.find((mediaApp) => mediaApp.playbackStatus === PlaybackStatus.PAUSED);
    return paused ?? validMediaApps[0];
}

export function selectNextMediaApp(mediaApps, currentMediaApp = null) {
    if (mediaApps.length <= 1) return null;

    const currentIndex = mediaApps.indexOf(currentMediaApp);
    return mediaApps[currentIndex >= 0 ? (currentIndex + 1) % mediaApps.length : 0] ?? null;
}
