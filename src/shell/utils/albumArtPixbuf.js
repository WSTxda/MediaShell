/**
 * @file albumArtPixbuf.js
 * @module shell.utils.albumArtPixbuf
 *
 * Provides stateless GdkPixbuf transforms used by album-art renderers.
 *
 * Each renderer retains request, cancellation, actor, and fallback ownership;
 * this module only scales, crops, and rounds already decoded pixel buffers.
 */

import GdkPixbuf from "gi://GdkPixbuf";
import GLib from "gi://GLib";

import { ALBUM_ART_RENDER_SCALE } from "../constants/albumArt.js";

/**
 * Scales and center-crops a pixbuf to a square, matching CSS cover behavior.
 *
 * @param {GdkPixbuf.Pixbuf} pixbuf - Decoded source pixbuf.
 * @param {number} size - Target square size in pixels.
 * @returns {GdkPixbuf.Pixbuf} Square pixbuf or the original on transform failure.
 */
function cropPixbufToSquare(pixbuf, size) {
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

/**
 * Applies anti-aliased rounded alpha corners to a pixbuf.
 *
 * @param {GdkPixbuf.Pixbuf} pixbuf - Square source pixbuf.
 * @param {number} radius - Corner radius in pixels.
 * @returns {GdkPixbuf.Pixbuf} Pixbuf with rounded alpha corners.
 */
function roundPixbufCorners(pixbuf, radius) {
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

/**
 * Prepares one decoded pixbuf for the shared album-art frame geometry.
 *
 * @param {GdkPixbuf.Pixbuf} pixbuf - Decoded source pixbuf.
 * @param {number} imageSize - Inner image actor size.
 * @param {number} imageRadius - Inner image corner radius.
 * @returns {GdkPixbuf.Pixbuf} Square, oriented, optionally rounded render pixbuf.
 */
export function prepareAlbumArtPixbuf(pixbuf, imageSize, imageRadius) {
  const renderSize = Math.max(
    1,
    Math.round(imageSize * ALBUM_ART_RENDER_SCALE),
  );
  const renderRadius = Math.max(
    0,
    Math.round(imageRadius * ALBUM_ART_RENDER_SCALE),
  );
  const orientedPixbuf = pixbuf.apply_embedded_orientation?.() ?? pixbuf;
  const squarePixbuf = cropPixbufToSquare(orientedPixbuf, renderSize);
  return renderRadius > 0
    ? roundPixbufCorners(squarePixbuf, renderRadius)
    : squarePixbuf;
}
