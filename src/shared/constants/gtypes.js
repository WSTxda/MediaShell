/**
 * @file gtypes.js
 * @module shared.constants.gtypes
 *
 * Defines stable GObject type names registered by MediaShell widgets.
 *
 * GtkBuilder templates and Shell actor registration depend on these names
 * remaining unique. JavaScript owners import them instead of re-typing runtime
 * type identity beside each registration.
 */

export const GTypeNames = Object.freeze({
  BLOCKED_APP_CHOOSER_DIALOG: "MediaShellBlockedAppChooserDialog",
  BLOCKED_APPS_GROUP: "MediaShellBlockedAppsGroup",
  POPUP_PROGRESS_BAR_SLIDER: "MediaShellPopupProgressBarSlider",
  SCROLLING_LABEL: "MediaShellScrollingLabel",
  TOP_BAR_BUTTON: "MediaShellTopBarButton",
  TOP_BAR_ELEMENT_ORDER_GROUP: "MediaShellTopBarElementOrderGroup",
  TRACK_INFORMATION_CONTENT_ROW: "MediaShellTrackInformationContentRow",
});
