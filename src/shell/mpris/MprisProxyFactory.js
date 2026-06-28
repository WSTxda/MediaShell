/**
 * @file MprisProxyFactory.js
 * @module shell.mpris.MprisProxyFactory
 *
 * Loads bundled D-Bus introspection and creates typed MPRIS proxies.
 *
 * The factory owns the parsed introspection cache for one extension lifecycle and
 * creates root, player, properties, and bus-watch proxies with a shared
 * cancellable. MediaAppRegistry depends on it for every MPRIS endpoint it tracks.
 */

import Gio from "gi://Gio";

import {
    DBUS_IFACE_NAME,
    DBUS_OBJECT_PATH,
    DBUS_PROPERTIES_IFACE_NAME,
    MPRIS_IFACE_NAME,
    MPRIS_OBJECT_PATH,
    MPRIS_PLAYER_IFACE_NAME,
} from "../../shared/constants/dbus.js";
import { createLogger } from "../../shared/utils/log.js";
import { isCancellationError } from "../utils/errors.js";

Gio._promisify(Gio.File.prototype, "load_contents_async", "load_contents_finish");
Gio._promisify(Gio.DBusProxy, "new", "new_finish");

const logger = createLogger("MprisProxyFactory");
const MPRIS_INTROSPECTION_XML_URI = "resource:///org/gnome/shell/extensions/mediashell/dbus/mprisNode.xml";
const DBUS_WATCH_INTROSPECTION_XML_URI = "resource:///org/gnome/shell/extensions/mediashell/dbus/watchNode.xml";
async function readXmlResource(uri, cancellable) {
    const [bytes] = await Gio.File.new_for_uri(uri).load_contents_async(cancellable);
    return new TextDecoder().decode(bytes);
}

async function loadMprisIntrospectionData(cancellable) {
    const [mprisIntrospectionXml, dbusWatchIntrospectionXml] = await Promise.all([
        readXmlResource(MPRIS_INTROSPECTION_XML_URI, cancellable),
        readXmlResource(DBUS_WATCH_INTROSPECTION_XML_URI, cancellable),
    ]);
    const mprisNodeInfo = Gio.DBusNodeInfo.new_for_xml(mprisIntrospectionXml);
    const dbusWatchNodeInfo = Gio.DBusNodeInfo.new_for_xml(dbusWatchIntrospectionXml);
    const introspectionData = {
        mprisNodeInfo,
        dbusWatchNodeInfo,
        rootInterfaceInfo: mprisNodeInfo.lookup_interface(MPRIS_IFACE_NAME),
        playerInterfaceInfo: mprisNodeInfo.lookup_interface(MPRIS_PLAYER_IFACE_NAME),
        propertiesInterfaceInfo: mprisNodeInfo.lookup_interface(DBUS_PROPERTIES_IFACE_NAME),
        busInterfaceInfo: dbusWatchNodeInfo.lookup_interface(DBUS_IFACE_NAME),
    };

    if (
        !introspectionData.rootInterfaceInfo ||
        !introspectionData.playerInterfaceInfo ||
        !introspectionData.propertiesInterfaceInfo ||
        !introspectionData.busInterfaceInfo
    )
        throw new Error("The bundled D-Bus introspection data is incomplete");

    logger.debug("Loaded bundled MPRIS introspection data");
    return introspectionData;
}

/**
 * Loads bundled D-Bus introspection and creates typed MPRIS proxies.
 */
export default class MprisProxyFactory {
    constructor() {
        this.isDestroyed = false;
        this.initializationGeneration = 0;
        this.initializationCancellable = null;
        this.introspectionDataPromise = null;
    }

    async init() {
        const initializationGeneration = ++this.initializationGeneration;
        this.initializationCancellable?.cancel();
        const initializationCancellable = new Gio.Cancellable();
        const introspectionDataPromise = loadMprisIntrospectionData(initializationCancellable);
        this.initializationCancellable = initializationCancellable;
        this.introspectionDataPromise = introspectionDataPromise;

        try {
            const introspectionData = await introspectionDataPromise;
            if (this.isDestroyed || initializationGeneration !== this.initializationGeneration) return false;

            // Introspection XML is loaded once per enable cycle rather than per proxy.
            // Gio.DBusNodeInfo.new_for_xml() is synchronous but parses a non-trivial
            // document; caching the result avoids repeated parsing for every MPRIS
            // endpoint that appears on the bus, which can be several during session restore.
            Object.assign(this, introspectionData);
            return true;
        } catch (error) {
            if (
                isCancellationError(error) &&
                (this.isDestroyed || initializationGeneration !== this.initializationGeneration)
            )
                return false;
            throw error;
        } finally {
            if (this.initializationCancellable === initializationCancellable) this.initializationCancellable = null;
            if (this.introspectionDataPromise === introspectionDataPromise) this.introspectionDataPromise = null;
        }
    }

    createBusProxy(cancellable = null) {
        return this.createProxy(
            this.busInterfaceInfo,
            DBUS_IFACE_NAME,
            DBUS_OBJECT_PATH,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
            cancellable,
        );
    }

    createRootProxy(busName, cancellable = null) {
        return this.createProxy(
            this.rootInterfaceInfo,
            busName,
            MPRIS_OBJECT_PATH,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            cancellable,
        );
    }

    createPlayerProxy(busName, cancellable = null) {
        return this.createProxy(
            this.playerInterfaceInfo,
            busName,
            MPRIS_OBJECT_PATH,
            Gio.DBusProxyFlags.GET_INVALIDATED_PROPERTIES,
            cancellable,
        );
    }

    createPropertiesProxy(busName, cancellable = null) {
        return this.createProxy(
            this.propertiesInterfaceInfo,
            busName,
            MPRIS_OBJECT_PATH,
            Gio.DBusProxyFlags.DO_NOT_LOAD_PROPERTIES,
            cancellable,
        );
    }

    createProxy(interfaceInfo, busName, objectPath, flags, cancellable = null) {
        if (!interfaceInfo) throw new Error(`D-Bus interface is unavailable for ${busName}`);
        return Gio.DBusProxy.new(
            Gio.DBus.session,
            flags,
            interfaceInfo,
            busName,
            objectPath,
            interfaceInfo.name,
            cancellable,
        );
    }

    destroy() {
        this.isDestroyed = true;
        this.initializationGeneration++;
        this.initializationCancellable?.cancel();
        this.initializationCancellable = null;
        this.introspectionDataPromise = null;
        this.mprisNodeInfo = null;
        this.dbusWatchNodeInfo = null;
        this.rootInterfaceInfo = null;
        this.playerInterfaceInfo = null;
        this.propertiesInterfaceInfo = null;
        this.busInterfaceInfo = null;
    }
}
