/**
 * @file contracts.mjs
 * @module scripts.dev.contracts
 *
 * Validates metadata, settings, GtkBuilder bindings, enums, and project identity.
 *
 * Runtime declarative tables are compared with a Python-parsed XML manifest,
 * making schema types, ranges, defaults, enum values, and widget classes real
 * cross-file contracts instead of textual search conventions.
 */

import { PREFERENCE_WIDGET_BINDINGS } from "../../src/prefs/bindings/preferenceBindings.js";
import { PREFERENCE_PAGE_IDS } from "../../src/prefs/constants/preferencesUi.js";
import { GTypeNames } from "../../src/shared/gobject.js";
import {
  DBUS_DAEMON_IFACE_NAME,
  DBUS_PROPERTIES_IFACE_NAME,
  DbusDaemonMethods,
  DbusPropertiesMethods,
  DbusDaemonSignals,
} from "../../src/shell/mpris/dbus.js";
import {
  MPRIS_ROOT_IFACE_NAME,
  MPRIS_PLAYER_IFACE_NAME,
  MprisPlayerProperties,
  MprisPlayerMethods,
  MprisPlayerSignals,
  MprisRootMethods,
  MPRIS_PLAYER_PROPERTY_NAMES,
  MPRIS_ROOT_PROPERTY_NAMES,
} from "../../src/shell/mpris/protocol.js";
import {
  INPUT_ACTION_DEFINITIONS,
  KEYBOARD_SHORTCUT_KEYS,
} from "../../src/shared/input/actions.js";
import {
  NativeMediaControlsModes,
  NUMERIC_SETTING_CONSTRAINTS,
  ORDERED_SETTING_DEFAULTS,
  TOP_BAR_ELEMENT_ORDER_DEFAULT,
} from "../../src/shared/settings/contract.js";
import { InputActions } from "../../src/shared/input/types.js";
import { PanelPositions } from "../../src/shell/ui/indicator/panelPosition.js";
import { TopBarElementIds } from "../../src/shared/ui/topBar.js";
import { VisualizerStyles } from "../../src/shell/ui/components/visualizer/types.js";
import { RUNTIME_SETTING_CONTRACT } from "../../src/shell/settings/settings.js";
import { collectBuilderObjectReferences } from "./javascript.mjs";
import { fail, read, readAssetManifest } from "./files.mjs";
import { validateExtensionMetadata } from "./metadata.mjs";

const PREFERENCES_UI_SOURCE = "assets/ui/prefs.ui";

const EXPECTED_READ_METHODS = Object.freeze({
  b: "get_boolean",
  u: "get_uint",
  as: "get_strv",
  enum: "get_enum",
});

const BINDING_WIDGET_CLASSES = Object.freeze({
  value: new Set(["AdwSpinRow"]),
  active: new Set(["AdwSwitchRow", "GtkSwitch"]),
  selected: new Set(["AdwComboRow"]),
  "input-action-selected": new Set(["AdwComboRow"]),
  accelerator: new Set(["GtkShortcutLabel"]),
  "enable-expansion": new Set(["AdwExpanderRow"]),
});

function compareEnum(errors, enumId, actual, expected) {
  if (!actual) {
    errors.push(`schema enum is missing: ${enumId}`);
    return;
  }
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    errors.push(
      `schema enum ${enumId} differs from its JavaScript enum: ` +
        `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`,
    );
}

function validateTopBarElementOrderContract() {
  const errors = [];
  const elementIds = Object.values(TopBarElementIds);
  const uniqueElementIds = new Set(elementIds);
  const defaultElementIds = new Set(TOP_BAR_ELEMENT_ORDER_DEFAULT);

  if (uniqueElementIds.size !== elementIds.length)
    errors.push("top bar element IDs must be unique");
  if (
    defaultElementIds.size !== TOP_BAR_ELEMENT_ORDER_DEFAULT.length ||
    defaultElementIds.size !== uniqueElementIds.size ||
    elementIds.some((elementId) => !defaultElementIds.has(elementId))
  )
    errors.push(
      "top bar element order default must contain each canonical ID exactly once",
    );

  return errors;
}

/**
 * Validates runtime D-Bus contracts against parsed introspection data.
 *
 * @param {object} interfaces - Parsed interface/member manifest.
 * @returns {string[]} Contract errors.
 */
export function validateDbusContracts(interfaces) {
  const errors = [];
  const contracts = [
    [
      DBUS_DAEMON_IFACE_NAME,
      {
        method: Object.values(DbusDaemonMethods),
        signal: Object.values(DbusDaemonSignals),
      },
    ],
    [
      DBUS_PROPERTIES_IFACE_NAME,
      { method: Object.values(DbusPropertiesMethods) },
    ],
    [
      MPRIS_ROOT_IFACE_NAME,
      {
        method: Object.values(MprisRootMethods),
        property: MPRIS_ROOT_PROPERTY_NAMES,
      },
    ],
    [
      MPRIS_PLAYER_IFACE_NAME,
      {
        method: Object.values(MprisPlayerMethods),
        signal: Object.values(MprisPlayerSignals),
        property: [
          ...MPRIS_PLAYER_PROPERTY_NAMES,
          MprisPlayerProperties.POSITION,
        ],
      },
    ],
  ];

  for (const [interfaceName, expectedGroups] of contracts) {
    const interfaceMembers = interfaces[interfaceName];
    if (!interfaceMembers) {
      errors.push(`runtime D-Bus interface is missing: ${interfaceName}`);
      continue;
    }
    for (const [memberType, expectedMembers] of Object.entries(
      expectedGroups,
    )) {
      const actualMembers = new Set(interfaceMembers[memberType] ?? []);
      for (const member of expectedMembers) {
        if (!actualMembers.has(member))
          errors.push(
            `${interfaceName}: runtime ${memberType} is missing from introspection: ${member}`,
          );
      }
    }
  }
  return errors;
}

export async function checkExtensionContracts() {
  const metadata = JSON.parse(await read("src/metadata.json"));
  const packageJson = JSON.parse(await read("package.json"));
  const manifest = readAssetManifest();
  const errors = validateExtensionMetadata(metadata, packageJson);
  if (metadata["settings-schema"] !== manifest.schema.id)
    errors.push("metadata settings-schema differs from the parsed XML schema");

  fail("Extension contract validation", errors);
  console.log("Extension identity, metadata, and platform contracts passed.");
}

/**
 * Validates schema ownership and runtime setting tables.
 *
 * @param {object} contract - Parsed schema and JavaScript-owned tables.
 * @returns {string[]} Contract errors.
 */
export function validateSettingContractTables({
  schema,
  runtimeSettings,
  preferenceBindings,
  shortcutKeys,
  numericConstraints,
  orderedDefaults,
}) {
  const schemaKeys = new Set(Object.keys(schema.keys));
  const runtimeKeys = Object.keys(runtimeSettings);
  const preferenceKeys = preferenceBindings.map(([key]) => key);
  const shortcutKeySet = new Set(shortcutKeys);
  const errors = [];

  for (const key of new Set([
    ...runtimeKeys,
    ...preferenceKeys,
    ...shortcutKeys,
  ])) {
    if (!schemaKeys.has(key))
      errors.push(`code references missing schema key: ${key}`);
  }

  for (const key of schemaKeys) {
    if (
      !runtimeKeys.includes(key) &&
      !preferenceKeys.includes(key) &&
      !shortcutKeySet.has(key)
    )
      errors.push(`schema key has no maintained code owner: ${key}`);
  }

  const runtimeProperties = new Map();
  for (const [key, spec] of Object.entries(runtimeSettings)) {
    const schemaKey = schema.keys[key];
    if (!schemaKey) continue;
    const schemaType = schemaKey.enum ? "enum" : schemaKey.type;
    const expectedRead = EXPECTED_READ_METHODS[schemaType];
    if (spec.read !== expectedRead)
      errors.push(
        `${key}: runtime settings read method ${spec.read} must be ${expectedRead}`,
      );
    const previousKey = runtimeProperties.get(spec.property);
    if (previousKey)
      errors.push(
        `${key}: runtime property ${spec.property} is already owned by ${previousKey}`,
      );
    else runtimeProperties.set(spec.property, key);
  }

  for (const [key, bounds] of Object.entries(numericConstraints)) {
    const schemaKey = schema.keys[key];
    if (!schemaKey) {
      errors.push(`numeric setting contract references missing key: ${key}`);
      continue;
    }
    const expectedRange = { min: bounds.MIN, max: bounds.MAX };
    if (JSON.stringify(schemaKey.range) !== JSON.stringify(expectedRange))
      errors.push(
        `${key}: schema range ${JSON.stringify(schemaKey.range)} differs ` +
          `from ${JSON.stringify(expectedRange)}`,
      );
    if (schemaKey.default !== bounds.DEFAULT)
      errors.push(
        `${key}: schema default ${schemaKey.default} differs from ${bounds.DEFAULT}`,
      );
  }

  for (const [key, fallback] of Object.entries(orderedDefaults)) {
    const schemaDefault = schema.keys[key]?.default;
    if (JSON.stringify(schemaDefault) !== JSON.stringify(fallback))
      errors.push(`${key}: schema default differs from shared ordered default`);
  }

  return errors;
}

export async function checkSettingsContracts() {
  const manifest = readAssetManifest();
  const schema = manifest.schema;
  const errors = [];
  errors.push(...validateDbusContracts(manifest.dbusInterfaces));
  errors.push(...validateTopBarElementOrderContract());
  errors.push(
    ...validateSettingContractTables({
      schema,
      runtimeSettings: RUNTIME_SETTING_CONTRACT,
      preferenceBindings: PREFERENCE_WIDGET_BINDINGS,
      shortcutKeys: KEYBOARD_SHORTCUT_KEYS,
      numericConstraints: NUMERIC_SETTING_CONSTRAINTS,
      orderedDefaults: ORDERED_SETTING_DEFAULTS,
    }),
  );

  const uiObjects = manifest.uiObjectsBySource?.[PREFERENCES_UI_SOURCE] ?? {};
  const allUiObjects = Object.values(manifest.uiObjectsBySource ?? {}).flatMap(
    (objects) => Object.values(objects),
  );
  const seenBindingKeys = new Set();
  const seenBindingWidgets = new Set();
  for (const [key, widgetId, property] of PREFERENCE_WIDGET_BINDINGS) {
    if (seenBindingKeys.has(key))
      errors.push(`duplicate preference binding for schema key: ${key}`);
    seenBindingKeys.add(key);
    if (seenBindingWidgets.has(widgetId))
      errors.push(`duplicate preference binding for widget: ${widgetId}`);
    seenBindingWidgets.add(widgetId);

    const widget = uiObjects[widgetId];
    if (!widget) {
      errors.push(`preference binding references unknown widget: ${widgetId}`);
      continue;
    }
    const allowedClasses = BINDING_WIDGET_CLASSES[property];
    if (!allowedClasses)
      errors.push(`preference binding uses unsupported property: ${property}`);
    else if (!allowedClasses.has(widget.class))
      errors.push(
        `${widgetId}: ${property} binding is incompatible with ${widget.class}`,
      );
  }

  for (const reference of await collectBuilderObjectReferences()) {
    if (!uiObjects[reference.id])
      errors.push(
        `${reference.file}:${reference.line}: unknown GtkBuilder object ${reference.id}`,
      );
  }
  for (const pageId of PREFERENCE_PAGE_IDS) {
    if (uiObjects[pageId]?.class !== "AdwPreferencesPage")
      errors.push(`required preferences page is missing: ${pageId}`);
  }

  const registeredGTypeNames = Object.values(GTypeNames);
  const registeredGTypes = new Set(registeredGTypeNames);
  if (registeredGTypes.size !== registeredGTypeNames.length)
    errors.push("shared GType names are not unique");
  const customUiClasses = new Set(
    allUiObjects
      .map((object) => object.class)
      .filter((className) => className?.startsWith("MediaShell")),
  );
  for (const className of customUiClasses) {
    if (!registeredGTypes.has(className))
      errors.push(
        `GtkBuilder custom class has no GType registration: ${className}`,
      );
  }

  const schemaPrefix = schema.id;
  compareEnum(
    errors,
    `${schemaPrefix}.input-actions`,
    schema.enums[`${schemaPrefix}.input-actions`],
    Object.entries(InputActions).map(([nick, value]) => ({ nick, value })),
  );
  compareEnum(
    errors,
    `${schemaPrefix}.visualizer-styles`,
    schema.enums[`${schemaPrefix}.visualizer-styles`],
    Object.entries(VisualizerStyles).map(([nick, value]) => ({ nick, value })),
  );
  compareEnum(
    errors,
    `${schemaPrefix}.panel-positions`,
    schema.enums[`${schemaPrefix}.panel-positions`],
    Object.keys(PanelPositions).map((key, value) => ({
      nick: `${key[0]}${key.slice(1).toLowerCase()}`,
      value,
    })),
  );
  compareEnum(
    errors,
    `${schemaPrefix}.native-media-controls-modes`,
    schema.enums[`${schemaPrefix}.native-media-controls-modes`],
    Object.keys(NativeMediaControlsModes).map((nick, value) => ({
      nick,
      value,
    })),
  );

  fail("Settings and UI contract validation", errors);
  console.log(
    "Schema types, defaults, bounds, enums, bindings, and UI references passed.",
  );
}
