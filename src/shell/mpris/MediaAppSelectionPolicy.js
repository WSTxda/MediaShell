// Selects the active media app deterministically without touching D-Bus or UI objects.
import { PlaybackStatus } from "../../shared/enums/MediaShellEnums.js";

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
