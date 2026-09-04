/**
 * @file playbackContracts.mjs
 * @module scripts.dev.playbackContracts
 *
 * Validates cross-file playback data that must agree for the extension to build
 * and render safely.
 *
 * The checker verifies IDs, settings ownership, bit flags, input mappings, and
 * MPRIS signatures. Product choices such as exact order, defaults, and visual
 * policy are covered by behavior tests instead of being duplicated here.
 */

import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
  MOUSE_ACTION_VALUES,
  PLAYBACK_ACTION_BY_INPUT_ACTION,
} from "../../src/shared/input/actions.js";
import {
  PLAYBACK_CONTROL_DEFINITIONS,
  PlaybackControlActions,
  PlaybackControlContentKinds,
  PlaybackControlGroups,
  PlaybackControlIds,
} from "../../src/shared/playback/controls.js";
import { PlaybackControlSurfaceDefinitions } from "../../src/shared/playback/surfaces.js";
import {
  MPRIS_PLAYER_IFACE_NAME,
  MprisPlayerMethods,
  MprisPlayerProperties,
  MprisPlayerSignals,
} from "../../src/shell/mpris/protocol.js";
import { WidgetFlags } from "../../src/shell/ui/widgetFlags.js";
import { PlaybackControlSurfaceUpdates } from "../../src/shell/media/playback/surfaceUpdates.js";
import { SETTINGS_SPEC } from "../../src/shell/settings/settingsSpec.js";

const PREFERENCES_UI_SOURCE = "assets/ui/prefs.ui";
const INPUT_ACTION_MODEL_ID = "model-input-actions";

function duplicateValues(values) {
  const duplicates = new Set();
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    else seen.add(value);
  }
  return [...duplicates];
}

function isSingleBit(value) {
  return Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function cloneSurface(surface, definition) {
  const updates = PlaybackControlSurfaceUpdates[surface];
  return {
    show: { ...definition.show, impact: updates.show },
    controls: definition.controls.map((control) => ({
      ...control,
      impact: updates.controls[control.controlId],
    })),
  };
}

/** Creates a serializable snapshot for runtime checks and negative fixtures. */
export function createPlaybackContractSnapshot(manifest) {
  return {
    controls: PLAYBACK_CONTROL_DEFINITIONS.map((definition) => ({
      ...definition,
      icons: definition.icons ? { ...definition.icons } : null,
    })),
    controlIds: { ...PlaybackControlIds },
    surfaces: Object.fromEntries(
      Object.entries(PlaybackControlSurfaceDefinitions).map(
        ([surface, definition]) => [surface, cloneSurface(surface, definition)],
      ),
    ),
    settingsSpec: Object.fromEntries(
      Object.entries(SETTINGS_SPEC).map(([key, spec]) => [
        key,
        {
          property: spec.property,
          read: spec.read,
          impact: spec.impact ?? null,
        },
      ]),
    ),
    schema: manifest.schema,
    widgetFlags: { ...WidgetFlags },
    inputDefinitions: INPUT_ACTION_DEFINITIONS.map((definition) => ({
      ...definition,
    })),
    mouseActionValues: [...MOUSE_ACTION_VALUES],
    mouseActionLabels: [
      ...(manifest.uiStringListsBySource?.[PREFERENCES_UI_SOURCE]?.[
        INPUT_ACTION_MODEL_ID
      ] ?? []),
    ],
    shortcutKeys: [...KEYBOARD_SHORTCUT_KEYS],
    playbackActionsByInput: { ...PLAYBACK_ACTION_BY_INPUT_ACTION },
    playbackActions: Object.values(PlaybackControlActions),
    dbusSignatures: manifest.dbusSignatures,
  };
}

function validateDefinitions(snapshot, errors) {
  const ids = snapshot.controls.map(({ id }) => id);
  const actorNames = snapshot.controls.map(({ actorName }) => actorName);
  const declaredIds = Object.values(snapshot.controlIds);

  for (const duplicate of duplicateValues(ids))
    errors.push(`playback controls: duplicate ID ${duplicate}`);
  for (const duplicate of duplicateValues(actorNames))
    errors.push(`playback controls: duplicate actor name ${duplicate}`);
  if (
    ids.length !== declaredIds.length ||
    ids.some((id) => !declaredIds.includes(id))
  ) {
    const missing = declaredIds.filter((id) => !ids.includes(id));
    const unknown = ids.filter((id) => !declaredIds.includes(id));
    if (missing.length > 0)
      errors.push(
        `playback controls: missing definitions ${missing.join(", ")}`,
      );
    if (unknown.length > 0)
      errors.push(
        `playback controls: unknown definitions ${unknown.join(", ")}`,
      );
  }

  const groups = new Set(Object.values(PlaybackControlGroups));
  const contentKinds = new Set(Object.values(PlaybackControlContentKinds));
  for (const control of snapshot.controls) {
    if (!groups.has(control.group))
      errors.push(`${control.id}: unknown group ${control.group}`);
    if (!contentKinds.has(control.contentKind))
      errors.push(`${control.id}: unknown content kind ${control.contentKind}`);
    if (
      control.contentKind === PlaybackControlContentKinds.ICON &&
      Object.keys(control.icons ?? {}).length === 0
    )
      errors.push(`${control.id}: icon control has no icons`);
    if (
      control.contentKind === PlaybackControlContentKinds.LABEL &&
      control.icons !== null
    )
      errors.push(`${control.id}: label control must not define icons`);
  }
}

function validateSettingOwner(snapshot, errors, surface, item, label) {
  const schemaKey = snapshot.schema.keys[item.settingKey];
  if (!schemaKey) {
    errors.push(`${surface}/${label}: missing schema key ${item.settingKey}`);
    return;
  }
  if (schemaKey.type !== "b")
    errors.push(
      `${item.settingKey}: playback visibility setting must be boolean`,
    );

  const spec = snapshot.settingsSpec[item.settingKey];
  if (!spec) {
    errors.push(`${item.settingKey}: missing runtime settings owner`);
    return;
  }
  if (
    spec.property !== item.property ||
    spec.impact !== item.impact ||
    spec.read !== "get_boolean"
  )
    errors.push(`${item.settingKey}: surface policy and SETTINGS_SPEC differ`);
}

function validateSurfaces(snapshot, errors) {
  const knownIds = new Set(snapshot.controls.map(({ id }) => id));
  const usedIds = new Set();
  const ownedProperties = new Map();

  for (const [surface, definition] of Object.entries(snapshot.surfaces)) {
    validateSettingOwner(snapshot, errors, surface, definition.show, "show");

    const controlIds = definition.controls.map(({ controlId }) => controlId);
    for (const duplicate of duplicateValues(controlIds))
      errors.push(`${surface}: duplicate control policy ${duplicate}`);

    for (const control of definition.controls) {
      const { controlId } = control;
      usedIds.add(controlId);
      if (!knownIds.has(controlId))
        errors.push(`${surface}: unknown control policy ${controlId}`);
      validateSettingOwner(snapshot, errors, surface, control, controlId);

      const previousOwner = ownedProperties.get(control.property);
      if (previousOwner)
        errors.push(
          `${surface}/${controlId}: runtime property ${control.property} is already owned by ${previousOwner}`,
        );
      else ownedProperties.set(control.property, `${surface}/${controlId}`);
    }
  }

  for (const id of knownIds) {
    if (!usedIds.has(id))
      errors.push(`playback controls: ${id} has no surface`);
  }
}

function validateInputs(snapshot, errors) {
  const ids = snapshot.inputDefinitions.map(({ id }) => id);
  const actions = snapshot.inputDefinitions.map(({ action }) => action);
  const shortcuts = snapshot.inputDefinitions.map(
    ({ shortcutKey }) => shortcutKey,
  );

  for (const duplicate of duplicateValues(ids))
    errors.push(`input actions: duplicate ID ${duplicate}`);
  for (const duplicate of duplicateValues(actions))
    errors.push(`input actions: duplicate enum value ${duplicate}`);
  for (const duplicate of duplicateValues(shortcuts))
    errors.push(`input actions: duplicate shortcut key ${duplicate}`);
  for (const duplicate of duplicateValues(snapshot.shortcutKeys))
    errors.push(`keyboard shortcuts: duplicate key ${duplicate}`);
  for (const duplicate of duplicateValues(snapshot.mouseActionValues))
    errors.push(`mouse actions: duplicate value ${duplicate}`);

  if (snapshot.mouseActionLabels.length !== snapshot.mouseActionValues.length)
    errors.push("mouse action labels and values have different lengths");

  const knownPlaybackActions = new Set(snapshot.playbackActions);
  for (const definition of snapshot.inputDefinitions) {
    if (!snapshot.schema.keys[definition.shortcutKey])
      errors.push(`${definition.id}: shortcut schema key is missing`);
    if (definition.playbackAction) {
      if (!knownPlaybackActions.has(definition.playbackAction))
        errors.push(`${definition.id}: unknown playback action`);
      if (
        snapshot.playbackActionsByInput[definition.action] !==
        definition.playbackAction
      )
        errors.push(
          `${definition.id}: playback input mapping differs from its definition`,
        );
    } else if (snapshot.playbackActionsByInput[definition.action]) {
      errors.push(`${definition.id}: unexpected playback input mapping`);
    }
  }
}

function validateFlags(snapshot, errors) {
  const compound = new Set([
    "TOP_BAR_PLAYBACK_CONTROLS",
    "TOP_BAR",
    "POPUP_PLAYBACK_CONTROLS",
    "POPUP",
    "ALL",
  ]);
  const individual = Object.entries(snapshot.widgetFlags).filter(
    ([name]) => !compound.has(name),
  );
  for (const [name, value] of individual) {
    if (!isSingleBit(value))
      errors.push(`${name}: widget flag must be one bit`);
  }
  for (const duplicate of duplicateValues(individual.map(([, value]) => value)))
    errors.push(`widget flags: duplicate individual bit ${duplicate}`);

  const knownFlags = new Set(Object.values(snapshot.widgetFlags));
  for (const [surface, definition] of Object.entries(snapshot.surfaces)) {
    for (const [label, item] of [
      ["show", definition.show],
      ...definition.controls.map((control) => [control.controlId, control]),
    ]) {
      if (!knownFlags.has(item.impact))
        errors.push(`${surface}/${label}: unknown update flag ${item.impact}`);
    }
  }
}

function validateDbus(snapshot, errors) {
  const player = snapshot.dbusSignatures[MPRIS_PLAYER_IFACE_NAME];
  if (!player) {
    errors.push(`${MPRIS_PLAYER_IFACE_NAME}: parsed interface is missing`);
    return;
  }

  const required = [
    [
      "MPRIS Seek signature",
      player.method[MprisPlayerMethods.SEEK],
      [{ name: "Offset", type: "x", direction: "in" }],
    ],
    [
      "MPRIS SetPosition signature",
      player.method[MprisPlayerMethods.SET_POSITION],
      [
        { name: "TrackId", type: "o", direction: "in" },
        { name: "Position", type: "x", direction: "in" },
      ],
    ],
    [
      "MPRIS Seeked signature",
      player.signal[MprisPlayerSignals.SEEKED],
      [{ name: "Position", type: "x", direction: null }],
    ],
    [
      "MPRIS Position property",
      player.property[MprisPlayerProperties.POSITION],
      { type: "x", access: "read" },
    ],
  ];
  for (const [label, actual, expected] of required) {
    if (!same(actual, expected)) errors.push(`${label} differs from MPRIS`);
  }
}

/** Validates a serialized playback contract snapshot. */
export function validatePlaybackContractSnapshot(snapshot) {
  const errors = [];
  validateDefinitions(snapshot, errors);
  validateSurfaces(snapshot, errors);
  validateInputs(snapshot, errors);
  validateFlags(snapshot, errors);
  validateDbus(snapshot, errors);
  return errors;
}
