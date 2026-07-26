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
  POPUP_APP_SELECTOR_TRIGGER_EXPAND_ICON: "mediashell-popup-app-expand-icon",
  POPUP_APP_SELECTOR_TRIGGER_LABEL: "mediashell-popup-app-label",
  POPUP_APP_SELECTOR_TRIGGER: "mediashell-popup-app-selector",
  POPUP_APP_SELECTOR_ROW_APP_ICON: "mediashell-popup-app-selector-app-icon",
  POPUP_APP_SELECTOR_CARD: "mediashell-popup-app-selector-card",
  POPUP_APP_SELECTOR_ROW_CHECK_ICON: "mediashell-popup-app-selector-check-icon",
  POPUP_APP_SELECTOR_TRIGGER_ICON: "mediashell-popup-app-selector-icon",
  POPUP_APP_SELECTOR_ROW_LABEL: "mediashell-popup-app-selector-label",
  POPUP_APP_SELECTOR_LIST: "mediashell-popup-app-selector-list",
  POPUP_APP_SELECTOR_ROW_PIN_BUTTON: "mediashell-popup-app-selector-pin-button",
  POPUP_APP_SELECTOR_ROW_PIN_ICON: "mediashell-popup-app-selector-pin-icon",
  POPUP_APP_SELECTOR_REVEALER: "mediashell-popup-app-selector-revealer",
  POPUP_APP_SELECTOR_ROW: "mediashell-popup-app-selector-row",
  POPUP_APP_SELECTOR_ROW_BOX: "mediashell-popup-app-selector-row-box",
  POPUP_APP_SELECTOR_ROW_ITEM: "mediashell-popup-app-selector-row-item",
  POPUP_APP_SELECTOR_CONTAINER: "mediashell-popup-apps",
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
  TOP_BAR_BOX: "mediashell-top-bar-box",
  TOP_BAR_CONTROL_BUTTON: "mediashell-top-bar-control-button",
  TOP_BAR_CONTROL_ICON: "mediashell-top-bar-control-icon",
  TOP_BAR_CONTROL_LABEL: "mediashell-top-bar-control-label",
  TOP_BAR_PLAYBACK_CONTROLS: "mediashell-top-bar-playback-controls",
  TOP_BAR_VISUALIZER: "mediashell-top-bar-visualizer",
  TOP_BAR_VISUALIZER_BAR: "mediashell-top-bar-visualizer-bar",
});
