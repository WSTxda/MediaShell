import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { InputActions } from "../src/shared/enums/MediaShellEnums.js";
import { migrateSettings, SETTINGS_SCHEMA_VERSION } from "../src/shared/settings/SettingsMigration.js";

class MockSettings {
  constructor(values = {}, userKeys = []) {
    this.values = new Map(Object.entries(values));
    this.userKeys = new Set(userKeys);
  }

  get_uint(key) {
    return this.values.get(key) ?? 0;
  }

  set_uint(key, value) {
    this.values.set(key, value);
    this.userKeys.add(key);
  }

  get_enum(key) {
    return this.values.get(key) ?? 0;
  }

  set_enum(key, value) {
    this.values.set(key, value);
    this.userKeys.add(key);
  }

  get_user_value(key) {
    return this.userKeys.has(key) ? this.values.get(key) : null;
  }

  get_value(key) {
    return this.values.get(key);
  }

  set_value(key, value) {
    this.values.set(key, value);
    this.userKeys.add(key);
  }

  get_strv(key) {
    return [...(this.values.get(key) ?? [])];
  }

  set_strv(key, value) {
    this.values.set(key, [...value]);
    this.userKeys.add(key);
  }
}

const schema = await readFile("assets/org.gnome.shell.extensions.mediashell.gschema.xml", "utf8");

function schemaEnumValues(enumId) {
  const escapedEnumId = enumId.replaceAll(".", "\\.");
  const block = schema.match(new RegExp(`<enum\\s+id="${escapedEnumId}">([\\s\\S]*?)<\\/enum>`))?.[1];
  assert.ok(block, `Schema enum not found: ${enumId}`);
  return new Map(
    [...block.matchAll(/<value nick="([A-Z_]+)" value="(\d+)" \/>/g)].map(([, nick, value]) => [
      nick,
      Number(value),
    ]),
  );
}

const inputActionValues = schemaEnumValues("org.gnome.shell.extensions.mediashell.input-actions");
const inputActionKeys = [
  "mouse-action-left",
  "mouse-action-middle",
  "mouse-action-right",
  "mouse-action-double",
  "mouse-action-scroll-up",
  "mouse-action-scroll-down",
];

function migrateInputActionValue(value, version = 5) {
  const settings = new MockSettings(
    {
      "settings-schema-version": version,
      ...Object.fromEntries(inputActionKeys.map((key) => [key, value])),
    },
    inputActionKeys,
  );
  assert.equal(migrateSettings(settings), true);
  return inputActionKeys.map((key) => settings.get_enum(key));
}

test("historical input-action enum nicks retain their semantic meaning", () => {
  // GSettings persists an enum's nick string. After a schema update, get_enum()
  // resolves that stored nick through the current schema, so numeric positions
  // from an older schema must never be migrated directly.
  const unchangedHistoricalNicks = {
    NONE: InputActions.NONE,
    PLAY_PAUSE: InputActions.PLAY_PAUSE,
    NEXT_TRACK: InputActions.NEXT_TRACK,
    PREVIOUS_TRACK: InputActions.PREVIOUS_TRACK,
    VOLUME_UP: InputActions.VOLUME_UP,
    VOLUME_DOWN: InputActions.VOLUME_DOWN,
    TOGGLE_LOOP: InputActions.TOGGLE_LOOP,
    TOGGLE_SHUFFLE: InputActions.TOGGLE_SHUFFLE,
    RAISE_APP: InputActions.RAISE_APP,
    QUIT_APP: InputActions.QUIT_APP,
    OPEN_PREFERENCES: InputActions.OPEN_PREFERENCES,
  };

  for (const [nick, expectedValue] of Object.entries(unchangedHistoricalNicks)) {
    assert.equal(inputActionValues.get(nick), expectedValue, `${nick} changed semantic identity`);
    assert.deepEqual(migrateInputActionValue(expectedValue), Array(6).fill(expectedValue));
  }

  const retiredHistoricalNicks = {
    PLAY: InputActions.PLAY_PAUSE,
    PAUSE: InputActions.PLAY_PAUSE,
    SHOW_POPUP: InputActions.TOGGLE_POPUP,
    QUIT_PLAYER: InputActions.QUIT_APP,
    RAISE_PLAYER: InputActions.RAISE_APP,
  };
  for (const [nick, expectedValue] of Object.entries(retiredHistoricalNicks)) {
    const currentSchemaValue = inputActionValues.get(nick);
    assert.notEqual(currentSchemaValue, undefined, `${nick} must remain readable until migration`);
    assert.deepEqual(migrateInputActionValue(currentSchemaValue), Array(6).fill(expectedValue));
  }
});

test("version 0 migration copies legacy values without overwriting current user values", () => {
  const settings = new MockSettings(
    {
      "settings-schema-version": 0,
      "label-width": 320,
      "top-bar-track-information-width": 480,
      "elements-order": ["LABEL", "ICON", "CONTROLS"],
      "blacklisted-players": ["org.example.MediaApp.desktop"],
      "mediacontrols-show-popup-menu": ["<Super>m"],
      "mouse-action-left": inputActionValues.get("RAISE_PLAYER"),
      "mouse-action-middle": inputActionValues.get("QUIT_PLAYER"),
      "mouse-action-right": inputActionValues.get("RAISE_PLAYER"),
      "mouse-action-double": InputActions.NONE,
      "mouse-action-scroll-up": InputActions.TOGGLE_LOOP,
      "mouse-action-scroll-down": InputActions.TOGGLE_SHUFFLE,
    },
    [
      "label-width",
      "top-bar-track-information-width",
      "elements-order",
      "blacklisted-players",
      "mediacontrols-show-popup-menu",
      "mouse-action-left",
      "mouse-action-middle",
      "mouse-action-right",
    ],
  );

  assert.equal(migrateSettings(settings), true);
  assert.equal(settings.get_uint("settings-schema-version"), SETTINGS_SCHEMA_VERSION);
  assert.equal(settings.get_uint("top-bar-track-information-width"), 480);
  assert.deepEqual(settings.get_strv("top-bar-element-order"), [
    "TRACK_INFORMATION",
    "APP_ICON",
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
  ]);
  assert.deepEqual(settings.get_strv("blocked-apps"), ["org.example.MediaApp.desktop"]);
  assert.deepEqual(settings.get_strv("shortcut-toggle-popup"), ["<Super>m"]);
  assert.equal(settings.get_enum("mouse-action-left"), InputActions.RAISE_APP);
  assert.equal(settings.get_enum("mouse-action-middle"), InputActions.QUIT_APP);
  assert.equal(settings.get_enum("mouse-action-right"), InputActions.RAISE_APP);
  assert.equal(migrateSettings(settings), false);
});

test("each historical migration boundary runs only the remaining steps", () => {
  const versionOne = new MockSettings(
    {
      "settings-schema-version": 1,
      "label-width": 360,
      "mouse-action-left": inputActionValues.get("RAISE_PLAYER"),
      "mouse-action-right": inputActionValues.get("QUIT_PLAYER"),
    },
    ["label-width", "mouse-action-left", "mouse-action-right"],
  );
  assert.equal(migrateSettings(versionOne), true);
  assert.equal(versionOne.get_user_value("top-bar-track-information-width"), null);
  assert.equal(versionOne.get_enum("mouse-action-left"), InputActions.RAISE_APP);
  assert.equal(versionOne.get_enum("mouse-action-right"), InputActions.QUIT_APP);

  const versionTwo = new MockSettings(
    {
      "settings-schema-version": 2,
      "top-bar-track-information-lock-width": true,
      "top-bar-colored-app-icon": false,
      "popup-colored-app-icon": false,
      "top-bar-elements-order": ["PLAYBACK_CONTROLS", "TRACK_INFORMATION", "APP_ICON"],
      "extension-position": 2,
      "extension-index": 7,
    },
    [
      "top-bar-track-information-lock-width",
      "top-bar-colored-app-icon",
      "popup-colored-app-icon",
      "top-bar-elements-order",
      "extension-position",
      "extension-index",
    ],
  );
  assert.equal(migrateSettings(versionTwo), true);
  assert.equal(versionTwo.get_user_value("lock-top-bar-track-information-width"), true);
  assert.equal(versionTwo.get_user_value("use-colored-top-bar-app-icon"), false);
  assert.equal(versionTwo.get_user_value("use-colored-popup-app-icon"), false);
  assert.equal(versionTwo.get_enum("top-bar-position"), 2);
  assert.equal(versionTwo.get_uint("top-bar-index"), 7);
  assert.deepEqual(versionTwo.get_strv("top-bar-element-order"), [
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
    "TRACK_INFORMATION",
    "APP_ICON",
  ]);

  const versionFour = new MockSettings(
    { "settings-schema-version": 4, "toggle-popup-shortcut": ["<Ctrl><Alt>m"] },
    ["toggle-popup-shortcut"],
  );
  assert.equal(migrateSettings(versionFour), true);
  assert.deepEqual(versionFour.get_strv("shortcut-toggle-popup"), ["<Ctrl><Alt>m"]);

  const versionFive = new MockSettings(
    {
      "settings-schema-version": 5,
      "shortcut-show-popup": ["<Super>p"],
      "mouse-action-left": inputActionValues.get("SHOW_POPUP"),
      "mouse-action-middle": inputActionValues.get("PLAY"),
      "mouse-action-right": inputActionValues.get("PAUSE"),
      "mouse-action-double": inputActionValues.get("RAISE_PLAYER"),
      "mouse-action-scroll-up": inputActionValues.get("QUIT_PLAYER"),
    },
    [
      "shortcut-show-popup",
      "mouse-action-left",
      "mouse-action-middle",
      "mouse-action-right",
      "mouse-action-double",
      "mouse-action-scroll-up",
    ],
  );
  assert.equal(migrateSettings(versionFive), true);
  assert.deepEqual(versionFive.get_strv("shortcut-toggle-popup"), ["<Super>p"]);
  assert.equal(versionFive.get_enum("mouse-action-left"), InputActions.TOGGLE_POPUP);
  assert.equal(versionFive.get_enum("mouse-action-middle"), InputActions.PLAY_PAUSE);
  assert.equal(versionFive.get_enum("mouse-action-right"), InputActions.PLAY_PAUSE);
  assert.equal(versionFive.get_enum("mouse-action-double"), InputActions.RAISE_APP);
  assert.equal(versionFive.get_enum("mouse-action-scroll-up"), InputActions.QUIT_APP);

  const versionSix = new MockSettings(
    {
      "settings-schema-version": 6,
      "top-bar-element-order": ["APP_ICON", "TRACK_INFORMATION", "PLAYBACK_CONTROLS"],
    },
    ["top-bar-element-order"],
  );
  assert.equal(migrateSettings(versionSix), true);
  assert.deepEqual(versionSix.get_strv("top-bar-element-order"), [
    "APP_ICON",
    "TRACK_INFORMATION",
    "VISUALIZER",
    "PLAYBACK_CONTROLS",
  ]);

  for (const version of [7, 8]) {
    const settings = new MockSettings({ "settings-schema-version": version });
    assert.equal(migrateSettings(settings), true);
    assert.equal(settings.get_uint("settings-schema-version"), SETTINGS_SCHEMA_VERSION);
    assert.equal(settings.get_user_value("top-bar-visualizer-speed"), null);
    assert.equal(settings.get_user_value("show-popup-track-information"), null);
    assert.equal(migrateSettings(settings), false);
  }
});

test("current schema migration is a no-op", () => {
  const settings = new MockSettings({ "settings-schema-version": SETTINGS_SCHEMA_VERSION });
  assert.equal(migrateSettings(settings), false);
  assert.equal(settings.get_uint("settings-schema-version"), SETTINGS_SCHEMA_VERSION);
});
