// Runs the complete MediaShell validation suite from one maintained JavaScript entry point.

// Verifies that every maintained JavaScript module can be parsed by the repository Node.js baseline.
async function checkSyntax() {
  const { spawnSync } = await import("node:child_process");
  const { readdir } = await import("node:fs/promises");
  const { extname, join } = await import("node:path");

  const INCLUDED_EXTENSIONS = new Set([".js", ".mjs"]);
  const SOURCE_DIRECTORIES = ["src", "scripts", "tests"];

  async function collect(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(path)));
      else if (INCLUDED_EXTENSIONS.has(extname(entry.name))) files.push(path);
    }
    return files;
  }

  const files = (await Promise.all(SOURCE_DIRECTORIES.map(collect))).flat().sort();
  for (const file of files) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
  console.log(`Syntax check passed for ${files.length} JavaScript modules across runtime, checks, and tests.`);
}

// Verifies JavaScript import targets, runtime process boundaries, and circular dependencies.
async function checkImports() {
  const { readFile, readdir, stat } = await import("node:fs/promises");
  const { dirname, extname, join, normalize, relative, resolve } = await import("node:path");

  async function collect(directory) {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) files.push(...(await collect(path)));
      else if (extname(entry.name) === ".js") files.push(path);
    }
    return files;
  }

  async function exists(path) {
    try {
      return (await stat(path)).isFile();
    } catch (_) {
      return false;
    }
  }

  const files = await collect("src");
  const errors = [];
  const dependencyGraph = new Map(files.map((file) => [resolve(file), []]));
  const importPattern = /(?:\b(?:import|export)\s+(?:[^"'()]*?\s+from\s+)?|\bimport\s*\()(["'])([^"']+)\1/g;

  for (const file of files) {
    const source = await readFile(file, "utf8");

    for (const match of source.matchAll(importPattern)) {
      const specifier = match[2];
      if (specifier.startsWith(".")) {
        const target = normalize(resolve(dirname(file), specifier));
        if (!(await exists(target))) errors.push(`${file}: missing relative import ${specifier}`);
        else if (dependencyGraph.has(target)) dependencyGraph.get(resolve(file)).push(target);
      }
    }

    if (/\b(?:const|let|var)\s+imports\b|\bimports\.(?:ui|misc|gi)\b/.test(source))
      errors.push(`${file}: legacy GJS imports are not allowed`);

    const normalizedFile = file.replaceAll("\\", "/");
    if (normalizedFile.startsWith("src/shared/")) {
      if (/from\s+["'](?:gi|resource):/.test(source))
        errors.push(`${file}: shared modules must not import GNOME runtime APIs`);
    }

    if (normalizedFile === "src/prefs.js" || normalizedFile.startsWith("src/prefs/")) {
      if (
        /resource:\/\/\/org\/gnome\/shell\/ui\//.test(source) ||
        /gi:\/\/(?:St|Clutter|Shell|Meta)(?:\?|["'])/.test(source)
      ) {
        errors.push(`${file}: preferences code imports a Shell-only API`);
      }
    }

    if (
      normalizedFile.startsWith("src/prefs/") &&
      /resource:\/\/\/org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js/.test(source)
    ) {
      errors.push(`${file}: nested preferences modules must use PreferencesTranslations instead of Shell helpers`);
    }

    if (normalizedFile === "src/extension.js" || normalizedFile.startsWith("src/shell/")) {
      if (
        /gi:\/\/(?:Gtk|Adw|Gdk|Graphene)(?:\?|["'])/.test(source) ||
        /org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js/.test(source)
      ) {
        errors.push(`${file}: Shell code imports a preferences-only API`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();

  function visit(file, stack = []) {
    if (visiting.has(file)) {
      const cycleStart = stack.indexOf(file);
      const cycle = [...stack.slice(cycleStart), file].map((entry) => relative(process.cwd(), entry));
      errors.push(`Circular relative import: ${cycle.join(" -> ")}`);
      return;
    }
    if (visited.has(file)) return;

    visiting.add(file);
    stack.push(file);
    for (const dependency of dependencyGraph.get(file) ?? []) visit(dependency, stack);
    stack.pop();
    visiting.delete(file);
    visited.add(file);
  }

  for (const file of dependencyGraph.keys()) visit(file);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log(`Import and process-boundary checks passed for ${files.length} JavaScript files.`);
}

// Enforces the declared GNOME Shell 47-50 and Libadwaita 1.6 compatibility baseline.
async function checkCompatibility() {
  const { default: assert } = await import("node:assert/strict");
  const { readFile, readdir } = await import("node:fs/promises");
  const { extname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { MINIMUM_LIBADWAITA_VERSION, SUPPORTED_GNOME_SHELL_VERSIONS } = await import("../src/shared/constants/platform.js");

  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const EXPECTED_SHELL_VERSIONS = ["47", "48", "49", "50"];
  const EXPECTED_LIBADWAITA_VERSION = { major: 1, minor: 6 };
  const PRE_BASELINE_SHELL_VERSION = String(Number(EXPECTED_SHELL_VERSIONS[0]) - 1);
  const ALLOWED_ADWAITA_JS_MEMBERS = new Set([
    "AboutDialog",
    "ActionRow",
    "AlertDialog",
    "ButtonRow",
    "ComboRow",
    "Dialog",
    "EntryRow",
    "ExpanderRow",
    "HeaderBar",
    "PreferencesGroup",
    "PreferencesPage",
    "ResponseAppearance",
    "Toast",
    "ToolbarView",
    "get_major_version",
    "get_minor_version",
  ]);
  const ALLOWED_ADWAITA_UI_CLASSES = new Set([
    "AdwActionRow",
    "AdwButtonContent",
    "AdwButtonRow",
    "AdwComboRow",
    "AdwExpanderRow",
    "AdwPreferencesGroup",
    "AdwPreferencesPage",
    "AdwSpinRow",
    "AdwSwitchRow",
  ]);

  async function read(path) {
    return readFile(join(ROOT, path), "utf8");
  }

  async function collect(directory, include) {
    const files = [];
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      const path = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) files.push(...(await collect(path, include)));
      else if (include(path)) files.push(path);
    }
    return files;
  }

  assert.deepEqual(
    SUPPORTED_GNOME_SHELL_VERSIONS,
    EXPECTED_SHELL_VERSIONS,
    "The shared platform policy must remain GNOME Shell 47-50",
  );
  assert.deepEqual(
    MINIMUM_LIBADWAITA_VERSION,
    EXPECTED_LIBADWAITA_VERSION,
    "The shared platform policy must remain Libadwaita 1.6",
  );

  const metadata = JSON.parse(await read("src/metadata.json"));
  assert.deepEqual(
    metadata["shell-version"],
    EXPECTED_SHELL_VERSIONS,
    "metadata.json must declare exactly the tested GNOME Shell 47-50 range",
  );

  const prefsEntry = await read("src/prefs.js");
  assert.match(prefsEntry, /import Adw from "gi:\/\/Adw"/);
  assert.match(prefsEntry, /assertSupportedLibadwaita\(\)/);
  assert.match(prefsEntry, /Adw\.get_major_version\(\)/);
  assert.match(prefsEntry, /Adw\.get_minor_version\(\)/);
  assert.match(prefsEntry, /async fillPreferencesWindow\(preferencesWindow\)/);

  const preferenceFiles = ["src/prefs.js", ...(await collect("src/prefs", (path) => extname(path) === ".js"))];
  for (const file of preferenceFiles) {
    const source = await read(file);
    for (const match of source.matchAll(/\bAdw\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
      assert.ok(ALLOWED_ADWAITA_JS_MEMBERS.has(match[1]), `${file}: unreviewed Libadwaita API Adw.${match[1]}`);
    }
    assert.doesNotMatch(source, /\bAdw\.MessageDialog\b/, `${file}: Adw.MessageDialog is below the project baseline`);
    assert.doesNotMatch(
      source,
      /typeof\s+Adw\.|\bAdw\?\./,
      `${file}: Libadwaita feature detection below 1.6 is not allowed`,
    );
  }

  for (const file of await collect("assets/ui", (path) => extname(path) === ".ui")) {
    const source = await read(file);
    for (const match of source.matchAll(/(?:class|parent)="(Adw[A-Za-z0-9]+)"/g)) {
      assert.ok(ALLOWED_ADWAITA_UI_CLASSES.has(match[1]), `${file}: unreviewed Libadwaita UI class ${match[1]}`);
    }
  }

  const shellSourceFiles = ["src/extension.js", ...(await collect("src/shell", (path) => extname(path) === ".js"))];
  for (const file of shellSourceFiles) {
    const source = await read(file);
    assert.doesNotMatch(
      source,
      /(?:^|[,{]\s*)vertical\s*:/m,
      `${file}: St/Clutter actors must use orientation instead of the deprecated vertical property`,
    );
    assert.doesNotMatch(
      source,
      /\.set_vertical\s*\(/,
      `${file}: St/Clutter actors must use set_orientation instead of deprecated set_vertical`,
    );
  }
  const shellSource = (await Promise.all(shellSourceFiles.map((file) => read(file)))).join("\n");
  for (const [pattern, label] of [
    [/\bClutter\.Color\b/, "Clutter.Color removed in GNOME Shell 47"],
    [/\bMeta\.Rectangle\b/, "Meta.Rectangle removed in GNOME Shell 49"],
    [/\b(?:holdKeyboard|releaseKeyboard)\s*\(/, "keyboard manager API removed in GNOME Shell 50"],
    [
      /resource:\/\/\/org\/gnome\/shell\/ui\/calendar\.js.*(?:NotificationMessage|MediaMessage)/,
      "message type moved in GNOME Shell 48",
    ],
  ]) {
    assert.doesNotMatch(shellSource, pattern, label);
  }

  const policyFiles = [
    "README.md",
    ...(await collect("docs", (path) => extname(path) === ".md")),
    ...(await collect(".github/ISSUE_TEMPLATE", (path) => extname(path) === ".md")),
    ...(await collect("src", (path) => [".js", ".json"].includes(extname(path)))),
  ];
  const policyText = (await Promise.all(policyFiles.map((file) => read(file)))).join("\n");
  const preBaselineShellPattern = new RegExp(
    `\\bGNOME(?: Shell)? ${PRE_BASELINE_SHELL_VERSION}\\b|["']${PRE_BASELINE_SHELL_VERSION}["']`,
  );
  assert.doesNotMatch(
    policyText,
    preBaselineShellPattern,
    "The current tree must not advertise or encode support below the declared Shell baseline",
  );
  assert.doesNotMatch(
    policyText,
    /\bLibadwaita 1\.[0-5]\b/i,
    "The current tree must not advertise a pre-1.6 Libadwaita baseline",
  );

  const docs = (
    await Promise.all(["README.md", ...(await collect("docs", (path) => extname(path) === ".md"))].map(read))
  ).join("\n");
  for (const requiredStatement of ["GNOME Shell 47–50", "Libadwaita 1.6"]) {
    assert.ok(docs.includes(requiredStatement), `Documentation must state ${requiredStatement}`);
  }

  console.log(
    `Compatibility check passed for GNOME Shell ${EXPECTED_SHELL_VERSIONS.join("-")} and Libadwaita ${EXPECTED_LIBADWAITA_VERSION.major}.${EXPECTED_LIBADWAITA_VERSION.minor}; all Adwaita APIs are baseline-reviewed.`,
  );
}

// Verifies GSettings schema, defaults, migrations, enums, and preference widget bindings.
async function checkSettings() {
  const { default: assert } = await import("node:assert/strict");
  const { readFile } = await import("node:fs/promises");
  const { KEYBOARD_SHORTCUT_KEYS } = await import("../src/shared/constants/inputActions.js");
  const { InputActions, VisualizerStyles } = await import("../src/shared/enums/MediaShellEnums.js");
  const {
    POPUP_ALBUM_ART_CORNER_RADIUS,
    POPUP_WIDTH,
    TEXT_SCROLL_PAUSE_SECONDS,
    TEXT_SCROLL_SPEED,
    TOP_BAR_INDEX,
    TOP_BAR_TRACK_INFORMATION_WIDTH,
    TOP_BAR_VISUALIZER_SPEED,
  } = await import("../src/shared/constants/settings.js");
  const {
    INPUT_SETTING_KEY_MIGRATIONS,
    LEGACY_SETTING_KEY_MIGRATIONS,
    NAMING_SETTING_KEY_MIGRATIONS,
    PLACEMENT_SETTING_KEY_MIGRATIONS,
    SHORTCUT_SETTING_KEY_MIGRATIONS,
  } = await import("../src/shared/settings/SettingsMigration.js");

  const schema = await readFile("assets/org.gnome.shell.extensions.mediashell.gschema.xml", "utf8");
  const prefsUi = await readFile("assets/ui/prefs.ui", "utf8");
  const shellSpec = await readFile("src/shell/settings/SettingsSpec.js", "utf8");
  const prefsSpec = await readFile("src/prefs/bindings/PreferenceBindings.js", "utf8");

  const schemaKeys = new Set([...schema.matchAll(/<key\s+name="([^"]+)"/g)].map((match) => match[1]));
  const shellKeys = new Set([...shellSpec.matchAll(/^\s{4}"([^"]+)":/gm)].map((match) => match[1]));
  const prefsKeys = new Set([...prefsSpec.matchAll(/^\s{4}\["([^"]+)"/gm)].map((match) => match[1]));

  const allSettingKeyMigrations = Object.freeze({
    ...LEGACY_SETTING_KEY_MIGRATIONS,
    ...NAMING_SETTING_KEY_MIGRATIONS,
    ...PLACEMENT_SETTING_KEY_MIGRATIONS,
    ...SHORTCUT_SETTING_KEY_MIGRATIONS,
    ...INPUT_SETTING_KEY_MIGRATIONS,
  });
  const migrationKeys = new Set(Object.keys(allSettingKeyMigrations));
  const migrationOnlyKeys = new Set(["settings-schema-version"]);
  const shellSpecialKeys = new Set(KEYBOARD_SHORTCUT_KEYS);
  const customPrefsKeys = new Set(["top-bar-element-order", "top-bar-track-information-content", "blocked-apps"]);

  const currentSchemaKeys = new Set(
    [...schemaKeys].filter((key) => !migrationKeys.has(key) && !migrationOnlyKeys.has(key)),
  );
  const errors = [];

  for (const [sourceKey, destinationKey] of Object.entries(allSettingKeyMigrations)) {
    if (!schemaKeys.has(sourceKey)) errors.push(`Migration source key is missing from the schema: ${sourceKey}`);
    if (!schemaKeys.has(destinationKey))
      errors.push(`Migration destination key is missing from the schema: ${destinationKey}`);

    const seenKeys = new Set([sourceKey]);
    let finalDestinationKey = destinationKey;
    while (allSettingKeyMigrations[finalDestinationKey]) {
      if (seenKeys.has(finalDestinationKey)) {
        errors.push(`Migration cycle detected at key: ${finalDestinationKey}`);
        break;
      }
      seenKeys.add(finalDestinationKey);
      finalDestinationKey = allSettingKeyMigrations[finalDestinationKey];
    }
    if (migrationKeys.has(finalDestinationKey)) errors.push(`Migration chain does not reach a current key: ${sourceKey}`);
  }

  for (const key of shellKeys) {
    if (!schemaKeys.has(key)) errors.push(`Shell settings spec contains unknown key: ${key}`);
    if (migrationKeys.has(key)) errors.push(`Shell settings spec must not consume legacy key: ${key}`);
  }
  for (const key of prefsKeys) {
    if (!schemaKeys.has(key)) errors.push(`Preferences settings spec contains unknown key: ${key}`);
    if (migrationKeys.has(key)) errors.push(`Preferences settings spec must not expose legacy key: ${key}`);
  }
  for (const key of currentSchemaKeys) {
    if (!shellKeys.has(key) && !shellSpecialKeys.has(key))
      errors.push(`Current schema key is not consumed by the Shell: ${key}`);
    if (!prefsKeys.has(key) && !customPrefsKeys.has(key))
      errors.push(`Current schema key is not exposed by preferences: ${key}`);
  }
  for (const key of migrationKeys) {
    if (!schemaKeys.has(key)) errors.push(`Migration source key is missing from the schema: ${key}`);
  }

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  function schemaNumericConstraint(key) {
    const block = schema.match(new RegExp(`<key\\s+name="${key}"[^>]*>([\\s\\S]*?)<\\/key>`))?.[1];
    assert.ok(block, `Schema block not found for ${key}`);

    const range = block.match(/<range\s+min="(\d+)"\s+max="(\d+)"\s*\/>/);
    const defaultValue = block.match(/<default>(\d+)<\/default>/)?.[1];
    assert.ok(range, `Numeric range not found for ${key}`);
    assert.ok(defaultValue, `Numeric default not found for ${key}`);

    return { MIN: Number(range[1]), MAX: Number(range[2]), DEFAULT: Number(defaultValue) };
  }

  function schemaDefault(key) {
    const block = schema.match(new RegExp(`<key\\s+name="${key}"[^>]*>([\\s\\S]*?)<\\/key>`))?.[1];
    assert.ok(block, `Schema block not found for ${key}`);

    const rawDefault = block.match(/<default>([\s\S]*?)<\/default>/)?.[1];
    assert.ok(rawDefault !== undefined, `Schema default not found for ${key}`);
    return rawDefault
      .trim()
      .replace(/^<!\[CDATA\[/, "")
      .replace(/\]\]>$/, "")
      .trim();
  }

  function schemaEnumValues(enumId) {
    const escapedEnumId = enumId.replaceAll(".", "\\.");
    const enumBlock = schema.match(new RegExp(`<enum\\s+id="${escapedEnumId}">([\\s\\S]*?)<\\/enum>`))?.[1];
    assert.ok(enumBlock, `Schema enum not found: ${enumId}`);
    return [...enumBlock.matchAll(/<value nick="([A-Z_]+)" value="(\d+)" \/>/g)].map(([, nick, value]) => [
      nick,
      Number(value),
    ]);
  }

  const inputActionEnumValues = schemaEnumValues("org.gnome.shell.extensions.mediashell.input-actions").filter(
    ([, value]) => value <= InputActions.NEXT_APP,
  );
  assert.deepEqual(
    inputActionEnumValues,
    Object.entries(InputActions),
    "The GSettings input-action enum must preserve the shared numeric ordering",
  );
  assert.deepEqual(
    schemaEnumValues("org.gnome.shell.extensions.mediashell.visualizer-styles"),
    Object.entries(VisualizerStyles),
    "The visualizer style enum must preserve the shared numeric ordering",
  );
  assert.equal(
    KEYBOARD_SHORTCUT_KEYS.length,
    Object.keys(InputActions).length - 1,
    "Every executable input action needs a shortcut key",
  );
  assert.ok(!KEYBOARD_SHORTCUT_KEYS.includes("shortcut-none"), "The NONE action must not expose a shortcut");

  const FACTORY_DEFAULTS = Object.freeze({
    "popup-width": "250",
    "show-popup-album-art": "true",
    "show-popup-track-information": "true",
    "popup-album-art-corner-radius": "20",
    "show-popup-title": "true",
    "show-popup-artist": "true",
    "show-popup-album": "true",
    "show-popup-progress-bar": "true",
    "popup-scroll-track-information": "false",
    "popup-scroll-speed": "4",
    "popup-scroll-pause-time": "0",
    "use-colored-popup-app-icon": "true",
    "show-top-bar-track-information": "true",
    "show-top-bar-visualizer": "false",
    "top-bar-visualizer-style": "'WAVE'",
    "top-bar-visualizer-speed": "4",
    "top-bar-track-information-width": "200",
    "lock-top-bar-track-information-width": "false",
    "top-bar-scroll-track-information": "false",
    "top-bar-scroll-speed": "4",
    "top-bar-scroll-pause-time": "0",
    "top-bar-track-information-content": "['TITLE', '•', 'ARTIST']",
    "show-top-bar-app-icon": "true",
    "use-colored-top-bar-app-icon": "false",
    "show-top-bar-playback-controls": "true",
    "show-top-bar-play-pause": "true",
    "show-top-bar-next-track": "true",
    "show-top-bar-previous-track": "true",
    "top-bar-position": "'Center'",
    "top-bar-index": "0",
    "top-bar-element-order": "['APP_ICON', 'TRACK_INFORMATION', 'VISUALIZER', 'PLAYBACK_CONTROLS']",
    ...Object.fromEntries(KEYBOARD_SHORTCUT_KEYS.map((key) => [key, "['']"])),
    "mouse-action-left": "'TOGGLE_POPUP'",
    "mouse-action-middle": "'OPEN_PREFERENCES'",
    "mouse-action-right": "'RAISE_APP'",
    "mouse-action-double": "'NONE'",
    "mouse-action-scroll-up": "'VOLUME_UP'",
    "mouse-action-scroll-down": "'VOLUME_DOWN'",
    "hide-system-media-controls": "true",
    "cache-album-art": "true",
    "blocked-apps": "[]",
  });

  for (const [key, expectedDefault] of Object.entries(FACTORY_DEFAULTS))
    assert.equal(schemaDefault(key), expectedDefault, `${key} does not match the approved fresh-install profile`);

  for (const [legacyKey, currentKey] of [
    ["show-track-slider", "show-popup-progress-bar"],
    ["top-bar-colored-app-icon", "use-colored-top-bar-app-icon"],
    ["colored-player-icon", "use-colored-top-bar-app-icon"],
  ])
    assert.equal(schemaDefault(legacyKey), schemaDefault(currentKey), `${legacyKey} must mirror ${currentKey}`);

  function prefsAdjustment(widgetId) {
    const widgetStart = prefsUi.indexOf(`id="${widgetId}"`);
    assert.notEqual(widgetStart, -1, `Preferences widget not found: ${widgetId}`);

    const adjustmentStart = prefsUi.indexOf('<object class="GtkAdjustment">', widgetStart);
    const adjustmentEnd = prefsUi.indexOf("</object>", adjustmentStart);
    assert.notEqual(adjustmentStart, -1, `GtkAdjustment not found for ${widgetId}`);
    assert.notEqual(adjustmentEnd, -1, `GtkAdjustment end not found for ${widgetId}`);

    const block = prefsUi.slice(adjustmentStart, adjustmentEnd);
    const read = (property) => {
      const value = block.match(new RegExp(`<property name="${property}">(\\d+)<\\/property>`))?.[1];
      assert.ok(value, `${property} not found for ${widgetId}`);
      return Number(value);
    };

    return { MIN: read("lower"), MAX: read("upper"), DEFAULT: read("value") };
  }

  const numericContracts = [
    ["popup-width", "sp-popup-width", POPUP_WIDTH],
    ["popup-album-art-corner-radius", "sp-popup-album-art-radius", POPUP_ALBUM_ART_CORNER_RADIUS],
    ["popup-scroll-speed", "sp-popup-scroll-speed", TEXT_SCROLL_SPEED],
    ["popup-scroll-pause-time", "sp-popup-scroll-pause", TEXT_SCROLL_PAUSE_SECONDS],
    ["top-bar-track-information-width", "sp-top-bar-track-information-width", TOP_BAR_TRACK_INFORMATION_WIDTH],
    ["top-bar-scroll-speed", "sp-top-bar-scroll-speed", TEXT_SCROLL_SPEED],
    ["top-bar-scroll-pause-time", "sp-top-bar-scroll-pause", TEXT_SCROLL_PAUSE_SECONDS],
    ["top-bar-visualizer-speed", "sp-top-bar-visualizer-speed", TOP_BAR_VISUALIZER_SPEED],
    ["top-bar-index", "sp-panel-top-bar-index", TOP_BAR_INDEX],
  ];

  for (const [key, widgetId, bounds] of numericContracts) {
    assert.deepEqual(schemaNumericConstraint(key), bounds, `${key} schema bounds differ from shared constants`);
    assert.deepEqual(prefsAdjustment(widgetId), bounds, `${widgetId} bounds differ from shared constants`);
  }

  assert.match(
    shellSpec,
    /"cache-album-art":\s*\{[\s\S]*?property: "cacheAlbumArt"[\s\S]*?impact: WidgetFlags\.POPUP_ALBUM_ART[\s\S]*?\}/,
    "Changing cache-album-art must reconcile popup album art immediately",
  );

  console.log(
    `Settings contract check passed for ${currentSchemaKeys.size} current keys, ${migrationKeys.size} migration source keys, ${Object.keys(FACTORY_DEFAULTS).length} approved factory defaults, and ${numericContracts.length} synchronized numeric controls.`,
  );
}

// Verifies packaging, resources, package commands, and the maintained repository surface.
async function checkContract() {
  const { default: assert } = await import("node:assert/strict");
  const { access, readFile, readdir } = await import("node:fs/promises");
  const { extname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const { SUPPORTED_GNOME_SHELL_VERSIONS } = await import("../src/shared/constants/platform.js");

  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const EXPECTED_SHELL_VERSIONS = ["47", "48", "49", "50"];
  const REQUIRED_ENTRY_POINTS = ["src/extension.js", "src/prefs.js", "src/metadata.json", "src/stylesheet.css"];
  const REQUIRED_SOURCE_DIRECTORIES = ["src/shared", "src/shell", "src/prefs", "src/icons"];
  const REQUIRED_SCRIPTS = [
    "check",
    "test",
    "doctor",
    "debug",
    "build",
    "ext:install",
    "ext:uninstall",
    "ext:enable",
    "ext:disable",
    "ext:prefs",
    "ext:upload",
    "translations",
  ];
  const REQUIRED_VALIDATION_FILES = [
    "scripts/check.mjs",
    "scripts/check-assets.py",
    "scripts/check-development.sh",
    "scripts/development.sh",
  ];
  const EXPECTED_DOCUMENTS = [
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT.md",
    "docs/MAINTENANCE.md",
    "docs/SETTINGS.md",
    "docs/UI_CONTRACT.md",
    "docs/VALIDATION.md",
  ];
  const EXPECTED_SCRIPT_FILES = [
    "scripts/check-assets.py",
    "scripts/check-development.sh",
    "scripts/check.mjs",
    "scripts/development.sh",
  ];

  async function read(path) {
    return readFile(join(ROOT, path), "utf8");
  }

  async function exists(path) {
    try {
      await access(join(ROOT, path));
      return true;
    } catch {
      return false;
    }
  }

  async function collect(directory, include = () => true) {
    const files = [];
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      if ([".git", "dist", "node_modules", "__pycache__"].includes(entry.name)) continue;
      const path = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) files.push(...(await collect(path, include)));
      else if (include(path)) files.push(path);
    }
    return files.sort();
  }

  const packageJson = JSON.parse(await read("package.json"));
  const metadata = JSON.parse(await read("src/metadata.json"));

  assert.equal(packageJson.name, "mediashell");
  assert.equal(metadata.uuid, "mediashell@wstxda.github.com");
  assert.equal(metadata.name, "MediaShell");
  assert.equal(metadata["settings-schema"], "org.gnome.shell.extensions.mediashell");
  assert.equal(metadata["gettext-domain"], metadata.uuid);
  assert.equal(metadata["version-name"], packageJson.version, "Manifest and package versions must agree");
  assert.deepEqual(metadata["shell-version"], EXPECTED_SHELL_VERSIONS);
  assert.deepEqual(SUPPORTED_GNOME_SHELL_VERSIONS, EXPECTED_SHELL_VERSIONS);
  assert.equal(packageJson.packageManager, "pnpm@10.12.1");
  assert.match(packageJson.engines.node, />=20/);

  for (const path of [...REQUIRED_ENTRY_POINTS, ...REQUIRED_SOURCE_DIRECTORIES, ...REQUIRED_VALIDATION_FILES]) {
    assert.equal(await exists(path), true, `Required project path is missing: ${path}`);
  }
  assert.deepEqual(
    await collect("docs", (path) => extname(path) === ".md"),
    EXPECTED_DOCUMENTS,
    "Documentation surface changed without updating the release contract",
  );
  assert.deepEqual(
    await collect("scripts"),
    EXPECTED_SCRIPT_FILES,
    "Script surface changed without updating the release contract",
  );
  for (const name of REQUIRED_SCRIPTS) {
    assert.equal(typeof packageJson.scripts[name], "string", `Required package script is missing: ${name}`);
  }

  for (const path of EXPECTED_SCRIPT_FILES) {
    const text = await read(path);
    const lines = text.split("\n");
    const headerLine = lines[0].startsWith("#!") ? lines[1] : lines[0];
    assert.match(headerLine, /^(?:\/\/|#) (?:Verifies|Enforces|Runs|Provides) /, `${path} must start with a concise purpose header`);
  }

  const scriptReferences = new Set();
  for (const command of Object.values(packageJson.scripts)) {
    for (const match of command.matchAll(/(?:node|python3|bash)\s+(scripts\/[\w.-]+)/g)) scriptReferences.add(match[1]);
  }
  for (const path of scriptReferences) {
    assert.equal(await exists(path), true, `Package script references a missing file: ${path}`);
  }

  const buildStages = ["check", "build:clean", "build:dirs", "build:copy", "build:resources", "build:pack"];
  for (const stage of buildStages) {
    assert.ok(packageJson.scripts.build.includes(`pnpm run ${stage}`) || packageJson.scripts.build.includes(`pnpm ${stage}`), `Build is missing ${stage}`);
  }
  for (const requiredArgument of ["--schema=", "--podir=", "--extra-source=shell", "--extra-source=prefs", "--extra-source=shared", "--extra-source=icons", "--extra-source=org.gnome.shell.extensions.mediashell.gresource"]) {
    assert.ok(packageJson.scripts["build:pack"].includes(requiredArgument), `build:pack is missing ${requiredArgument}`);
  }

  const resourceManifest = await read("assets/org.gnome.shell.extensions.mediashell.gresource.xml");
  const resourceFiles = [...resourceManifest.matchAll(/<file(?:\s[^>]*)?>([^<]+)<\/file>/g)].map((match) => match[1].trim());
  assert.ok(resourceFiles.length > 0, "GResource manifest is empty");
  assert.equal(new Set(resourceFiles).size, resourceFiles.length, "GResource manifest contains duplicate entries");
  for (const path of resourceFiles) {
    assert.equal(await exists(`assets/${path}`), true, `GResource source is missing: assets/${path}`);
  }
  for (const requiredResource of ["ui/prefs.ui", "dbus/mprisNode.xml", "dbus/watchNode.xml"]) {
    assert.ok(resourceFiles.includes(requiredResource), `GResource manifest is missing ${requiredResource}`);
  }
  assert.equal(
    resourceFiles.includes("images/banner.svg"),
    false,
    "The README banner is documentation artwork and must not be bundled in the extension GResource",
  );

  const schema = await read("assets/org.gnome.shell.extensions.mediashell.gschema.xml");
  assert.match(schema, new RegExp(`<schema[^>]+id=["']${metadata["settings-schema"].replaceAll(".", "\\.")}["']`));

  const sourceFiles = await collect("src", (path) => extname(path) === ".js");
  assert.ok(sourceFiles.length >= 40, "Unexpectedly small runtime source tree");
  const checkRunner = await read("scripts/check.mjs");
  for (const path of ["scripts/check-assets.py", "scripts/check-development.sh"]) {
    assert.ok(checkRunner.includes(path), `Validation runner is missing ${path}`);
  }
  assert.match(checkRunner, /process\.execPath, \["--test"\]/);


  assert.equal(await exists("src/icons/hicolor/scalable/apps/mediashell.svg"), true, "Packaged application icon is missing");
  assert.equal(await exists("assets/images/banner.svg"), true, "README banner is missing");
  assert.equal(await exists("assets/images/popup.png"), false, "Placeholder popup screenshot must not be restored");

  const aboutController = await read("src/prefs/about/AboutDialogController.js");
  assert.match(aboutController, /const DONATION_URL = "https:\/\/buymeacoffee\.com\/wstxda";/);
  assert.match(aboutController, /aboutDialog\.add_link\(_\("Donate"\), DONATION_URL\)/);
  for (const credit of [
    "Sakith B. https://github.com/sakithb",
    "Christian Lauinger https://github.com/ChrisLauinger77",
    "Winston Ma https://github.com/winstonma",
    "Ahmet Oğuzhan Kökülü https://github.com/Oguzhankokulu",
  ]) {
    assert.ok(aboutController.includes(credit), `About dialog is missing Media Controls credit: ${credit}`);
  }
  assert.match(
    aboutController,
    /const MEDIA_CONTROLS_CONTRIBUTORS_URL =\s*"https:\/\/github\.com\/sakithb\/media-controls\/graphs\/contributors\?all=1";/,
  );
  assert.match(
    aboutController,
    /`\$\{_\("View all\.\.\."\)\} \$\{MEDIA_CONTROLS_CONTRIBUTORS_URL\}`/,
    "About credits must include the translated View all... contributor link",
  );

  const gitignore = await read(".gitignore");
  assert.equal(packageJson.devDependencies, undefined, "The project must remain dependency-free");
  assert.equal(packageJson.dependencies, undefined, "The project must remain dependency-free");

  for (const ignoredPath of ["dist", "node_modules"]) {
    assert.match(gitignore, new RegExp(`^${ignoredPath}\/?$`, "m"), `${ignoredPath} must be ignored`);
  }
  for (const generatedPath of [
    "src/gschemas.compiled",
    "src/org.gnome.shell.extensions.mediashell.gresource",
    "assets/gschemas.compiled",
  ]) {
    assert.equal(await exists(generatedPath), false, `Generated artifact must not be present: ${generatedPath}`);
  }
  const sourceArchives = await collect(".", (path) => extname(path) === ".zip");
  assert.deepEqual(sourceArchives, [], "Generated ZIP archives must stay outside the maintained source tree");

  console.log(`Project contract check passed: ${sourceFiles.length} runtime modules, ${resourceFiles.length} resources, manifest, build, and repository shape are aligned.`);
}

// Verifies documentation links, commands, repository paths, support policy, and text hygiene.
async function checkDocumentation() {
  const { access, readFile, readdir } = await import("node:fs/promises");
  const { dirname, extname, join, resolve } = await import("node:path");
  const { fileURLToPath } = await import("node:url");

  const ROOT = fileURLToPath(new URL("../", import.meta.url));
  const CORE_DOCUMENTS = [
    "docs/ARCHITECTURE.md",
    "docs/DEVELOPMENT.md",
    "docs/MAINTENANCE.md",
    "docs/SETTINGS.md",
    "docs/UI_CONTRACT.md",
    "docs/VALIDATION.md",
  ];
  const TEXT_EXTENSIONS = new Set([".css", ".js", ".json", ".md", ".mjs", ".po", ".pot", ".py", ".sh", ".svg", ".ui", ".xml", ".yaml", ".yml"]);
  const TEXT_FILE_NAMES = new Set([".gitignore", "LICENSE"]);

  async function collect(directory, include) {
    const files = [];
    for (const entry of await readdir(join(ROOT, directory), { withFileTypes: true })) {
      if ([".git", "dist", "node_modules", "__pycache__"].includes(entry.name)) continue;
      const path = join(directory, entry.name).replaceAll("\\", "/");
      if (entry.isDirectory()) files.push(...(await collect(path, include)));
      else if (include(path.replace(/^\.\//, ""))) files.push(path.replace(/^\.\//, ""));
    }
    return files.sort();
  }

  async function read(path) {
    return readFile(join(ROOT, path), "utf8");
  }

  async function exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  function withoutAnchor(target) {
    return target.split("#", 1)[0].split("?", 1)[0];
  }

  const documentationFiles = [
    "README.md",
    ...(await collect("docs", (path) => extname(path) === ".md")),
    ...(await collect(".github/ISSUE_TEMPLATE", (path) => extname(path) === ".md")),
  ];
  const textFiles = await collect(".", (path) => TEXT_EXTENSIONS.has(extname(path)) || TEXT_FILE_NAMES.has(path.split("/").at(-1)));
  const packageJson = JSON.parse(await read("package.json"));
  const metadata = JSON.parse(await read("src/metadata.json"));
  const errors = [];

  for (const file of textFiles) {
    const text = await read(file);
    if (!text.endsWith("\n")) errors.push(`${file}: missing final newline`);
    const trailingWhitespaceLine = text.split("\n").findIndex((line) => /[ \t]+$/.test(line));
    if (trailingWhitespaceLine >= 0) errors.push(`${file}:${trailingWhitespaceLine + 1}: trailing whitespace`);
    if (file !== "scripts/check.mjs" && /\b(?:TODO|FIXME|HACK|XXX)\b/.test(text)) errors.push(`${file}: unresolved maintenance marker`);
  }

  for (const file of documentationFiles) {
    const text = await read(file);
    const base = dirname(join(ROOT, file));
    const headings = new Set();

    for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) {
      const heading = match[1].trim().toLowerCase();
      if (headings.has(heading)) errors.push(`${file}: duplicate heading ${match[1].trim()}`);
      headings.add(heading);
    }

    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const rawTarget = match[1].trim().replace(/^<|>$/g, "");
      if (!rawTarget || /^(?:https?:|mailto:|#)/.test(rawTarget)) continue;
      const target = withoutAnchor(rawTarget);
      if (!target) continue;
      if (!(await exists(resolve(base, decodeURIComponent(target))))) errors.push(`${file}: broken relative link ${rawTarget}`);
    }

    for (const match of text.matchAll(/`((?:src|assets|scripts|docs|tests|\.github)\/[^`\n]+)`/g)) {
      let documentedPath = match[1].trim().replace(/[),.;:]+$/, "");
      if (documentedPath.includes(" ") || documentedPath.includes("${")) continue;
      if (documentedPath.includes("*")) documentedPath = dirname(documentedPath);
      if (!(await exists(join(ROOT, documentedPath)))) errors.push(`${file}: documented path does not exist: ${match[1]}`);
    }

    for (const match of text.matchAll(/(?:^|`)pnpm(?:\s+run)?\s+([a-zA-Z][\w:-]*)/gm)) {
      const command = match[1];
      if (["install", "exec", "dlx", "add", "remove", "update"].includes(command)) continue;
      if (!(command in packageJson.scripts)) errors.push(`${file}: unknown pnpm script ${command}`);
    }
  }

  const readme = await read("README.md");
  const canonicalDescription = "Configurable MPRIS media controls for the GNOME Shell top bar.";
  if (!readme.includes("![MediaShell banner](assets/images/banner.svg)"))
    errors.push("README.md: missing the project banner");
  if (!readme.includes(canonicalDescription)) errors.push("README.md: canonical short description is missing");
  if (metadata.description !== canonicalDescription) errors.push("src/metadata.json: canonical short description differs");
  if (packageJson.description !== canonicalDescription) errors.push("package.json: canonical short description differs");
  for (const path of CORE_DOCUMENTS) {
    if (!readme.includes(`(${path})`)) errors.push(`README.md: missing link to ${path}`);
  }

  const allDocumentation = (await Promise.all(documentationFiles.map(read))).join("\n");
  const actualCoreDocuments = await collect("docs", (path) => extname(path) === ".md");
  if (JSON.stringify(actualCoreDocuments) !== JSON.stringify([...CORE_DOCUMENTS].sort()))
    errors.push("The maintained documentation surface differs from the documented core set");
  if (/\bGNOME(?: Shell)? 46\b/.test(allDocumentation)) errors.push("Documentation advertises unsupported GNOME Shell 46");
  if (!allDocumentation.includes("GNOME Shell 47–50")) errors.push("Documentation must state the GNOME Shell 47–50 range");
  if (!allDocumentation.includes("Libadwaita 1.6")) errors.push("Documentation must state the Libadwaita 1.6 baseline");
  if (/\b1\.0\.0\b/.test(allDocumentation)) errors.push("Documentation must not hardcode the current project version");
  for (const retiredDocument of ["CONTRIBUTING.md", "stable.zip"]) {
    if (allDocumentation.includes(retiredDocument)) errors.push(`Documentation references retired content: ${retiredDocument}`);
  }
  for (const canonicalTerm of ["App selector", "Track Information", "Playback Controls", "Playback Progress", "Volume Control", "Album Art", "Mouse Actions", "Keyboard Shortcuts", "Blocked Apps", "System media controls"]) {
    if (!allDocumentation.includes(canonicalTerm)) errors.push(`Documentation is missing canonical UI term: ${canonicalTerm}`);
  }
  const supportList = metadata["shell-version"];
  if (JSON.stringify(supportList) !== JSON.stringify(["47", "48", "49", "50"])) errors.push("src/metadata.json support range is not exactly 47–50");

  if (errors.length > 0) {
    console.error(`Documentation alignment check failed:\n${errors.map((error) => `- ${error}`).join("\n")}`);
    process.exit(1);
  }

  console.log(`Documentation alignment check passed for ${documentationFiles.length} documents and ${textFiles.length} maintained text files.`);
}


async function runCommand(label, command, args) {
  const { spawnSync } = await import("node:child_process");
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`${label} could not start:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const checks = [
  ["JavaScript syntax", checkSyntax],
  ["imports and process boundaries", checkImports],
  ["GNOME platform compatibility", checkCompatibility],
  ["settings and migrations", checkSettings],
  ["project contract", checkContract],
  ["documentation", checkDocumentation],
];

for (const [label, check] of checks) {
  console.log(`\n==> ${label}`);
  await check();
}

await runCommand("unit tests", process.execPath, ["--test"]);
await runCommand("resources and translations", "python3", ["scripts/check-assets.py"]);
await runCommand("development commands", "bash", ["scripts/check-development.sh"]);

console.log(`\nAll ${checks.length + 3} validation groups passed.`);
