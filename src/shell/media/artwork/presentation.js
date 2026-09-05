/**
 * @file presentation.js
 * @module shell.media.artwork.presentation
 *
 * Provides stateless artwork geometry and GdkPixbuf transforms shared by Shell
 * surfaces. Request lifecycle, cancellation, cache, and actors remain owned by
 * their respective runtime/service or UI owners.
 */

import GdkPixbuf from "gi://GdkPixbuf";
import GLib from "gi://GLib";

/** Outline width shared by artwork frames on every Shell surface. */
export const ARTWORK_OUTLINE_WIDTH = 1;

/** Internal render scale used for decoded and transformed artwork. */
export const ARTWORK_RENDER_SCALE = 2;

const FALLBACK_ICON_SIZE_RATIO = 0.48;

function normalizePositiveInteger(value, fallback = 1) {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue > 0
    ? Math.max(1, Math.round(numericValue))
    : fallback;
}

/** Converts a relative corner preference to a radius for a square artwork actor. */
export function resolveArtworkCornerRadius(size, percentage) {
  const safeSize = normalizePositiveInteger(size);
  const safePercentage = Math.min(
    100,
    Math.max(0, Number.isFinite(percentage) ? percentage : 0),
  );
  return Math.round((safeSize * safePercentage) / 200);
}

/** Returns presentation geometry shared by popup, top-bar, and native artwork. */
export function resolveArtworkPresentationGeometry(size, radius) {
  const frameSize = Math.max(1, Math.round(Number(size) || 0));
  const frameRadius = Math.min(
    Math.max(0, Math.round(Number(radius) || 0)),
    Math.round(frameSize / 2),
  );
  const imageSize = Math.max(1, frameSize - ARTWORK_OUTLINE_WIDTH * 2);
  const imageRadius = Math.max(
    0,
    Math.min(frameRadius - ARTWORK_OUTLINE_WIDTH, Math.round(imageSize / 2)),
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

/** Scales and center-crops a pixbuf to a square, matching CSS cover behavior. */
export function cropPixbufToSquare(pixbuf, size) {
  const targetSize = Math.max(1, Math.round(size));
  const sourceWidth = pixbuf.get_width();
  const sourceHeight = pixbuf.get_height();
  if (sourceWidth <= 0 || sourceHeight <= 0) return pixbuf;

  const scale = Math.max(targetSize / sourceWidth, targetSize / sourceHeight);
  const scaledWidth = Math.max(targetSize, Math.round(sourceWidth * scale));
  const scaledHeight = Math.max(targetSize, Math.round(sourceHeight * scale));
  const scaled = pixbuf.scale_simple(
    scaledWidth,
    scaledHeight,
    GdkPixbuf.InterpType.BILINEAR,
  );
  if (!scaled) return pixbuf;

  const cropX = Math.max(0, Math.floor((scaledWidth - targetSize) / 2));
  const cropY = Math.max(0, Math.floor((scaledHeight - targetSize) / 2));
  return scaled.new_subpixbuf(cropX, cropY, targetSize, targetSize).copy();
}

function roundCornerRow(
  pixels,
  rowstride,
  channels,
  y,
  centerY,
  width,
  radius,
  radiusSquared,
  samples,
  sampleCount,
) {
  for (let xOffset = 0; xOffset < radius; xOffset++) {
    for (const x of [xOffset, width - 1 - xOffset]) {
      const centerX = x < radius ? radius : width - radius;
      let inside = 0;
      for (const sampleY of samples) {
        const deltaY = y + sampleY - centerY;
        const deltaYSquared = deltaY * deltaY;
        for (const sampleX of samples) {
          const deltaX = x + sampleX - centerX;
          if (deltaX * deltaX + deltaYSquared <= radiusSquared) inside++;
        }
      }
      if (inside === sampleCount) continue;
      const offset = y * rowstride + x * channels + 3;
      pixels[offset] = Math.round((pixels[offset] * inside) / sampleCount);
    }
  }
}

/** Applies anti-aliased rounded alpha corners to a pixbuf. */
export function roundPixbufCorners(pixbuf, radius) {
  let source = pixbuf;
  if (!source.get_has_alpha()) source = source.add_alpha(false, 0, 0, 0);

  const width = source.get_width();
  const height = source.get_height();
  const cornerRadius = Math.min(
    Math.floor(radius),
    Math.floor(Math.min(width, height) / 2),
  );
  if (cornerRadius <= 0) return source;

  const rowstride = source.get_rowstride();
  const channels = source.get_n_channels();
  const pixels = new Uint8Array(source.get_pixels());
  const samples = [0.125, 0.375, 0.625, 0.875];
  const sampleCount = samples.length * samples.length;
  const radiusSquared = cornerRadius * cornerRadius;

  for (let y = 0; y < cornerRadius; y++) {
    roundCornerRow(
      pixels,
      rowstride,
      channels,
      y,
      cornerRadius,
      width,
      cornerRadius,
      radiusSquared,
      samples,
      sampleCount,
    );
    roundCornerRow(
      pixels,
      rowstride,
      channels,
      height - 1 - y,
      height - cornerRadius,
      width,
      cornerRadius,
      radiusSquared,
      samples,
      sampleCount,
    );
  }

  return GdkPixbuf.Pixbuf.new_from_bytes(
    GLib.Bytes.new(pixels),
    source.get_colorspace(),
    source.get_has_alpha(),
    source.get_bits_per_sample(),
    width,
    height,
    rowstride,
  );
}

/** Orients, center-crops, and rounds artwork for a square Shell icon. */
export function prepareArtworkPixbuf(pixbuf, size, radius) {
  const imageSize = Math.max(1, Math.round(size));
  const imageRadius = Math.max(0, Math.round(radius));
  const renderSize = imageSize * ARTWORK_RENDER_SCALE;
  const orientedPixbuf = pixbuf.apply_embedded_orientation?.() ?? pixbuf;
  const squarePixbuf = cropPixbufToSquare(orientedPixbuf, renderSize);

  return imageRadius > 0
    ? roundPixbufCorners(squarePixbuf, imageRadius * ARTWORK_RENDER_SCALE)
    : squarePixbuf;
}
