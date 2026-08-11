/**
 * @file albumArtPresentation.js
 * @module shell.utils.albumArtPresentation
 *
 * Derives shared album-art frame, image, and fallback geometry for Shell surfaces.
 */

import { ALBUM_ART_OUTLINE_WIDTH } from "../constants/albumArt.js";

const FALLBACK_ICON_SIZE_RATIO = 0.48;

/** Returns presentation geometry shared by popup and top-bar album art. */
export function getAlbumArtPresentationGeometry(size, radius) {
  const frameSize = Math.max(1, Math.round(Number(size) || 0));
  const frameRadius = Math.min(
    Math.max(0, Math.round(Number(radius) || 0)),
    Math.round(frameSize / 2),
  );
  const imageSize = Math.max(1, frameSize - ALBUM_ART_OUTLINE_WIDTH * 2);
  const imageRadius = Math.max(
    0,
    Math.min(frameRadius - ALBUM_ART_OUTLINE_WIDTH, Math.round(imageSize / 2)),
  );

  return {
    frameSize,
    frameRadius,
    imageSize,
    imageRadius,
    fallbackIconSize: Math.max(
      1,
      Math.round(imageSize * FALLBACK_ICON_SIZE_RATIO),
    ),
  };
}
