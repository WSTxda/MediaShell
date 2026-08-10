/**
 * @file widgetFlags.js
 * @module shared.enums.widgetFlags
 *
 * Bitmask enum that identifies which UI regions need a re-render.
 *
 * Flags are ORed into pending update fields inside MediaShellIndicator and
 * PopupContent
 * so bursts of MPRIS changes can be coalesced into a single idle render. Compound
 * flags group top bar and popup regions while individual bits target one widget.
 */

export const WidgetFlags = Object.freeze({
  TOP_BAR_MEDIA_APP_ICON: 1 << 0,
  TOP_BAR_TRACK_INFORMATION: 1 << 1,
  TOP_BAR_PLAYBACK_SHUFFLE: 1 << 2,
  TOP_BAR_PLAYBACK_PREVIOUS: 1 << 3,
  TOP_BAR_PLAYBACK_PLAY_PAUSE: 1 << 4,
  TOP_BAR_PLAYBACK_NEXT: 1 << 5,
  TOP_BAR_PLAYBACK_REPEAT: 1 << 6,
  TOP_BAR_ELEMENT_ORDER: 1 << 7,
  POPUP_MEDIA_APP_SELECTOR: 1 << 8,
  POPUP_ALBUM_ART: 1 << 9,
  POPUP_TRACK_INFORMATION: 1 << 10,
  POPUP_PROGRESS_BAR: 1 << 11,
  POPUP_PLAYBACK_SHUFFLE: 1 << 12,
  POPUP_PLAYBACK_PREVIOUS: 1 << 13,
  POPUP_PLAYBACK_PLAY_PAUSE: 1 << 14,
  POPUP_PLAYBACK_NEXT: 1 << 15,
  POPUP_PLAYBACK_REPEAT: 1 << 16,
  TOP_BAR_VISUALIZER: 1 << 17,
  TOP_BAR_PLAYBACK_SEEK_BACKWARD: 1 << 18,
  TOP_BAR_PLAYBACK_SEEK_FORWARD: 1 << 19,
  POPUP_PLAYBACK_SEEK_BACKWARD: 1 << 20,
  POPUP_PLAYBACK_SEEK_FORWARD: 1 << 21,
  TOP_BAR_LAYOUT: 1 << 22,
  POPUP_PLAYBACK_SPEED: 1 << 23,
  TOP_BAR_PLAYBACK_CONTROLS:
    (1 << 2) |
    (1 << 3) |
    (1 << 4) |
    (1 << 5) |
    (1 << 6) |
    (1 << 18) |
    (1 << 19),
  TOP_BAR:
    (1 << 0) |
    (1 << 1) |
    (1 << 2) |
    (1 << 3) |
    (1 << 4) |
    (1 << 5) |
    (1 << 6) |
    (1 << 17) |
    (1 << 22) |
    (1 << 18) |
    (1 << 19),
  POPUP_PLAYBACK_CONTROLS:
    (1 << 12) |
    (1 << 13) |
    (1 << 14) |
    (1 << 15) |
    (1 << 16) |
    (1 << 20) |
    (1 << 21) |
    (1 << 23),
  POPUP:
    (1 << 8) |
    (1 << 9) |
    (1 << 10) |
    (1 << 11) |
    (1 << 12) |
    (1 << 13) |
    (1 << 14) |
    (1 << 15) |
    (1 << 16) |
    (1 << 20) |
    (1 << 21) |
    (1 << 23),
  ALL: ~(-1 << 24),
});
