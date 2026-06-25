/**
 * @file TopBarAppIcon.js
 * @module shell.ui.topBar.TopBarAppIcon
 *
 * Displays the active media application's icon in the GNOME top bar.
 *
 * TopBarButton owns this component and supplies the resolved Shell app or themed
 * fallback icon. The component keeps icon actor creation and updates separate
 * from track text, visualizer, and playback control layout.
 */
import MediaAppResolver, { FALLBACK_MEDIA_APP_ICON_NAME } from "../../services/MediaAppResolver.js";
import { createIcon, setGIcon } from "../IconUtils.js";

export default class TopBarAppIcon {
    constructor(topBarButton) {
        this.topBarButton = topBarButton;
        this.actor = null;
        this.iconKey = null;
        this.usesColoredIcon = null;
        this.mediaAppResolver = MediaAppResolver.getInstance();
    }

    render(index, parentBox) {
        const identity = this.topBarButton.mediaApp.identity;
        const desktopEntry = this.topBarButton.mediaApp.desktopEntry;
        const useColoredIcon = this.topBarButton.extensionController.useColoredTopBarAppIcon;
        const iconKey = `${this.topBarButton.mediaApp.busName}\u0001${identity}\u0001${desktopEntry}`;

        // St can retain the previously resolved symbolic/regular texture when
        // only the CSS icon style changes. Replacing this tiny actor on a mode
        // toggle makes the setting visible immediately without rebuilding the
        // complete top bar button.
        if (!this.actor || this.usesColoredIcon !== useColoredIcon) this.replaceIconActor(index, useColoredIcon);

        if (iconKey !== this.iconKey) {
            const app = this.mediaAppResolver.resolveMediaApp(identity, desktopEntry, this.topBarButton.mediaApp.busName);
            setGIcon(this.actor, this.mediaAppResolver.getMediaAppIcon(app), FALLBACK_MEDIA_APP_ICON_NAME);
            // Do not memoize a transient miss: Shell may associate a browser
            // window with its desktop app shortly after MPRIS appears.
            this.iconKey = app && this.mediaAppResolver.hasResolvedMediaAppIcon(app) ? iconKey : null;
        }

        this.attach(index, parentBox);
    }

    replaceIconActor(index, useColoredIcon) {
        const previous = this.actor;
        const parent = previous?.get_parent() ?? null;
        const previousIndex = parent ? parent.get_children().indexOf(previous) : -1;

        this.actor = createIcon(
            {
                styleClass: `system-status-icon no-margin ${useColoredIcon ? "colored-icon" : "symbolic-icon"}`,
            },
            FALLBACK_MEDIA_APP_ICON_NAME,
        );
        this.iconKey = null;
        this.usesColoredIcon = useColoredIcon;

        if (parent) {
            parent.insert_child_at_index(this.actor, previousIndex >= 0 ? previousIndex : index);
            parent.remove_child(previous);
        }
        previous?.destroy();
    }

    attach(index, parentBox) {
        const parent = this.actor.get_parent();
        const currentIndex = parent === parentBox ? parentBox.get_children().indexOf(this.actor) : -1;
        if (currentIndex === index) return;

        parent?.remove_child(this.actor);
        parentBox.insert_child_at_index(this.actor, index);
    }

    remove() {
        if (!this.actor) return;
        this.actor.get_parent()?.remove_child(this.actor);
        this.actor.destroy();
        this.actor = null;
        this.iconKey = null;
        this.usesColoredIcon = null;
        this.mediaAppResolver = MediaAppResolver.getInstance();
    }

    destroy() {
        this.remove();
        this.topBarButton = null;
    }
}
