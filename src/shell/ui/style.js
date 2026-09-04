/**
 * @file style.js
 * @module shell.ui.style
 *
 * Defines the two CSS vocabularies used by MediaShell Shell actors.
 *
 * NativeStyleClasses contains classes owned by GNOME Shell/St and therefore
 * subject to platform compatibility. MediaShellStyleClasses contains classes
 * owned by this extension and backed by src/stylesheet.css. Keeping the two
 * vocabularies separate makes private/native styling explicit at call sites.
 */

export const NativeStyleClasses = Object.freeze({
  BUTTON: "button",
  FLAT: "flat",
  ICON_BUTTON: "icon-button",
  NO_MARGIN: "no-margin",
  NO_PADDING: "no-padding",
  POPUP_MENU_ICON: "popup-menu-icon",
  POPUP_MENU_ITEM: "popup-menu-item",
  QUICK_MENU_TOGGLE: "quick-menu-toggle",
  SYSTEM_STATUS_ICON: "system-status-icon",
});

export const MediaShellStyleClasses = Object.freeze({
  COLORED_ICON: "colored-icon",
  SYMBOLIC_ICON: "symbolic-icon",
  SCROLLING_LABEL: "mediashell-scrolling-label",

  ARTWORK_FRAME: "mediashell-artwork-frame",
  ARTWORK_IMAGE: "mediashell-artwork-image",
  ARTWORK_FALLBACK: "mediashell-artwork-fallback",
  POPUP_PLAYER_SELECTOR: "mediashell-popup-player-selector",
  POPUP_PLAYER_SELECTOR_BUTTON: "mediashell-popup-player-selector-button",
  POPUP_PLAYER_SELECTOR_BUTTON_EXPAND_ICON:
    "mediashell-popup-player-selector-button-expand-icon",
  POPUP_PLAYER_SELECTOR_BUTTON_ICON:
    "mediashell-popup-player-selector-button-icon",
  POPUP_PLAYER_SELECTOR_BUTTON_LABEL:
    "mediashell-popup-player-selector-button-label",
  POPUP_PLAYER_SELECTOR_CARD: "mediashell-popup-player-selector-card",
  POPUP_PLAYER_SELECTOR_LIST: "mediashell-popup-player-selector-list",
  POPUP_PLAYER_SELECTOR_REVEALER: "mediashell-popup-player-selector-revealer",
  POPUP_PLAYER_SELECTOR_ROW: "mediashell-popup-player-selector-row",
  POPUP_PLAYER_SELECTOR_ROW_BOX: "mediashell-popup-player-selector-row-box",
  POPUP_PLAYER_SELECTOR_ROW_CHECK_ICON:
    "mediashell-popup-player-selector-row-check-icon",
  POPUP_PLAYER_SELECTOR_ROW_ITEM: "mediashell-popup-player-selector-row-item",
  POPUP_PLAYER_SELECTOR_ROW_LABEL: "mediashell-popup-player-selector-row-label",
  POPUP_PLAYER_SELECTOR_ROW_APP_ICON:
    "mediashell-popup-player-selector-row-app-icon",
  POPUP_PLAYER_SELECTOR_ROW_PIN_BUTTON:
    "mediashell-popup-player-selector-row-pin-button",
  POPUP_PLAYER_SELECTOR_ROW_PIN_ICON:
    "mediashell-popup-player-selector-row-pin-icon",
  POPUP_BOX: "mediashell-popup-box",
  POPUP_CONTAINER: "mediashell-popup-container",
  POPUP_CONTROL_BUTTON: "mediashell-popup-control-button",
  POPUP_CONTROL_BUTTON_ADJACENT: "mediashell-popup-control-button-adjacent",
  POPUP_CONTROL_BUTTON_CIRCULAR: "mediashell-popup-control-button-circular",
  POPUP_CONTROL_BUTTON_PRIMARY: "mediashell-popup-control-button-primary",
  POPUP_CONTROL_BUTTON_STATE: "mediashell-popup-control-button-state",
  POPUP_CONTROL_BUTTON_TEXT: "mediashell-popup-control-button-text",
  POPUP_CONTROL_ICON: "mediashell-popup-control-icon",
  POPUP_CONTROL_LABEL: "mediashell-popup-control-label",
  POPUP_PLAYBACK_CONTROLS: "mediashell-popup-playback-controls",
  POPUP_PRIMARY_CONTROLS: "mediashell-popup-primary-controls",
  POPUP_PROGRESS_BAR: "mediashell-popup-progress-bar",
  POPUP_PROGRESS_BAR_TIME: "mediashell-popup-progress-bar-time",
  POPUP_PROGRESS_BAR_TIME_LABEL: "mediashell-popup-progress-bar-time-label",
  POPUP_SECONDARY_CONTROLS: "mediashell-popup-secondary-controls",
  POPUP_TRACK_INFORMATION: "mediashell-popup-track-information",
  POPUP_TRACK_INFORMATION_ALBUM: "mediashell-popup-track-information-album",
  POPUP_TRACK_INFORMATION_ARTIST: "mediashell-popup-track-information-artist",
  POPUP_TRACK_INFORMATION_TITLE: "mediashell-popup-track-information-title",
  POPUP_VOLUME_CONTROL: "mediashell-popup-volume-control",
  POPUP_VOLUME_ICON_BUTTON: "mediashell-popup-volume-icon-button",

  TOP_BAR_ACTION_BOX: "mediashell-top-bar-action-box",
  TOP_BAR_ARTWORK: "mediashell-top-bar-artwork",
  TOP_BAR_APP_ICON: "mediashell-top-bar-app-icon",
  TOP_BAR_BOX: "mediashell-top-bar-box",
  TOP_BAR_CONTROL_BUTTON: "mediashell-top-bar-control-button",
  TOP_BAR_CONTROL_ICON: "mediashell-top-bar-control-icon",
  TOP_BAR_CONTROL_LABEL: "mediashell-top-bar-control-label",
  TOP_BAR_PLAYBACK_CONTROLS: "mediashell-top-bar-playback-controls",
  TOP_BAR_TRACK_INFORMATION: "mediashell-top-bar-track-information",
  TOP_BAR_VISUALIZER: "mediashell-top-bar-visualizer",
  TOP_BAR_VISUALIZER_BEATS: "mediashell-top-bar-visualizer-beats",
  TOP_BAR_VISUALIZER_BEATS_BAR: "mediashell-top-bar-visualizer-beats-bar",
  TOP_BAR_VISUALIZER_PULSE: "mediashell-top-bar-visualizer-pulse",
  TOP_BAR_VISUALIZER_PULSE_BAR: "mediashell-top-bar-visualizer-pulse-bar",
  TOP_BAR_VISUALIZER_CLASSIC: "mediashell-top-bar-visualizer-classic",
  TOP_BAR_VISUALIZER_CLASSIC_COLUMN:
    "mediashell-top-bar-visualizer-classic-column",
  TOP_BAR_VISUALIZER_CLASSIC_BLOCK:
    "mediashell-top-bar-visualizer-classic-block",
});

/** Returns a normalized space-separated CSS class list. */
export function styleClassNames(...classNames) {
  return classNames.filter(Boolean).join(" ");
}
