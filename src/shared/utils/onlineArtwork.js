/**
 * @file onlineArtwork.js
 * @module shared.utils.onlineArtwork
 *
 * Provides pure URL rewriting and metadata normalization for online artwork resolution.
 *
 * Firefox and direct streaming services expose low-resolution CDN URLs that can be
 * rewritten to high-resolution variants synchronously. Chromium downscales artwork
 * to 150x150 local files; for these, clean search queries are built to query public
 * keyless artwork providers (iTunes Search API).
 */

const BROWSER_BUS_NAME_PATTERN =
  /\.(?:chromium|chrome|google-chrome|google_chrome|brave|firefox|microsoft-edge|edge|opera|vivaldi|zen)(?:\.|$)/i;

const TEMP_FILE_URI_PATTERN = /^file:\/\/\/(?:tmp|var\/tmp)\//i;

const YOUTUBE_TITLE_NOISE_PATTERNS = [
  /\s*[\(\[](?:official\s+(?:music\s+)?video|official\s+audio|lyric\s+video|video\s+clip|lyrics|audio|visualizer|hd|4k|mv|music\s+video)[\)\]]/gi,
  /\s*[\(\[](?:feat\.|ft\.)\s+[^\)\]]+[\)\]]/gi,
];

const GOOGLE_USERCONTENT_SIZE_PATTERN =
  /=(?:w\d+-h\d+|s\d+)(-[a-z0-9-]+)?(\?.*)?$/i;

const YOUTUBE_THUMBNAIL_FILENAME_PATTERN =
  /\/(?:hqdefault|mqdefault)\.jpg(\?.*)?$/i;

const SPOTIFY_IMAGE_SIZE_PATTERN = /\/ab67616d0000(?:4851|1e02)([0-9a-f]{24})/i;

const SOUNDCLOUD_IMAGE_SIZE_PATTERN =
  /-(?:large|t\d+x\d+)\.(jpg|png|webp)(\?.*)?$/i;

const BANDCAMP_IMAGE_SIZE_PATTERN = /_(\d+)\.(jpg|png)(\?.*)?$/i;

const ITUNES_ARTWORK_DIMENSION_PATTERN = /\/\d+x\d+bb\.([a-z]+)(?:\?.*)?$/i;

/**
 * Detects whether an MPRIS bus name belongs to a web browser.
 *
 * @param {string} busName - MPRIS bus name.
 * @returns {boolean} True if the bus name indicates a web browser.
 */
export function isBrowserBusName(busName) {
  return typeof busName === "string" && BROWSER_BUS_NAME_PATTERN.test(busName);
}

/**
 * Detects whether an artwork URI points to a temporary thumbnail file.
 *
 * @param {string} uri - Artwork URI.
 * @returns {boolean} True if the URI points to a file in /tmp or /var/tmp.
 */
export function isTempThumbnailUri(uri) {
  return typeof uri === "string" && TEMP_FILE_URI_PATTERN.test(uri);
}

/**
 * Rewrites known streaming CDN URLs to request maximum resolution assets.
 *
 * Supported services:
 * - YouTube Music / Google UserContent (=w...-h... or =s... replaced with =w800-h800-l90-rj)
 * - YouTube Video Thumbnails (hqdefault.jpg / mqdefault.jpg replaced with maxresdefault.jpg)
 * - Spotify CDN (ab67616d00004851 / 1e02 replaced with ab67616d0000b273 for 640x640)
 * - SoundCloud (-large.jpg or -t...x... replaced with -t500x500)
 * - Bandcamp (_<num>.jpg replaced with _10.jpg for full resolution)
 *
 * @param {string} url - Original artwork URL.
 * @returns {string} Rewritten high-res URL or the original URL if no match.
 */
export function rewriteCdnArtworkUrl(url) {
  if (typeof url !== "string" || !url.startsWith("http")) return url;

  // 1. YouTube Music / Google UserContent
  if (
    url.includes("googleusercontent.com") ||
    url.includes("ggpht.com") ||
    url.includes("ytimg.com")
  ) {
    // YouTube video thumbnails: hqdefault.jpg -> maxresdefault.jpg
    if (url.includes("/hqdefault.jpg") || url.includes("/mqdefault.jpg")) {
      return url.replace(
        YOUTUBE_THUMBNAIL_FILENAME_PATTERN,
        "/maxresdefault.jpg$1",
      );
    }

    // Google image sizing parameters: =w60-h60, =s120-c, etc.
    if (GOOGLE_USERCONTENT_SIZE_PATTERN.test(url)) {
      return url.replace(
        GOOGLE_USERCONTENT_SIZE_PATTERN,
        "=w800-h800-l90-rj$2",
      );
    }
  }

  // 2. Spotify CDN: i.scdn.co/image/ab67616d0000<size><id>
  // 4851 = 64x64, 1e02 = 300x300, b273 = 640x640
  if (url.includes("i.scdn.co/image/")) {
    if (SPOTIFY_IMAGE_SIZE_PATTERN.test(url)) {
      return url.replace(SPOTIFY_IMAGE_SIZE_PATTERN, "/ab67616d0000b273$1");
    }
  }

  // 3. SoundCloud: *-large.jpg or *-t<size>x<size>.jpg -> *-t500x500.jpg
  if (url.includes("sndcdn.com")) {
    if (SOUNDCLOUD_IMAGE_SIZE_PATTERN.test(url)) {
      return url.replace(SOUNDCLOUD_IMAGE_SIZE_PATTERN, "-t500x500.$1$2");
    }
  }

  // 4. Bandcamp: f4.bcbits.com/img/a<id>_<number>.jpg -> _10.jpg (original size)
  if (url.includes("bcbits.com/img/")) {
    const match = url.match(BANDCAMP_IMAGE_SIZE_PATTERN);
    if (match && match[1] !== "10") {
      return url.replace(BANDCAMP_IMAGE_SIZE_PATTERN, "_10.$2$3");
    }
  }

  return url;
}

/**
 * Sanitizes track titles (especially from YouTube / web players) for search queries.
 *
 * Strips music video labels, parenthetical tags, and artist prefixes.
 *
 * @param {string} title - Raw track title from MPRIS.
 * @param {string} [artist=""] - Artist name from MPRIS.
 * @returns {string} Sanitized track title suitable for search queries.
 */
export function cleanTrackTitleForSearch(title, artist = "") {
  if (typeof title !== "string") return "";
  let clean = title.trim();

  // If title has "Artist - Song", strip the redundant artist prefix
  if (artist && typeof artist === "string" && artist.trim()) {
    const trimmedArtist = artist.trim();
    const artistPrefix = `${trimmedArtist} - `;
    if (clean.toLowerCase().startsWith(artistPrefix.toLowerCase())) {
      clean = clean.slice(artistPrefix.length).trim();
    }
  }

  // Strip YouTube parenthetical/bracket video noise
  for (const pattern of YOUTUBE_TITLE_NOISE_PATTERNS) {
    clean = clean.replace(pattern, "");
  }

  // Normalize multi-spaces
  return clean.replace(/\s+/g, " ").trim();
}

/**
 * Builds the query URL for the public iTunes Search API.
 *
 * @param {string} title - Track title.
 * @param {string} [artist=""] - Track artist.
 * @returns {string|null} Search URL or null if title is empty.
 */
export function buildOnlineArtworkSearchUrl(title, artist = "") {
  const cleanTitle = cleanTrackTitleForSearch(title, artist);
  if (!cleanTitle) return null;

  const cleanArtist = typeof artist === "string" ? artist.trim() : "";
  const searchTerm = cleanArtist ? `${cleanArtist} ${cleanTitle}` : cleanTitle;

  return `https://itunes.apple.com/search?term=${encodeURIComponent(searchTerm)}&entity=song&limit=1`;
}

/**
 * Extracts a high-resolution artwork URL (1000x1000) from an iTunes Search API JSON response.
 *
 * @param {string} jsonString - Raw JSON response from iTunes Search API.
 * @returns {string|null} 1000x1000 artwork URL or null if not found.
 */
export function extractHighResArtworkUrlFromSearchResult(jsonString) {
  if (typeof jsonString !== "string" || !jsonString.trim()) return null;

  try {
    const data = JSON.parse(jsonString);
    if (!data || !Array.isArray(data.results) || data.results.length === 0) {
      return null;
    }

    const firstResult = data.results[0];
    const rawArtworkUrl = firstResult.artworkUrl100 || firstResult.artworkUrl60;
    if (typeof rawArtworkUrl !== "string" || !rawArtworkUrl) return null;

    // iTunes artwork URLs end with e.g. /100x100bb.jpg or /60x60bb.jpg
    return rawArtworkUrl.replace(
      ITUNES_ARTWORK_DIMENSION_PATTERN,
      "/1000x1000bb.$1",
    );
  } catch {
    return null;
  }
}
