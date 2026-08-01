/**
 * @file styleClasses.js
 * @module shell.constants.styleClasses
 *
 * Defines CSS class names applied by MediaShell Shell actors.
 *
 * The stylesheet remains the visual source of truth. Renderers import this
 * vocabulary so class renames cannot leave stale string literals scattered
 * across popup and top bar components.
 */

export const StyleClasses = Object.freeze({
  BUTTON: "button",
  COLORED_ICON: "colored-icon",
  NO_MARGIN: "no-margin",
  NO_PADDING: "no-padding",
  POPUP_MENU_ICON: "popup-menu-icon",
  POPUP_MENU_ITEM: "popup-menu-item",
  QUICK_MENU_TOGGLE: "quick-menu-toggle",
  SYMBOLIC_ICON: "symbolic-icon",
  SYSTEM_STATUS_ICON: "system-status-icon",

  SCROLLING_LABEL: "mediashell-scrolling-label",

  POPUP_ALBUM_ART: "mediashell-popup-album-art",
  POPUP_ALBUM_ART_FALLBACK: "mediashell-popup-album-art-fallback",
  POPUP_ALBUM_ART_FRAME: "mediashell-popup-album-art-frame",
  POPUP_MEDIA_APP_SELECTOR: "mediashell-popup-media-app-selector",
  POPUP_MEDIA_APP_SELECTOR_BUTTON:
    "mediashell-popup-media-app-selector-button",
  POPUP_MEDIA_APP_SELECTOR_BUTTON_EXPAND_ICON:
    "mediashell-popup-media-app-selector-button-expand-icon",
  POPUP_MEDIA_APP_SELECTOR_BUTTON_ICON:
    "mediashell-popup-media-app-selector-button-icon",
  POPUP_MEDIA_APP_SELECTOR_BUTTON_LABEL:
    "mediashell-popup-media-app-selector-button-label",
  POPUP_MEDIA_APP_SELECTOR_CARD: "mediashell-popup-media-app-selector-card",
  POPUP_MEDIA_APP_SELECTOR_LIST: "mediashell-popup-media-app-selector-list",
  POPUP_MEDIA_APP_SELECTOR_REVEALER:
    "mediashell-popup-media-app-selector-revealer",
  POPUP_MEDIA_APP_SELECTOR_ROW: "mediashell-popup-media-app-selector-row",
  POPUP_MEDIA_APP_SELECTOR_ROW_BOX:
    "mediashell-popup-media-app-selector-row-box",
  POPUP_MEDIA_APP_SELECTOR_ROW_CHECK_ICON:
    "mediashell-popup-media-app-selector-row-check-icon",
  POPUP_MEDIA_APP_SELECTOR_ROW_ITEM:
    "mediashell-popup-media-app-selector-row-item",
  POPUP_MEDIA_APP_SELECTOR_ROW_LABEL:
    "mediashell-popup-media-app-selector-row-label",
  POPUP_MEDIA_APP_SELECTOR_ROW_MEDIA_APP_ICON:
    "mediashell-popup-media-app-selector-row-media-app-icon",
  POPUP_MEDIA_APP_SELECTOR_ROW_PIN_BUTTON:
    "mediashell-popup-media-app-selector-row-pin-button",
  POPUP_MEDIA_APP_SELECTOR_ROW_PIN_ICON:
    "mediashell-popup-media-app-selector-row-pin-icon",
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

  TOP_BAR_ACTION_BOX: "mediashell-top-bar-action-box",
  TOP_BAR_MEDIA_APP_ICON: "mediashell-top-bar-media-app-icon",
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
  TOP_BAR_VISUALIZER_SPECTRUM: "mediashell-top-bar-visualizer-spectrum",
});
