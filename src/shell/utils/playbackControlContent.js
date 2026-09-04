/**
 * @file playbackControlContent.js
 * @module shell.utils.playbackControlContent
 *
 * Creates and updates the icon-or-label content used by playback buttons.
 *
 * Popup and top bar retain separate button actors and styles while sharing this
 * small content boundary so text controls do not introduce parallel renderers.
 */

import St from "gi://St";

import { PlaybackControlContentKinds } from "../../shared/playback/controls.js";
import { createIcon, setIconName } from "./icons.js";

export function createPlaybackControlContent(
  controlDefinition,
  { iconStyleClass = null, labelStyleClass = null } = {},
) {
  if (controlDefinition.contentKind === PlaybackControlContentKinds.LABEL) {
    const label = new St.Label({
      styleClass: labelStyleClass,
      text: "",
    });
    return { actor: label, icon: null, label };
  }

  const icon = createIcon({ styleClass: iconStyleClass });
  return { actor: icon, icon, label: null };
}

export function updatePlaybackControlContent(
  content,
  { iconName = null, labelText = "" } = {},
) {
  if (content.icon) setIconName(content.icon, iconName);
  else if (content.label) content.label.set_text(String(labelText ?? ""));
}
