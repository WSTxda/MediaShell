/**
 * @file albumArtPresentation.js
 * @module shell.utils.albumArtPresentation
 *
 * Applies the shared Shell-side album-art frame, geometry, and fallback
 * presentation used by popup and top-bar renderers. Actor creation and
 * lifecycle stay with each surface owner.
 */

import { ALBUM_ART_OUTLINE_WIDTH } from "../constants/albumArt.js";
import { StyleClasses } from "../constants/styleClasses.js";

const FALLBACK_ICON_RATIO = 0.48;

/** Returns the square image size inside the shared one-pixel frame. */
function getAlbumArtImageSize(size) {
  return Math.max(1, Math.round(size - ALBUM_ART_OUTLINE_WIDTH * 2));
}

/** Returns the inner image radius aligned with the outer frame radius. */
function getAlbumArtImageRadius(radius) {
  return Math.max(0, radius - ALBUM_ART_OUTLINE_WIDTH);
}

/** Applies identical frame/image geometry without changing surface layout. */
export function syncAlbumArtGeometry(frame, image, size, radius) {
  const imageSize = getAlbumArtImageSize(size);
  const imageRadius = getAlbumArtImageRadius(radius);

  frame.style = `border-radius: ${radius}px; padding: ${ALBUM_ART_OUTLINE_WIDTH}px;`;
  frame.width = size;
  frame.height = size;
  image.style = `border-radius: ${imageRadius}px;`;
  image.width = imageSize;
  image.height = imageSize;

  return { imageSize, imageRadius };
}

/** Removes the theme surface used only by the empty-artwork fallback. */
export function setAlbumArtImagePresentation(image) {
  image.content = null;
  image.remove_style_class_name(StyleClasses.BUTTON);
  image.remove_style_class_name(StyleClasses.ALBUM_ART_FALLBACK);
}

/** Applies the same theme-aware fallback surface to every artwork renderer. */
export function setAlbumArtFallbackPresentation(image) {
  image.content = null;
  image.add_style_class_name(StyleClasses.BUTTON);
  image.add_style_class_name(StyleClasses.ALBUM_ART_FALLBACK);
}

/** Returns the fallback glyph size relative to the available image surface. */
export function getAlbumArtFallbackIconSize(imageSize) {
  return Math.max(1, Math.round(imageSize * FALLBACK_ICON_RATIO));
}
