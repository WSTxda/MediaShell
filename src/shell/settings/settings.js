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
  POPUP_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS,
  POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
  POPUP_WIDTH_CONSTRAINTS,
  SettingsKeys,
  TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
  TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS,
  TOP_BAR_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS,
  TOP_BAR_ELEMENT_ORDER_DEFAULT,
  TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
  PANEL_INDEX_CONSTRAINTS,
  TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS,
  TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS,
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

function defineSetting(key, read, transform = null) {
  return Object.freeze({ key, read, transform });
}

const POPUP_DEFINITIONS = Object.freeze({
  width: defineSetting(
    SettingsKeys.POPUP_WIDTH,
    "get_uint",
    createNumericConstraint(POPUP_WIDTH_CONSTRAINTS),
  ),
  artworkShow: defineSetting(SettingsKeys.POPUP_ARTWORK_SHOW, "get_boolean"),
  artworkCornerRadiusPercent: defineSetting(
    SettingsKeys.POPUP_ARTWORK_CORNER_RADIUS_PERCENT,
    "get_uint",
    createNumericConstraint(POPUP_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS),
  ),
  trackInformationShow: defineSetting(
    SettingsKeys.POPUP_TRACK_INFORMATION_SHOW,
    "get_boolean",
  ),
  trackInformationContent: defineSetting(
    SettingsKeys.POPUP_TRACK_INFORMATION_CONTENT,
    "get_strv",
    (value) =>
      normalizeTrackInformationContent(
        value,
        POPUP_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
  ),
  progressBarShow: defineSetting(
    SettingsKeys.POPUP_PROGRESS_BAR_SHOW,
    "get_boolean",
  ),
  playbackControlsShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHOW,
    "get_boolean",
  ),
  playbackControlsShuffleShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekBackwardShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsPreviousTrackShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsPlayPauseShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
    "get_boolean",
  ),
  playbackControlsNextTrackShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekForwardShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsRepeatShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_REPEAT_SHOW,
    "get_boolean",
  ),
  playbackControlsSpeedShow: defineSetting(
    SettingsKeys.POPUP_PLAYBACK_CONTROLS_SPEED_SHOW,
    "get_boolean",
  ),
  volumeControlShow: defineSetting(
    SettingsKeys.POPUP_VOLUME_CONTROL_SHOW,
    "get_boolean",
  ),
  trackInformationScrollEnabled: defineSetting(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_ENABLED,
    "get_boolean",
  ),
  trackInformationScrollSpeed: defineSetting(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_SPEED,
    "get_uint",
    createNumericConstraint(TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS),
  ),
  trackInformationScrollPauseMilliseconds: defineSetting(
    SettingsKeys.POPUP_TRACK_INFORMATION_SCROLL_PAUSE_SECONDS,
    "get_uint",
    createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
  ),
  playerSelectorAppIconUseColor: defineSetting(
    SettingsKeys.POPUP_PLAYER_SELECTOR_APP_ICON_USE_COLOR,
    "get_boolean",
  ),
});

const TOP_BAR_DEFINITIONS = Object.freeze({
  trackInformationShow: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SHOW,
    "get_boolean",
  ),
  trackInformationWidth: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_WIDTH,
    "get_uint",
    createNumericConstraint(TOP_BAR_TRACK_INFORMATION_WIDTH_CONSTRAINTS),
  ),
  trackInformationFixedWidth: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_FIXED_WIDTH,
    "get_boolean",
  ),
  trackInformationScrollEnabled: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_ENABLED,
    "get_boolean",
  ),
  trackInformationScrollSpeed: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_SPEED,
    "get_uint",
    createNumericConstraint(TRACK_INFORMATION_SCROLL_SPEED_CONSTRAINTS),
  ),
  trackInformationScrollPauseMilliseconds: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_SCROLL_PAUSE_SECONDS,
    "get_uint",
    createSecondsToMillisecondsTransform(
      TRACK_INFORMATION_SCROLL_PAUSE_SECONDS_CONSTRAINTS,
    ),
  ),
  trackInformationContent: defineSetting(
    SettingsKeys.TOP_BAR_TRACK_INFORMATION_CONTENT,
    "get_strv",
    (value) =>
      normalizeTrackInformationContent(
        value,
        TOP_BAR_TRACK_INFORMATION_CONTENT_DEFAULT,
      ),
  ),
  appIconShow: defineSetting(SettingsKeys.TOP_BAR_APP_ICON_SHOW, "get_boolean"),
  appIconUseColor: defineSetting(
    SettingsKeys.TOP_BAR_APP_ICON_USE_COLOR,
    "get_boolean",
  ),
  artworkShow: defineSetting(SettingsKeys.TOP_BAR_ARTWORK_SHOW, "get_boolean"),
  artworkCornerRadiusPercent: defineSetting(
    SettingsKeys.TOP_BAR_ARTWORK_CORNER_RADIUS_PERCENT,
    "get_uint",
    createNumericConstraint(TOP_BAR_ARTWORK_CORNER_RADIUS_PERCENT_CONSTRAINTS),
  ),
  visualizerShow: defineSetting(
    SettingsKeys.TOP_BAR_VISUALIZER_SHOW,
    "get_boolean",
  ),
  visualizerStyle: defineSetting(
    SettingsKeys.TOP_BAR_VISUALIZER_STYLE,
    "get_enum",
  ),
  visualizerSpeed: defineSetting(
    SettingsKeys.TOP_BAR_VISUALIZER_SPEED,
    "get_uint",
    createNumericConstraint(TOP_BAR_VISUALIZER_SPEED_CONSTRAINTS),
  ),
  playbackControlsShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHOW,
    "get_boolean",
  ),
  playbackControlsShuffleShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SHUFFLE_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekBackwardShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_BACKWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsPreviousTrackShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PREVIOUS_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsPlayPauseShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_PLAY_PAUSE_SHOW,
    "get_boolean",
  ),
  playbackControlsNextTrackShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_NEXT_TRACK_SHOW,
    "get_boolean",
  ),
  playbackControlsSeekForwardShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_SEEK_FORWARD_SHOW,
    "get_boolean",
  ),
  playbackControlsRepeatShow: defineSetting(
    SettingsKeys.TOP_BAR_PLAYBACK_CONTROLS_REPEAT_SHOW,
    "get_boolean",
  ),
  elementOrder: defineSetting(
    SettingsKeys.TOP_BAR_ELEMENT_ORDER,
    "get_strv",
    (value) => normalizeOrderedValues(value, TOP_BAR_ELEMENT_ORDER_DEFAULT),
  ),
});

const PANEL_DEFINITIONS = Object.freeze({
  position: defineSetting(SettingsKeys.PANEL_POSITION, "get_enum", (value) =>
    enumValueByIndex(PanelPositions, value),
  ),
  index: defineSetting(
    SettingsKeys.PANEL_INDEX,
    "get_uint",
    createNumericConstraint(PANEL_INDEX_CONSTRAINTS),
  ),
});

const INTERACTIONS_DEFINITIONS = Object.freeze({
  mouseActionLeft: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_LEFT,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionMiddle: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_MIDDLE,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionRight: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_RIGHT,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionDouble: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_DOUBLE,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionScrollUp: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_UP,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
  mouseActionScrollDown: defineSetting(
    SettingsKeys.INTERACTIONS_MOUSE_ACTION_SCROLL_DOWN,
    "get_enum",
    (value) => normalizeInputAction(value, InputActions.NONE),
  ),
});

const NATIVE_CONTROLS_DEFINITIONS = Object.freeze({
  hide: defineSetting(SettingsKeys.NATIVE_CONTROLS_HIDE, "get_boolean"),
  enhance: defineSetting(SettingsKeys.NATIVE_CONTROLS_ENHANCE, "get_boolean"),
});

const MEDIA_DEFINITIONS = Object.freeze({
  artworkCacheEnabled: defineSetting(
    SettingsKeys.MEDIA_ARTWORK_CACHE_ENABLED,
    "get_boolean",
  ),
  blockedAppIds: defineSetting(
    SettingsKeys.MEDIA_BLOCKED_APPS,
    "get_strv",
    normalizeUniqueStrings,
  ),
});

export const SettingScopes = Object.freeze({
  POPUP: "popup",
  TOP_BAR: "topBar",
  PANEL: "panel",
  INTERACTIONS: "interactions",
  NATIVE_CONTROLS: "nativeControls",
  MEDIA: "media",
});

const SETTING_SCOPE_DEFINITIONS = Object.freeze({
  [SettingScopes.POPUP]: POPUP_DEFINITIONS,
  [SettingScopes.TOP_BAR]: TOP_BAR_DEFINITIONS,
  [SettingScopes.PANEL]: PANEL_DEFINITIONS,
  [SettingScopes.INTERACTIONS]: INTERACTIONS_DEFINITIONS,
  [SettingScopes.NATIVE_CONTROLS]: NATIVE_CONTROLS_DEFINITIONS,
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
      this.interactions = new SettingsScope(
        gsettings,
        INTERACTIONS_DEFINITIONS,
      );
      this.nativeControls = new SettingsScope(
        gsettings,
        NATIVE_CONTROLS_DEFINITIONS,
      );
      this.media = new SettingsScope(gsettings, MEDIA_DEFINITIONS);
    } catch (error) {
      this.destroy();
      throw error;
    }
  }

  destroy() {
    for (const scope of [
      this.media,
      this.nativeControls,
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
    this.nativeControls = null;
    this.media = null;
    this.keybindings = null;
  }
}
