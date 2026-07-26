/**
 * @file playbackContracts.mjs
 * @module scripts.dev.playbackContracts
 *
 * Validates the stable playback domain against parsed settings, UI, and D-Bus data.
 *
 * The checker compares owned tables and parsed contracts. It intentionally avoids
 * source-text rules, naming preferences, and exact call-site counts.
 */

import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
  LEGACY_INPUT_ACTION_SCHEMA_NICKS,
  MOUSE_ACTION_VALUES,
  PLAYBACK_ACTION_BY_INPUT_ACTION,
} from "../../src/shared/constants/inputActions.js";
import {
  PLAYBACK_CONTROL_DEFINITIONS,
  PlaybackControlActions,
  PlaybackControlContentKinds,
  PlaybackControlGroups,
  PlaybackControlIds,
  RELATIVE_SEEK_SECONDS,
} from "../../src/shared/constants/playbackControls.js";
import {
  PlaybackControlSurfaceDefinitions,
  PlaybackControlSurfaces,
} from "../../src/shared/constants/playbackControlSurfaces.js";
import {
  MPRIS_PLAYER_IFACE_NAME,
  MprisPlayerMethods,
  MprisPlayerProperties,
  MprisPlayerSignals,
} from "../../src/shared/constants/dbus.js";
import { SettingsKeys } from "../../src/shared/constants/settings.js";
import { InputActions } from "../../src/shared/enums/input.js";
import { WidgetFlags } from "../../src/shared/enums/widget.js";
import {
  POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER,
  POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER,
  TOP_BAR_PLAYBACK_CONTROL_ORDER,
} from "../../src/shell/constants/playbackControls.js";
import { SETTINGS_SPEC } from "../../src/shell/settings/settingsSpec.js";

const EXPECTED_INPUT_ACTIONS = Object.freeze({
  NONE: 0,
  TOGGLE_SHUFFLE: 1,
  PREVIOUS_TRACK: 2,
  PLAY_PAUSE: 3,
  NEXT_TRACK: 4,
  TOGGLE_LOOP: 5,
  VOLUME_UP: 6,
  VOLUME_DOWN: 7,
  TOGGLE_POPUP: 8,
  OPEN_PREFERENCES: 9,
  RAISE_APP: 10,
  QUIT_APP: 11,
  SWITCH_APP: 12,
  SEEK_BACKWARD: 13,
  SEEK_FORWARD: 14,
  RESERVED_15: 15,
  RESERVED_16: 16,
  RESERVED_17: 17,
});

const EXPECTED_MOUSE_ACTION_LABELS = Object.freeze([
  "None",
  "Shuffle",
  "Seek backward",
  "Previous track",
  "Play / pause",
  "Next track",
  "Seek forward",
  "Repeat",
  "Volume up",
  "Volume down",
  "Popup",
  "Preferences",
  "Open app",
  "Quit app",
  "Switch app",
]);

const EXPECTED_ORDERS = Object.freeze({
  popupPrimary: Object.freeze([
    PlaybackControlIds.SEEK_BACKWARD,
    PlaybackControlIds.PREVIOUS,
    PlaybackControlIds.PLAY_PAUSE,
    PlaybackControlIds.NEXT,
    PlaybackControlIds.SEEK_FORWARD,
  ]),
  popupSecondary: Object.freeze([
    PlaybackControlIds.SHUFFLE,
    PlaybackControlIds.SPEED,
    PlaybackControlIds.REPEAT,
  ]),
  topBar: Object.freeze([
    PlaybackControlIds.SHUFFLE,
    PlaybackControlIds.SEEK_BACKWARD,
    PlaybackControlIds.PREVIOUS,
    PlaybackControlIds.PLAY_PAUSE,
    PlaybackControlIds.NEXT,
    PlaybackControlIds.SEEK_FORWARD,
    PlaybackControlIds.REPEAT,
  ]),
});

const EXPECTED_CONTROL_DEFAULTS = Object.freeze({
  [PlaybackControlSurfaces.POPUP]: Object.freeze({
    [PlaybackControlIds.SHUFFLE]: true,
    [PlaybackControlIds.SEEK_BACKWARD]: false,
    [PlaybackControlIds.PREVIOUS]: true,
    [PlaybackControlIds.PLAY_PAUSE]: true,
    [PlaybackControlIds.NEXT]: true,
    [PlaybackControlIds.SEEK_FORWARD]: false,
    [PlaybackControlIds.REPEAT]: true,
    [PlaybackControlIds.SPEED]: false,
  }),
  [PlaybackControlSurfaces.TOP_BAR]: Object.freeze({
    [PlaybackControlIds.SHUFFLE]: false,
    [PlaybackControlIds.SEEK_BACKWARD]: false,
    [PlaybackControlIds.PREVIOUS]: true,
    [PlaybackControlIds.PLAY_PAUSE]: true,
    [PlaybackControlIds.NEXT]: true,
    [PlaybackControlIds.SEEK_FORWARD]: false,
    [PlaybackControlIds.REPEAT]: false,
  }),
});

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

function addMismatch(errors, label, actual, expected) {
  if (!same(actual, expected))
    errors.push(
      `${label}: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
}

function cloneSurface(definition) {
  return {
    show: { ...definition.show },
    controls: definition.controls.map((control) => ({ ...control })),
  };
}

/** Creates a serializable snapshot used by the runtime check and negative fixtures. */
export function createPlaybackContractSnapshot(manifest) {
  return {
    controls: PLAYBACK_CONTROL_DEFINITIONS.map((definition) => ({
      ...definition,
      icons: definition.icons ? { ...definition.icons } : null,
    })),
    orders: {
      popupPrimary: [...POPUP_PRIMARY_PLAYBACK_CONTROL_ORDER],
      popupSecondary: [...POPUP_SECONDARY_PLAYBACK_CONTROL_ORDER],
      topBar: [...TOP_BAR_PLAYBACK_CONTROL_ORDER],
    },
    surfaces: Object.fromEntries(
      Object.entries(PlaybackControlSurfaceDefinitions).map(
        ([surface, definition]) => [surface, cloneSurface(definition)],
      ),
    ),
    settingsSpec: Object.fromEntries(
      Object.entries(SETTINGS_SPEC).map(([key, spec]) => [
        key,
        {
          property: spec.property,
          read: spec.read,
          write: spec.write ?? null,
          impact: spec.impact ?? null,
        },
      ]),
    ),
    schema: manifest.schema,
    widgetFlags: { ...WidgetFlags },
    inputActions: { ...InputActions },
    inputDefinitions: INPUT_ACTION_DEFINITIONS.map((definition) => ({
      ...definition,
    })),
    mouseActionValues: [...MOUSE_ACTION_VALUES],
    mouseActionLabels: [
      ...(manifest.uiStringLists?.["model-input-actions"] ?? []),
    ],
    shortcutKeys: [...KEYBOARD_SHORTCUT_KEYS],
    playbackActionsByInput: { ...PLAYBACK_ACTION_BY_INPUT_ACTION },
    playbackActions: Object.values(PlaybackControlActions),
    relativeSeekSeconds: RELATIVE_SEEK_SECONDS,
    dbusSignatures: manifest.dbusSignatures,
  };
}

function validateDefinitions(snapshot, errors) {
  const ids = snapshot.controls.map(({ id }) => id);
  const actorNames = snapshot.controls.map(({ actorName }) => actorName);
  const expectedIds = Object.values(PlaybackControlIds);
  addMismatch(errors, "playback control IDs", ids, expectedIds);
  for (const duplicate of duplicateValues(ids))
    errors.push(`playback controls: duplicate ID ${duplicate}`);
  for (const duplicate of duplicateValues(actorNames))
    errors.push(`playback controls: duplicate actor name ${duplicate}`);

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

  addMismatch(
    errors,
    "primary playback controls",
    snapshot.controls.filter(({ isPrimary }) => isPrimary).map(({ id }) => id),
    [PlaybackControlIds.PLAY_PAUSE],
  );
  addMismatch(
    errors,
    "transport-adjacent controls",
    snapshot.controls
      .filter(({ isAdjacent }) => isAdjacent)
      .map(({ id }) => id),
    [PlaybackControlIds.SEEK_BACKWARD, PlaybackControlIds.SEEK_FORWARD],
  );
}

function validateOrdersAndSurfaces(snapshot, errors) {
  for (const [name, expected] of Object.entries(EXPECTED_ORDERS))
    addMismatch(errors, `${name} order`, snapshot.orders[name], expected);

  const knownIds = new Set(snapshot.controls.map(({ id }) => id));
  for (const [surface, definition] of Object.entries(snapshot.surfaces)) {
    const controlIds = definition.controls.map(({ controlId }) => controlId);
    for (const duplicate of duplicateValues(controlIds))
      errors.push(`${surface}: duplicate control policy ${duplicate}`);
    for (const controlId of controlIds) {
      if (!knownIds.has(controlId))
        errors.push(`${surface}: unknown control policy ${controlId}`);
    }
    const expectedIds = Object.keys(EXPECTED_CONTROL_DEFAULTS[surface]);
    addMismatch(errors, `${surface} control policy`, controlIds, expectedIds);

    for (const control of definition.controls) {
      const schemaKey = snapshot.schema.keys[control.settingKey];
      if (!schemaKey)
        errors.push(
          `${surface}/${control.controlId}: missing schema key ${control.settingKey}`,
        );
      else if (
        schemaKey.default !==
        EXPECTED_CONTROL_DEFAULTS[surface][control.controlId]
      )
        errors.push(`${control.settingKey}: unexpected first-install default`);

      const spec = snapshot.settingsSpec[control.settingKey];
      if (!spec)
        errors.push(`${control.settingKey}: missing runtime settings owner`);
      else if (
        spec.property !== control.property ||
        spec.impact !== control.impact ||
        spec.read !== "get_boolean"
      )
        errors.push(
          `${control.settingKey}: surface policy and SETTINGS_SPEC differ`,
        );

      const expectedSurfaceRequirement = !(
        surface === PlaybackControlSurfaces.POPUP &&
        control.controlId === PlaybackControlIds.SPEED
      );
      if (control.requiresSurfaceEnabled !== expectedSurfaceRequirement)
        errors.push(
          `${surface}/${control.controlId}: unexpected surface visibility dependency`,
        );
    }
  }

  if (
    snapshot.surfaces[PlaybackControlSurfaces.TOP_BAR].controls.some(
      ({ controlId }) => controlId === PlaybackControlIds.SPEED,
    )
  )
    errors.push("topbar: playback speed must remain popup-only");
}

function validateInputs(snapshot, errors) {
  addMismatch(
    errors,
    "persisted input enum",
    snapshot.inputActions,
    EXPECTED_INPUT_ACTIONS,
  );
  const schemaEnum =
    snapshot.schema.enums[`${snapshot.schema.id}.input-actions`];
  addMismatch(
    errors,
    "schema input enum",
    schemaEnum,
    Object.entries(EXPECTED_INPUT_ACTIONS).map(([nick, value]) => ({
      nick: LEGACY_INPUT_ACTION_SCHEMA_NICKS[value] ?? nick,
      value,
    })),
  );
  addMismatch(
    errors,
    "mouse action labels",
    snapshot.mouseActionLabels,
    EXPECTED_MOUSE_ACTION_LABELS,
  );
  addMismatch(errors, "mouse action values", snapshot.mouseActionValues, [
    InputActions.NONE,
    InputActions.TOGGLE_SHUFFLE,
    InputActions.SEEK_BACKWARD,
    InputActions.PREVIOUS_TRACK,
    InputActions.PLAY_PAUSE,
    InputActions.NEXT_TRACK,
    InputActions.SEEK_FORWARD,
    InputActions.TOGGLE_LOOP,
    InputActions.VOLUME_UP,
    InputActions.VOLUME_DOWN,
    InputActions.TOGGLE_POPUP,
    InputActions.OPEN_PREFERENCES,
    InputActions.RAISE_APP,
    InputActions.QUIT_APP,
    InputActions.SWITCH_APP,
  ]);

  const executableValues = snapshot.inputDefinitions.map(
    ({ action }) => action,
  );
  for (const reserved of [15, 16, 17]) {
    if (executableValues.includes(reserved))
      errors.push(`input action ${reserved}: reserved slot became executable`);
  }
  if (snapshot.shortcutKeys.length !== new Set(snapshot.shortcutKeys).size)
    errors.push("keyboard shortcut settings contain duplicates");
  for (const definition of snapshot.inputDefinitions) {
    if (!snapshot.schema.keys[definition.shortcutKey])
      errors.push(`${definition.id}: shortcut schema key is missing`);
    if (
      definition.playbackAction &&
      snapshot.playbackActionsByInput[definition.action] !==
        definition.playbackAction
    )
      errors.push(
        `${definition.id}: playback input mapping differs from its definition`,
      );
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
  const values = individual.map(([, value]) => value);
  for (const duplicate of duplicateValues(values))
    errors.push(`widget flags: duplicate individual bit ${duplicate}`);
}

function validateDbus(snapshot, errors) {
  const player = snapshot.dbusSignatures[MPRIS_PLAYER_IFACE_NAME];
  if (!player) {
    errors.push(`${MPRIS_PLAYER_IFACE_NAME}: parsed interface is missing`);
    return;
  }
  addMismatch(
    errors,
    "MPRIS Seek signature",
    player.method[MprisPlayerMethods.SEEK],
    [{ name: "Offset", type: "x", direction: "in" }],
  );
  addMismatch(
    errors,
    "MPRIS SetPosition signature",
    player.method[MprisPlayerMethods.SET_POSITION],
    [
      { name: "TrackId", type: "o", direction: "in" },
      { name: "Position", type: "x", direction: "in" },
    ],
  );
  addMismatch(
    errors,
    "MPRIS Seeked signature",
    player.signal[MprisPlayerSignals.SEEKED],
    [{ name: "Position", type: "x", direction: null }],
  );
  addMismatch(
    errors,
    "MPRIS Position property",
    player.property[MprisPlayerProperties.POSITION],
    {
      type: "x",
      access: "read",
    },
  );
}

/** Validates a serialized playback contract snapshot. */
export function validatePlaybackContractSnapshot(snapshot) {
  const errors = [];
  validateDefinitions(snapshot, errors);
  validateOrdersAndSurfaces(snapshot, errors);
  validateInputs(snapshot, errors);
  validateFlags(snapshot, errors);
  validateDbus(snapshot, errors);

  if (snapshot.relativeSeekSeconds !== 10)
    errors.push("relative seek interval must remain fixed at 10 seconds");
  if (!snapshot.schema.keys[SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW])
    errors.push("popup playback-speed setting is missing");
  return errors;
}
