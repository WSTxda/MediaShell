/**
 * @file settings.js
 * @module shell.settings.settings
 *
 * Owns the Shell-side view of the MediaShell GSettings contract.
 *
 * Settings are grouped by the runtime owner that consumes them. Each scope
 * performs typed reads, normalizes defensive bounds, owns its Gio.Settings
 * subscriptions, and notifies only consumers of that scope. No setting is
 * injected onto ExtensionController and no global action/impact table exists.
 */

import {
  POPUP_ARTWORK_CORNER_RADIUS_CONSTRAINTS,
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
  TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
  TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
  TOP_BAR_ARTWORK_CORNER_RADIUS_CONSTRAINTS,
  TOP_BAR_ELEMENT_ORDER_DEFAULT,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
  PANEL_INDEX_CONSTRAINTS,
  TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS,
  TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS,
  NativeMediaControlsModes,
} from "../../shared/settings/contract.js";
import { normalizeInputAction } from "../../shared/input/normalization.js";
import { InputActions } from "../../shared/input/types.js";
import { normalizeTrackInformationContent } from "../../shared/ui/trackInformationContent.js";
import {
  enumValueByIndex,
  normalizeOrderedValues,
  normalizeUniqueStrings,
} from "../../shared/format.js";
import { PanelPositions } from "../ui/indicator/panelPosition.js";

function createNumericConstraint({ MIN, MAX, DEFAULT }) {
  return (value) =>
    Math.min(MAX, Math.max(MIN, Number.isFinite(value) ? value : DEFAULT));
}

function createSecondsToMillisecondsTransform(bounds) {
  const constrainValue = createNumericConstraint(bounds);
  return (value) => constrainValue(value) * 1000;
}

function define(key, read, transform = null) {
  return Object.freeze({ key, read, transform });
}

const POPUP_DEFINITIONS = Object.freeze({
  width: define(
    SettingsKeys.POPUP_WIDTH,
    "get_uint",
    createNumericConstraint(POPUP_WIDTH_CONSTRAINTS),
  ),
  artworkShow: define(SettingsKeys.POPUP_ARTWORK_SHOW, "get_boolean"),
  artworkCornerRadius: define(
    SettingsKeys.POPUP_ARTWORK_CORNER_RADIUS,
    "get_uint",
    createNumericConstraint(POPUP_ARTWORK_CORNER_RADIUS_CONSTRAINTS),
  ),
  trackInformationShow: define(
    SettingsKeys.POPUP_TRACK_INFORMATION_SHOW,
    "get_boolean",
  ),
  trackInformationContent: define(
    SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT,
    "get_strv",
    (value) =>
      normalizeTrackInformationContent(
        value,
        POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
  ),
  progressBarShow: define(SettingsKeys.POPUP_PROGRESS_BAR_SHOW, "get_boolean"),
  playbackControlsShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
    "get_boolean",
  ),
  playbackControlsShuffleShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekBackwardShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsPreviousTrackShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsPlayPauseShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
    "get_boolean",
  ),
  playbackControlsNextTrackShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekForwardShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsRepeatShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW,
    "get_boolean",
  ),
  playbackControlsSpeedShow: define(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW,
    "get_boolean",
  ),
  volumeControlShow: define(SettingsKeys.POPUP_VOLUME_CONTROL_SHOW, "get_boolean"),
  trackInformationScrollEnabled: define(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_ENABLED,
    "get_boolean",
  ),
  trackInformationScrollSpeed: define(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED,
    "get_uint",
    createNumericConstraint(TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS),
  ),
  trackInformationScrollPauseMilliseconds: define(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_TIME,
    "get_uint",
    createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
  ),
  mediaAppIconUseColor: define(
    SettingsKeys.POPUP_MEDIA_APP_ICON_USE_COLOR,
    "get_boolean",
  ),
});

const TOP_BAR_DEFINITIONS = Object.freeze({
  trackInformationShow: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SHOW,
    "get_boolean",
  ),
  trackInformationWidth: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH,
    "get_uint",
    createNumericConstraint(TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS),
  ),
  trackInformationWidthLock: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH_LOCK,
    "get_boolean",
  ),
  trackInformationScrollEnabled: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED,
    "get_boolean",
  ),
  trackInformationScrollSpeed: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED,
    "get_uint",
    createNumericConstraint(TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS),
  ),
  trackInformationScrollPauseMilliseconds: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_TIME,
    "get_uint",
    createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
  ),
  trackInformationContent: define(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT,
    "get_strv",
    (value) =>
      normalizeTrackInformationContent(
        value,
        TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
  ),
  mediaAppIconShow: define(SettingsKeys.TOP_BAR_MEDIA_APP_ICON_SHOW, "get_boolean"),
  mediaAppIconUseColor: define(
    SettingsKeys.TOP_BAR_MEDIA_APP_ICON_USE_COLOR,
    "get_boolean",
  ),
  artworkShow: define(SettingsKeys.TOP_BAR_ARTWORK_SHOW, "get_boolean"),
  artworkCornerRadius: define(
    SettingsKeys.TOP_BAR_ARTWORK_CORNER_RADIUS,
    "get_uint",
    createNumericConstraint(TOP_BAR_ARTWORK_CORNER_RADIUS_CONSTRAINTS),
  ),
  visualizerShow: define(SettingsKeys.TOP_BAR_VISUALIZER_SHOW, "get_boolean"),
  visualizerStyle: define(SettingsKeys.TOP_BAR_VISUALIZER_STYLE, "get_enum"),
  visualizerSpeed: define(
    SettingsKeys.TOP_BAR_VISUALIZER_SPEED,
    "get_uint",
    createNumericConstraint(TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS),
  ),
  playbackControlsShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW,
    "get_boolean",
  ),
  playbackControlsShuffleShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekBackwardShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsPreviousTrackShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsPlayPauseShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
    "get_boolean",
  ),
  playbackControlsNextTrackShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekForwardShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsRepeatShow: define(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW,
    "get_boolean",
  ),
  elementOrder: define(
    SettingsKeys.TOP_BAR_ELEMENT_ORDER,
    "get_strv",
    (value) => normalizeOrderedValues(value, TOP_BAR_ELEMENT_ORDER_DEFAULT),
  ),
});

const PANEL_DEFINITIONS = Object.freeze({
  position: define(SettingsKeys.PANEL_POSITION, "get_enum", (value) =>
    enumValueByIndex(PanelPositions, value),
  ),
  index: define(
    SettingsKeys.PANEL_INDEX,
    "get_uint",
    createNumericConstraint(PANEL_INDEX_CONSTRAINTS),
  ),
});

const INTERACTION_DEFINITIONS = Object.freeze({
  mouseActionLeft: define(SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT, "get_enum", (value) =>
    normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionMiddle: define(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionRight: define(SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT, "get_enum", (value) =>
    normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionDouble: define(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionScrollUp: define(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionScrollDown: define(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
});

const INTEGRATION_DEFINITIONS = Object.freeze({
  nativeMediaControlsMode: define(
    SettingsKeys.NATIVE_MEDIA_CONTROLS_MODE,
    "get_enum",
    (value) => enumValueByIndex(NativeMediaControlsModes, value),
  ),
});

const MEDIA_DEFINITIONS = Object.freeze({
  artworkCacheEnabled: define(SettingsKeys.ARTWORK_CACHE_ENABLED, "get_boolean"),
  blockedAppIds: define(
    SettingsKeys.BLOCKED_APPS,
    "get_strv",
    normalizeUniqueStrings,
  ),
});

export const SettingScopes = Object.freeze({
  POPUP: "popup",
  TOP_BAR: "topBar",
  PANEL: "panel",
  INTERACTIONS: "interactions",
  INTEGRATION: "integration",
  MEDIA: "media",
});

const SETTING_SCOPE_DEFINITIONS = Object.freeze({
  [SettingScopes.POPUP]: POPUP_DEFINITIONS,
  [SettingScopes.TOP_BAR]: TOP_BAR_DEFINITIONS,
  [SettingScopes.PANEL]: PANEL_DEFINITIONS,
  [SettingScopes.INTERACTIONS]: INTERACTION_DEFINITIONS,
  [SettingScopes.INTEGRATION]: INTEGRATION_DEFINITIONS,
  [SettingScopes.MEDIA]: MEDIA_DEFINITIONS,
});

/** Read-ownership metadata consumed by repository contract tooling. */
export const RUNTIME_SETTING_CONTRACT = Object.freeze(
  Object.fromEntries(
    Object.entries(SETTING_SCOPE_DEFINITIONS).flatMap(([scope, definitions]) =>
      Object.entries(definitions).map(([property, definition]) => [
        definition.key,
        Object.freeze({
          scope,
          property: `${scope}.${property}`,
          localProperty: property,
          read: definition.read,
        }),
      ]),
    ),
  ),
);

/**
 * Typed, observable subset of the MediaShell GSettings schema.
 *
 * Subscribers receive `(value, property)` after the scope has already updated
 * its public property. The returned function disconnects only that subscriber;
 * the scope itself owns and removes the underlying Gio.Settings signals.
 */
export class SettingsScope {
  constructor(settings, definitions) {
    this.settings = settings;
    this.definitions = definitions;
    this.signalIds = [];
    this.subscribers = new Map();

    for (const [property, definition] of Object.entries(definitions)) {
      const signalId = settings.connect(`changed::${definition.key}`, () => {
        const value = this.#read(definition);
        this[property] = value;
        this.#notify(property, value);
      });
      this.signalIds.push(signalId);
      // Connect first so a concurrent preferences write cannot be missed
      // between the initial read and subscription setup.
      this[property] = this.#read(definition);
    }
  }

  subscribe(properties, callback) {
    const propertyList = Array.isArray(properties) ? properties : [properties];
    const subscriptions = [];

    for (const property of propertyList) {
      if (!(property in this.definitions))
        throw new TypeError(`Unknown settings property: ${String(property)}`);
      let callbacks = this.subscribers.get(property);
      if (!callbacks) {
        callbacks = new Set();
        this.subscribers.set(property, callbacks);
      }
      callbacks.add(callback);
      subscriptions.push([property, callback]);
    }

    return () => {
      for (const [property, subscribedCallback] of subscriptions) {
        const callbacks = this.subscribers.get(property);
        callbacks?.delete(subscribedCallback);
        if (callbacks?.size === 0) this.subscribers.delete(property);
      }
    };
  }

  #read({ key, read, transform }) {
    let value = this.settings[read](key);
    if (transform) value = transform(value);
    return value;
  }

  #notify(property, value) {
    for (const callback of this.subscribers.get(property) ?? [])
      callback(value, property);
  }

  destroy() {
    if (!this.settings) return;
    for (const signalId of this.signalIds) this.settings.disconnect(signalId);
    this.signalIds.length = 0;
    this.subscribers.clear();
    this.settings = null;
    this.definitions = null;
  }
}

/** Owns every Shell settings scope for the extension lifecycle. */
export default class MediaShellSettings {
  constructor(gsettings) {
    // GNOME Shell keybinding registration requires the native Gio.Settings object.
    // Expose it only through this purpose-specific capability; all ordinary runtime
    // settings flow through the scoped views below.
    this.keybindings = gsettings;
    try {
      this.popup = new SettingsScope(gsettings, POPUP_DEFINITIONS);
      this.topBar = new SettingsScope(gsettings, TOP_BAR_DEFINITIONS);
      this.panel = new SettingsScope(gsettings, PANEL_DEFINITIONS);
      this.interactions = new SettingsScope(gsettings, INTERACTION_DEFINITIONS);
      this.integration = new SettingsScope(gsettings, INTEGRATION_DEFINITIONS);
      this.media = new SettingsScope(gsettings, MEDIA_DEFINITIONS);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy() {
    for (const scope of [
      this.media,
      this.integration,
      this.interactions,
      this.panel,
      this.topBar,
      this.popup,
    ])
      scope?.destroy();

    this.popup = null;
    this.topBar = null;
    this.panel = null;
    this.interactions = null;
    this.integration = null;
    this.media = null;
    this.keybindings = null;
  }
}
