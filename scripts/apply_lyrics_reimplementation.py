#!/usr/bin/env python3
from __future__ import annotations

import ast
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content.rstrip() + "\n", encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"Expected one anchor in {path}, found {count}: {old[:80]!r}")
    write(path, content.replace(old, new, 1))


def update_translations() -> None:
    translations = {
        "be": {
            "Lyrics": "Тэксты песень",
            "Synchronized lyrics": "Сінхранізаваныя тэксты",
            "Add a button to the secondary controls to show lyrics for the current track": "Дадаць кнопку ў дадатковыя элементы кіравання для паказу тэксту бягучага трэка",
            "Lyrics source": "Крыніца тэкстаў",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Тэксты прадастаўляе LRCLIB — адкрытая база даных, якую падтрымлівае супольнасць.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Пры адкрыцці рэжыму тэкстаў MediaShell адпраўляе ў LRCLIB назву, выканаўцу, альбом і працягласць бягучага трэка. Даступнасць і дакладнасць залежаць ад даных сэрвісу.",
            "Searching for lyrics…": "Пошук тэксту…",
            "Lyrics could not be found.": "Не ўдалося знайсці тэкст.",
            "Search the web": "Шукаць у сеціве",
            "This track is instrumental.": "Гэты трэк інструментальны.",
            "Close lyrics": "Закрыць тэксты",
            "Website": "Вэб-сайт",
        },
        "ca": {
            "Lyrics": "Lletres",
            "Synchronized lyrics": "Lletres sincronitzades",
            "Add a button to the secondary controls to show lyrics for the current track": "Afegeix un botó als controls secundaris per mostrar la lletra de la peça actual",
            "Lyrics source": "Font de les lletres",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Les lletres les proporciona LRCLIB, una base de dades oberta mantinguda per la comunitat.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "En obrir el mode de lletres, MediaShell envia a LRCLIB el títol, l'artista, l'àlbum i la durada de la peça actual. La disponibilitat i la precisió depenen de les dades del servei.",
            "Searching for lyrics…": "S'està cercant la lletra…",
            "Lyrics could not be found.": "No s'ha pogut trobar la lletra.",
            "Search the web": "Cerca al web",
            "This track is instrumental.": "Aquesta peça és instrumental.",
            "Close lyrics": "Tanca les lletres",
            "Website": "Lloc web",
        },
        "cs": {
            "Lyrics": "Texty",
            "Synchronized lyrics": "Synchronizované texty",
            "Add a button to the secondary controls to show lyrics for the current track": "Přidat do vedlejších ovládacích prvků tlačítko pro zobrazení textu aktuální skladby",
            "Lyrics source": "Zdroj textů",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Texty poskytuje LRCLIB, otevřená databáze spravovaná komunitou.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Po otevření režimu textů odešle MediaShell do LRCLIB název, interpreta, album a délku aktuální skladby. Dostupnost a přesnost závisí na datech služby.",
            "Searching for lyrics…": "Hledání textu…",
            "Lyrics could not be found.": "Text se nepodařilo najít.",
            "Search the web": "Hledat na webu",
            "This track is instrumental.": "Tato skladba je instrumentální.",
            "Close lyrics": "Zavřít texty",
            "Website": "Web",
        },
        "de": {
            "Lyrics": "Liedtexte",
            "Synchronized lyrics": "Synchronisierte Liedtexte",
            "Add a button to the secondary controls to show lyrics for the current track": "Eine Schaltfläche zu den sekundären Bedienelementen hinzufügen, um den Text des aktuellen Titels anzuzeigen",
            "Lyrics source": "Quelle der Liedtexte",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Die Liedtexte werden von LRCLIB bereitgestellt, einer offenen, gemeinschaftlich gepflegten Datenbank.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Beim Öffnen des Liedtextmodus sendet MediaShell Titel, Künstler, Album und Dauer des aktuellen Titels an LRCLIB. Verfügbarkeit und Genauigkeit hängen von den Daten des Dienstes ab.",
            "Searching for lyrics…": "Liedtext wird gesucht…",
            "Lyrics could not be found.": "Der Liedtext konnte nicht gefunden werden.",
            "Search the web": "Im Web suchen",
            "This track is instrumental.": "Dieser Titel ist instrumental.",
            "Close lyrics": "Liedtexte schließen",
            "Website": "Website",
        },
        "es": {
            "Lyrics": "Letras",
            "Synchronized lyrics": "Letras sincronizadas",
            "Add a button to the secondary controls to show lyrics for the current track": "Añadir un botón a los controles secundarios para mostrar la letra de la pista actual",
            "Lyrics source": "Fuente de las letras",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Las letras las proporciona LRCLIB, una base de datos abierta mantenida por la comunidad.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Al abrir el modo de letras, MediaShell envía a LRCLIB el título, el artista, el álbum y la duración de la pista actual. La disponibilidad y la precisión dependen de los datos del servicio.",
            "Searching for lyrics…": "Buscando la letra…",
            "Lyrics could not be found.": "No se pudo encontrar la letra.",
            "Search the web": "Buscar en la web",
            "This track is instrumental.": "Esta pista es instrumental.",
            "Close lyrics": "Cerrar las letras",
            "Website": "Sitio web",
        },
        "he": {
            "Lyrics": "מילים",
            "Synchronized lyrics": "מילים מסונכרנות",
            "Add a button to the secondary controls to show lyrics for the current track": "הוספת כפתור לפקדים המשניים להצגת מילות הרצועה הנוכחית",
            "Lyrics source": "מקור המילים",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "המילים מסופקות על ידי LRCLIB, מסד נתונים פתוח המתוחזק בידי הקהילה.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "בעת פתיחת מצב המילים, MediaShell שולח ל־LRCLIB את שם הרצועה, האמן, האלבום והמשך של הרצועה הנוכחית. הזמינות והדיוק תלויים בנתוני השירות.",
            "Searching for lyrics…": "מתבצע חיפוש אחר מילים…",
            "Lyrics could not be found.": "לא ניתן למצוא את המילים.",
            "Search the web": "חיפוש באינטרנט",
            "This track is instrumental.": "הרצועה הזאת אינסטרומנטלית.",
            "Close lyrics": "סגירת המילים",
            "Website": "אתר",
        },
        "it": {
            "Lyrics": "Testi",
            "Synchronized lyrics": "Testi sincronizzati",
            "Add a button to the secondary controls to show lyrics for the current track": "Aggiunge un pulsante ai controlli secondari per mostrare il testo del brano corrente",
            "Lyrics source": "Fonte dei testi",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "I testi sono forniti da LRCLIB, un database aperto gestito dalla comunità.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Quando si apre la modalità testi, MediaShell invia a LRCLIB titolo, artista, album e durata del brano corrente. Disponibilità e precisione dipendono dai dati del servizio.",
            "Searching for lyrics…": "Ricerca del testo…",
            "Lyrics could not be found.": "Impossibile trovare il testo.",
            "Search the web": "Cerca sul web",
            "This track is instrumental.": "Questo brano è strumentale.",
            "Close lyrics": "Chiudi i testi",
            "Website": "Sito web",
        },
        "pt_BR": {
            "Lyrics": "Letras",
            "Synchronized lyrics": "Letras sincronizadas",
            "Add a button to the secondary controls to show lyrics for the current track": "Adicionar um botão aos controles secundários para exibir a letra da faixa atual",
            "Lyrics source": "Origem das letras",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "As letras são fornecidas pelo LRCLIB, um banco de dados aberto e mantido pela comunidade.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Quando o modo de letras é aberto, o MediaShell envia ao LRCLIB o título, o artista, o álbum e a duração da faixa atual. A disponibilidade e a precisão dependem dos dados do serviço.",
            "Searching for lyrics…": "Buscando letra…",
            "Lyrics could not be found.": "Não foi possível encontrar a letra.",
            "Search the web": "Pesquisar na web",
            "This track is instrumental.": "Esta faixa é instrumental.",
            "Close lyrics": "Fechar letras",
            "Website": "Website",
        },
        "ru": {
            "Lyrics": "Текст песни",
            "Synchronized lyrics": "Синхронизированный текст",
            "Add a button to the secondary controls to show lyrics for the current track": "Добавить в дополнительные элементы управления кнопку показа текста текущей композиции",
            "Lyrics source": "Источник текстов",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Тексты предоставляет LRCLIB — открытая база данных, поддерживаемая сообществом.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "При открытии режима текста MediaShell отправляет в LRCLIB название, исполнителя, альбом и длительность текущей композиции. Доступность и точность зависят от данных сервиса.",
            "Searching for lyrics…": "Поиск текста…",
            "Lyrics could not be found.": "Не удалось найти текст.",
            "Search the web": "Искать в интернете",
            "This track is instrumental.": "Эта композиция инструментальная.",
            "Close lyrics": "Закрыть текст",
            "Website": "Веб-сайт",
        },
        "sk": {
            "Lyrics": "Texty",
            "Synchronized lyrics": "Synchronizované texty",
            "Add a button to the secondary controls to show lyrics for the current track": "Pridať do vedľajších ovládacích prvkov tlačidlo na zobrazenie textu aktuálnej skladby",
            "Lyrics source": "Zdroj textov",
            "Lyrics are provided by LRCLIB, an open community-maintained database.": "Texty poskytuje LRCLIB, otvorená databáza spravovaná komunitou.",
            "When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.": "Po otvorení režimu textov odošle MediaShell do LRCLIB názov, interpreta, album a dĺžku aktuálnej skladby. Dostupnosť a presnosť závisia od údajov služby.",
            "Searching for lyrics…": "Hľadanie textu…",
            "Lyrics could not be found.": "Text sa nepodarilo nájsť.",
            "Search the web": "Hľadať na webe",
            "This track is instrumental.": "Táto skladba je inštrumentálna.",
            "Close lyrics": "Zavrieť texty",
            "Website": "Webová stránka",
        },
    }

    def parse_po_string(lines: list[str], start: int, keyword: str) -> tuple[str, int]:
        value = ast.literal_eval(lines[start][len(keyword):].strip())
        index = start + 1
        while index < len(lines) and lines[index].startswith('"'):
            value += ast.literal_eval(lines[index])
            index += 1
        return value, index

    for locale, mapping in translations.items():
        path = ROOT / "assets" / "locale" / f"{locale}.po"
        content = path.read_text(encoding="utf-8")
        entries = re.split(r"\n{2,}", content.rstrip())
        seen = set()
        updated = []
        for entry in entries:
            lines = entry.splitlines()
            msgid_index = next((i for i, line in enumerate(lines) if line.startswith("msgid ")), None)
            if msgid_index is None:
                updated.append(entry)
                continue
            msgid, after_msgid = parse_po_string(lines, msgid_index, "msgid")
            if msgid not in mapping:
                updated.append(entry)
                continue
            msgstr_index = next((i for i in range(after_msgid, len(lines)) if lines[i].startswith("msgstr ")), None)
            if msgstr_index is None:
                raise RuntimeError(f"msgstr missing for {msgid!r} in {path}")
            end = msgstr_index + 1
            while end < len(lines) and lines[end].startswith('"'):
                end += 1
            lines[msgstr_index:end] = [f"msgstr {json.dumps(mapping[msgid], ensure_ascii=False)}"]
            updated.append("\n".join(lines))
            seen.add(msgid)
        missing = set(mapping) - seen
        if missing:
            raise RuntimeError(f"Translations not extracted for {locale}: {sorted(missing)}")
        path.write_text("\n\n".join(updated) + "\n", encoding="utf-8")
    return


if "--translations" in sys.argv:
    update_translations()
    raise SystemExit(0)

write("src/shared/constants/lyrics.js", r'''/**
 * @file lyrics.js
 * @module shared.constants.lyrics
 *
 * Defines toolkit-independent limits used by lyrics matching and session caching.
 *
 * These bounds keep LRCLIB result selection and transient cache behavior stable
 * without coupling pure helpers to GNOME Shell runtime modules.
 */

export const LYRICS_CACHE_MAX_ENTRIES = 64;
export const LYRICS_CACHE_POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
export const LYRICS_CACHE_NEGATIVE_TTL_MS = 2 * 60 * 1000;
export const LYRICS_RESULT_LIMIT = 30;
export const LYRICS_DURATION_CLOSE_SECONDS = 3;
export const LYRICS_DURATION_ACCEPTABLE_SECONDS = 10;
export const LYRICS_DURATION_REJECT_SECONDS = 30;
''')

write("src/shared/utils/lrc.js", r'''/**
 * @file lrc.js
 * @module shared.utils.lrc
 *
 * Parses synchronized LRC text and resolves the active line for a position.
 *
 * The parser is independent from LRCLIB transport and Shell actors so timestamp
 * handling, offsets, ordering, deduplication, and binary search remain testable.
 */

const TIMESTAMP_PATTERN = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
const OFFSET_PATTERN = /^\[offset:([+-]?\d+)\]$/i;

function fractionToMilliseconds(value = "") {
  if (value.length === 0) return 0;
  if (value.length === 1) return Number(value) * 100;
  if (value.length === 2) return Number(value) * 10;
  return Number(value.slice(0, 3));
}

export function parseLrc(source) {
  if (typeof source !== "string" || source.trim().length === 0) return [];

  let offsetMilliseconds = 0;
  const parsed = [];
  for (const rawLine of source.replaceAll("\r", "").split("\n")) {
    const line = rawLine.trimEnd();
    const offsetMatch = line.trim().match(OFFSET_PATTERN);
    if (offsetMatch) {
      offsetMilliseconds = Number(offsetMatch[1]) || 0;
      continue;
    }

    const timestamps = [];
    TIMESTAMP_PATTERN.lastIndex = 0;
    let match;
    while ((match = TIMESTAMP_PATTERN.exec(line)) !== null) {
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      if (!Number.isFinite(minutes) || seconds >= 60) continue;
      timestamps.push(
        minutes * 60_000 +
          seconds * 1_000 +
          fractionToMilliseconds(match[3]),
      );
    }
    if (timestamps.length === 0) continue;

    const text = line.replace(TIMESTAMP_PATTERN, "").trim();
    if (!text) continue;
    for (const timestamp of timestamps) {
      parsed.push({
        startTimeMs: Math.max(0, timestamp + offsetMilliseconds),
        text,
      });
    }
  }

  parsed.sort((left, right) => left.startTimeMs - right.startTimeMs);
  return parsed.filter(
    (line, index) =>
      index === 0 ||
      line.startTimeMs !== parsed[index - 1].startTimeMs ||
      line.text !== parsed[index - 1].text,
  );
}

export function findActiveLyricIndex(lines, positionMilliseconds) {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  if (!Number.isFinite(positionMilliseconds)) return -1;

  let low = 0;
  let high = lines.length - 1;
  let result = -1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle].startTimeMs <= positionMilliseconds) {
      result = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return result;
}
''')

write("src/shared/utils/lyrics.js", r'''/**
 * @file lyrics.js
 * @module shared.utils.lyrics
 *
 * Normalizes track metadata, scores LRCLIB candidates, and builds web searches.
 *
 * Matching policy stays pure so transport and popup rendering cannot influence
 * which recording is accepted for a current MPRIS track.
 */

import {
  LYRICS_DURATION_ACCEPTABLE_SECONDS,
  LYRICS_DURATION_CLOSE_SECONDS,
  LYRICS_DURATION_REJECT_SECONDS,
  LYRICS_RESULT_LIMIT,
} from "../constants/lyrics.js";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeBaseTitle(value) {
  return normalizeText(
    String(value ?? "")
      .replace(/\([^)]*\)|\[[^\]]*\]/g, " ")
      .replace(/\b(?:remaster(?:ed)?|version|edit)\b.*$/i, " "),
  );
}

function normalizeArtists(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((artist) => String(artist ?? "").split(/\s*(?:,|&|feat\.?|ft\.?)\s*/i))
    .map(normalizeText)
    .filter(Boolean);
}

export function buildLyricsTrack(metadata) {
  const title = String(metadata?.["xesam:title"] ?? "").trim();
  const artists = (Array.isArray(metadata?.["xesam:artist"])
    ? metadata["xesam:artist"]
    : [metadata?.["xesam:artist"]]
  )
    .map((artist) => String(artist ?? "").trim())
    .filter(Boolean);
  const album = String(metadata?.["xesam:album"] ?? "").trim();
  const durationMicroseconds = Number(metadata?.["mpris:length"]);
  const durationSeconds =
    Number.isFinite(durationMicroseconds) && durationMicroseconds > 0
      ? durationMicroseconds / 1_000_000
      : null;
  const normalizedTitle = normalizeText(title);
  const normalizedArtists = normalizeArtists(artists);
  const normalizedAlbum = normalizeText(album);
  const identity = [
    normalizedTitle,
    normalizedArtists.join("\u0001"),
    normalizedAlbum,
    durationSeconds == null ? "" : Math.round(durationSeconds),
  ].join("\u0000");

  return {
    title,
    artists,
    artist: artists.join(", "),
    album,
    durationSeconds,
    normalizedTitle,
    normalizedBaseTitle: normalizeBaseTitle(title),
    normalizedArtists,
    normalizedAlbum,
    identity,
  };
}

function scoreCandidate(track, candidate) {
  const candidateTitle = normalizeText(candidate?.trackName);
  const candidateBaseTitle = normalizeBaseTitle(candidate?.trackName);
  if (!candidateTitle) return Number.NEGATIVE_INFINITY;

  let score = 0;
  if (candidateTitle === track.normalizedTitle) score += 60;
  else if (
    candidateBaseTitle &&
    candidateBaseTitle === track.normalizedBaseTitle
  )
    score += 46;
  else if (
    candidateTitle.includes(track.normalizedTitle) ||
    track.normalizedTitle.includes(candidateTitle)
  )
    score += 24;
  else return Number.NEGATIVE_INFINITY;

  const candidateArtists = normalizeArtists(candidate?.artistName);
  const artistMatches = track.normalizedArtists.filter((artist) =>
    candidateArtists.some(
      (candidateArtist) =>
        artist === candidateArtist ||
        artist.includes(candidateArtist) ||
        candidateArtist.includes(artist),
    ),
  ).length;
  if (track.normalizedArtists.length > 0 && artistMatches === 0)
    return Number.NEGATIVE_INFINITY;
  score += artistMatches * 32;

  const candidateAlbum = normalizeText(candidate?.albumName);
  if (
    track.normalizedAlbum &&
    candidateAlbum &&
    track.normalizedAlbum === candidateAlbum
  )
    score += 14;

  const candidateDuration = Number(candidate?.duration);
  if (
    track.durationSeconds != null &&
    Number.isFinite(candidateDuration) &&
    candidateDuration > 0
  ) {
    const difference = Math.abs(candidateDuration - track.durationSeconds);
    if (difference <= LYRICS_DURATION_CLOSE_SECONDS) score += 20;
    else if (difference <= LYRICS_DURATION_ACCEPTABLE_SECONDS) score += 10;
    else if (difference > LYRICS_DURATION_REJECT_SECONDS) score -= 28;
  }

  if (typeof candidate?.syncedLyrics === "string" && candidate.syncedLyrics.trim())
    score += 4;
  else if (typeof candidate?.plainLyrics === "string" && candidate.plainLyrics.trim())
    score += 2;
  else if (!candidate?.instrumental) return Number.NEGATIVE_INFINITY;
  return score;
}

export function selectLyricsCandidate(track, candidates) {
  if (!track?.normalizedTitle || !Array.isArray(candidates)) return null;
  let best = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const candidate of candidates.slice(0, LYRICS_RESULT_LIMIT)) {
    const score = scoreCandidate(track, candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return Number.isFinite(bestScore) ? best : null;
}

export function buildLyricsWebSearchUri(track) {
  const query = [track?.title, track?.artist, "lyrics"]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query || "lyrics")}`;
}
''')

write("src/shared/utils/lyricsCache.js", r'''/**
 * @file lyricsCache.js
 * @module shared.utils.lyricsCache
 *
 * Provides a bounded, session-only lyrics lookup cache.
 *
 * Completed successes and short-lived misses reduce duplicate LRCLIB requests;
 * transport failures are never retained and cancelled pending work is not reused.
 */

import {
  LYRICS_CACHE_MAX_ENTRIES,
  LYRICS_CACHE_NEGATIVE_TTL_MS,
  LYRICS_CACHE_POSITIVE_TTL_MS,
} from "../constants/lyrics.js";

export default class LyricsLookupCache {
  constructor(now = () => Date.now()) {
    this.now = now;
    this.entries = new Map();
    this.pending = new Map();
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return { hit: false, value: null };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { hit: false, value: null };
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return { hit: true, value: entry.value };
  }

  set(key, value) {
    const ttl = value == null
      ? LYRICS_CACHE_NEGATIVE_TTL_MS
      : LYRICS_CACHE_POSITIVE_TTL_MS;
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.now() + ttl });
    while (this.entries.size > LYRICS_CACHE_MAX_ENTRIES)
      this.entries.delete(this.entries.keys().next().value);
  }

  resolve(key, cancellable, loader) {
    const cached = this.get(key);
    if (cached.hit) return Promise.resolve(cached.value);

    const pending = this.pending.get(key);
    if (pending && !pending.cancellable?.is_cancelled?.()) return pending.promise;
    if (pending) this.pending.delete(key);

    const promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        if (this.pending.get(key)?.promise === promise) this.pending.delete(key);
      });
    this.pending.set(key, { promise, cancellable });
    return promise;
  }

  clear() {
    this.entries.clear();
    this.pending.clear();
  }
}
''')

write("src/shell/constants/lyrics.js", r'''/**
 * @file lyrics.js
 * @module shell.constants.lyrics
 *
 * Defines LRCLIB transport constants owned by the Shell runtime.
 *
 * Network bounds and endpoint names stay outside popup actors and pure matching
 * helpers so the client remains the only owner of HTTP policy.
 */

export const LRCLIB_BASE_URL = "https://lrclib.net";
export const LRCLIB_GET_PATH = "/api/get";
export const LRCLIB_SEARCH_PATH = "/api/search";
export const LRCLIB_REQUEST_TIMEOUT_SECONDS = 10;
export const LRCLIB_MAX_RESPONSE_BYTES = 1024 * 1024;
''')

write("src/shell/constants/popupLyrics.js", r'''/**
 * @file popupLyrics.js
 * @module shell.constants.popupLyrics
 *
 * Defines popup-only geometry and animation policy for synchronized lyrics.
 *
 * Values shared by the lyrics layout, status, and scroll-follow components live
 * here so visual timing cannot drift across actors.
 */

export const POPUP_LYRICS_MIN_VIEWPORT_HEIGHT = 320;
export const POPUP_LYRICS_MODE_TRANSITION_MS = 240;
export const POPUP_LYRICS_GHOST_SCALE = 0.96;
export const POPUP_LYRICS_SECONDARY_GAP = 12;
export const POPUP_LYRICS_SYNC_INTERVAL_MS = 100;
export const POPUP_LYRICS_AUTO_FOLLOW_RESUME_MS = 4000;
export const POPUP_LYRICS_FOLLOW_MIN_DURATION_MS = 180;
export const POPUP_LYRICS_FOLLOW_MAX_DURATION_MS = 480;
export const POPUP_LYRICS_FOLLOW_DURATION_PER_PIXEL = 0.32;
export const POPUP_LYRICS_SPINNER_DURATION_MS = 900;
''')

write("src/shell/services/lyrics/LrclibClient.js", r'''/**
 * @file LrclibClient.js
 * @module shell.services.lyrics.LrclibClient
 *
 * Performs bounded and cancellable LRCLIB requests through libsoup 3.
 *
 * The client owns URL construction, identification, HTTP validation, payload
 * limits, and JSON decoding; it never chooses a candidate or creates actors.
 */

import GLib from "gi://GLib";
import Soup from "gi://Soup?version=3.0";

import { createLogger } from "../../../shared/utils/log.js";
import {
  LRCLIB_BASE_URL,
  LRCLIB_GET_PATH,
  LRCLIB_MAX_RESPONSE_BYTES,
  LRCLIB_REQUEST_TIMEOUT_SECONDS,
  LRCLIB_SEARCH_PATH,
} from "../../constants/lyrics.js";

const logger = createLogger("LrclibClient");

function buildQuery(parameters) {
  return Object.entries(parameters)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}

function sendAndRead(session, message, cancellable) {
  return new Promise((resolve, reject) => {
    session.send_and_read_async(
      message,
      GLib.PRIORITY_DEFAULT,
      cancellable,
      (source, result) => {
        try {
          resolve(source.send_and_read_finish(result));
        } catch (error) {
          reject(error);
        }
      },
    );
  });
}

export default class LrclibClient {
  constructor(version = "") {
    const userAgent = `MediaShell/${version || "development"} (https://github.com/WSTxda/MediaShell)`;
    this.session = new Soup.Session({
      userAgent,
      timeout: LRCLIB_REQUEST_TIMEOUT_SECONDS,
    });
  }

  getExact(track, cancellable) {
    return this.request(
      LRCLIB_GET_PATH,
      {
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album,
        duration: Math.round(track.durationSeconds),
      },
      cancellable,
      true,
    );
  }

  search(track, cancellable) {
    return this.request(
      LRCLIB_SEARCH_PATH,
      {
        track_name: track.title,
        artist_name: track.artist,
        album_name: track.album || null,
      },
      cancellable,
      false,
    );
  }

  async request(path, parameters, cancellable, allowNotFound) {
    if (!this.session) throw new Error("LRCLIB client was destroyed");
    const query = buildQuery(parameters);
    const message = Soup.Message.new("GET", `${LRCLIB_BASE_URL}${path}?${query}`);
    message.get_request_headers().append("Accept", "application/json");

    const bytes = await sendAndRead(this.session, message, cancellable);
    const status = message.get_status();
    if (allowNotFound && status === Soup.Status.NOT_FOUND) return null;
    if (status < 200 || status >= 300)
      throw new Error(`LRCLIB returned HTTP ${status}`);

    const declaredLength = message
      .get_response_headers()
      .get_content_length();
    if (declaredLength > LRCLIB_MAX_RESPONSE_BYTES)
      throw new Error("LRCLIB response exceeded the payload limit");
    const contentType =
      message.get_response_headers().get_one("Content-Type") ?? "";
    if (contentType && !contentType.toLowerCase().includes("json"))
      throw new Error("LRCLIB returned a non-JSON response");

    const rawData = bytes.get_data();
    const data =
      Array.isArray(rawData) && rawData.length === 2 ? rawData[0] : rawData;
    if (!data || data.length > LRCLIB_MAX_RESPONSE_BYTES)
      throw new Error("LRCLIB response exceeded the payload limit");
    try {
      return JSON.parse(new TextDecoder().decode(data));
    } catch (error) {
      logger.debug("LRCLIB response JSON could not be decoded", error);
      throw new Error("LRCLIB returned invalid JSON");
    }
  }

  destroy() {
    this.session?.abort();
    this.session = null;
  }
}
''')

write("src/shell/services/lyrics/LyricsResolver.js", r'''/**
 * @file LyricsResolver.js
 * @module shell.services.lyrics.LyricsResolver
 *
 * Resolves one normalized track into synchronized, plain, or instrumental lyrics.
 *
 * Exact lookup, search fallback, candidate scoring, LRC parsing, and the bounded
 * session cache are coordinated here while transport and popup UI stay separate.
 */

import { parseLrc } from "../../../shared/utils/lrc.js";
import {
  selectLyricsCandidate,
} from "../../../shared/utils/lyrics.js";
import LyricsLookupCache from "../../../shared/utils/lyricsCache.js";
import LrclibClient from "./LrclibClient.js";

function normalizeResult(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  if (candidate.instrumental) return { type: "instrumental" };

  const syncedLines = parseLrc(candidate.syncedLyrics);
  if (syncedLines.length > 0) return { type: "synced", lines: syncedLines };

  const plainText = String(candidate.plainLyrics ?? "").trim();
  if (plainText) return { type: "plain", text: plainText };
  return null;
}

export default class LyricsResolver {
  constructor(version) {
    this.client = new LrclibClient(version);
    this.cache = new LyricsLookupCache();
  }

  resolve(track, cancellable) {
    if (!track?.normalizedTitle || !track.identity) return Promise.resolve(null);
    return this.cache.resolve(track.identity, cancellable, () =>
      this.lookup(track, cancellable),
    );
  }

  async lookup(track, cancellable) {
    if (track.album && track.durationSeconds != null) {
      const exact = await this.client.getExact(track, cancellable);
      const candidate = selectLyricsCandidate(track, exact ? [exact] : []);
      const result = normalizeResult(candidate);
      if (result) return result;
    }

    const searchResults = await this.client.search(track, cancellable);
    const candidate = selectLyricsCandidate(
      track,
      Array.isArray(searchResults) ? searchResults : [],
    );
    return normalizeResult(candidate);
  }

  destroy() {
    this.client.destroy();
    this.cache.clear();
    this.client = null;
    this.cache = null;
  }
}
''')

write("src/shell/ui/popup/PopupLyricsStatus.js", r'''/**
 * @file PopupLyricsStatus.js
 * @module shell.ui.popup.PopupLyricsStatus
 *
 * Renders loading, instrumental, and unavailable states for the lyrics mode.
 *
 * One stable actor structure swaps a rotating symbolic icon, message, and optional
 * action without changing the surrounding popup geometry.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { POPUP_LYRICS_SPINNER_DURATION_MS } from "../../constants/popupLyrics.js";
import { createIcon, setIconName } from "../../utils/icons.js";

export default class PopupLyricsStatus {
  constructor(onSearchWeb) {
    this.onSearchWeb = onSearchWeb;
    this.actor = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-lyrics-status",
      xExpand: true,
      yExpand: true,
      xAlign: Clutter.ActorAlign.CENTER,
      yAlign: Clutter.ActorAlign.CENTER,
    });
    this.visual = createIcon({
      styleClass: "popup-menu-icon mediashell-popup-lyrics-status-icon",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.visual.set_pivot_point(0.5, 0.5);
    this.message = new St.Label({
      styleClass: "mediashell-popup-lyrics-status-message",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.action = new St.Button({
      styleClass: "button mediashell-popup-lyrics-search-button",
      reactive: true,
      trackHover: true,
      canFocus: true,
      xAlign: Clutter.ActorAlign.CENTER,
    });
    const actionBox = new St.BoxLayout({
      styleClass: "mediashell-popup-lyrics-search-content",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    actionBox.add_child(
      createIcon({
        iconName: "search-symbolic",
        styleClass: "popup-menu-icon mediashell-popup-lyrics-search-icon",
      }),
    );
    actionBox.add_child(new St.Label({ text: _("Search the web") }));
    this.action.set_child(actionBox);
    this.action.connect("clicked", () => this.onSearchWeb?.());
    this.actor.add_child(this.visual);
    this.actor.add_child(this.message);
    this.actor.add_child(this.action);
  }

  showLoading() {
    setIconName(this.visual, "process-working-symbolic");
    this.message.text = _("Searching for lyrics…");
    this.action.hide();
    this.startSpinner();
  }

  showUnavailable() {
    this.stopSpinner();
    setIconName(this.visual, "dialog-error-symbolic");
    this.message.text = _("Lyrics could not be found.");
    this.action.show();
  }

  showInstrumental() {
    this.stopSpinner();
    setIconName(this.visual, "audio-x-generic-symbolic");
    this.message.text = _("This track is instrumental.");
    this.action.hide();
  }

  startSpinner() {
    this.stopSpinner();
    this.spinnerTimeline = new Clutter.Timeline({
      duration: POPUP_LYRICS_SPINNER_DURATION_MS,
    });
    this.spinnerTimeline.set_repeat_count(-1);
    this.spinnerFrameId = this.spinnerTimeline.connect("new-frame", (timeline) => {
      this.visual.rotationAngleZ = timeline.get_progress() * 360;
    });
    this.spinnerTimeline.start();
  }

  stopSpinner() {
    if (this.spinnerTimeline && this.spinnerFrameId != null) {
      this.spinnerTimeline.disconnect(this.spinnerFrameId);
    }
    this.spinnerTimeline?.stop();
    this.spinnerTimeline = null;
    this.spinnerFrameId = null;
    this.visual.rotationAngleZ = 0;
  }

  destroy() {
    this.stopSpinner();
    this.actor?.destroy();
    this.actor = null;
    this.visual = null;
    this.message = null;
    this.action = null;
    this.onSearchWeb = null;
  }
}
''')

write("src/shell/ui/popup/PopupLyricsView.js", r'''/**
 * @file PopupLyricsView.js
 * @module shell.ui.popup.PopupLyricsView
 *
 * Renders synchronized and plain lyrics on an edge-to-edge popup surface.
 *
 * The view owns wrapping, line actors, centered smooth follow, manual-scroll
 * suspension, the close overlay, and status presentation; it never performs I/O.
 */

import Clutter from "gi://Clutter";
import GLib from "gi://GLib";
import Pango from "gi://Pango";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { findActiveLyricIndex } from "../../../shared/utils/lrc.js";
import {
  POPUP_LYRICS_AUTO_FOLLOW_RESUME_MS,
  POPUP_LYRICS_FOLLOW_DURATION_PER_PIXEL,
  POPUP_LYRICS_FOLLOW_MAX_DURATION_MS,
  POPUP_LYRICS_FOLLOW_MIN_DURATION_MS,
} from "../../constants/popupLyrics.js";
import { createIcon } from "../../utils/icons.js";
import PopupLyricsStatus from "./PopupLyricsStatus.js";

function easeOutCubic(progress) {
  return 1 - (1 - progress) ** 3;
}

export default class PopupLyricsView {
  constructor({ onClose, onSearchWeb, onSeek }) {
    this.onSeek = onSeek;
    this.lines = [];
    this.lineRows = [];
    this.activeLineIndex = -1;
    this.canSeek = false;
    this.geometrySourceId = null;
    this.autoFollowSourceId = null;

    this.actor = new St.Widget({
      styleClass: "mediashell-popup-lyrics-view",
      layoutManager: new Clutter.BinLayout(),
      xExpand: true,
      yExpand: true,
    });
    this.contentLayer = new St.Widget({
      layoutManager: new Clutter.BinLayout(),
      xExpand: true,
      yExpand: true,
    });
    this.scrollView = new St.ScrollView({
      styleClass: "mediashell-popup-lyrics-scroll",
      xExpand: true,
      yExpand: true,
      reactive: true,
      clipToAllocation: true,
    });
    this.scrollView.set_policy(St.PolicyType.NEVER, St.PolicyType.AUTOMATIC);
    this.scrollView.set_overlay_scrollbars?.(true);
    this.scrollView.set_enable_mouse_scrolling?.(true);
    this.lyricsList = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-lyrics-list",
      xExpand: true,
    });
    this.scrollView.set_child(this.lyricsList);
    this.status = new PopupLyricsStatus(onSearchWeb);
    this.contentLayer.add_child(this.scrollView);
    this.contentLayer.add_child(this.status.actor);
    this.actor.add_child(this.contentLayer);

    this.closeButton = new St.Button({
      styleClass: "mediashell-popup-lyrics-close",
      reactive: true,
      trackHover: true,
      canFocus: true,
      accessibleName: _("Close lyrics"),
    });
    this.closeButton.set_child(
      createIcon({
        iconName: "window-close-symbolic",
        styleClass: "popup-menu-icon mediashell-popup-lyrics-close-icon",
      }),
    );
    this.closeButton.add_constraint(
      new Clutter.AlignConstraint({
        source: this.actor,
        alignAxis: Clutter.AlignAxis.X_AXIS,
        factor: 0,
      }),
    );
    this.closeButton.add_constraint(
      new Clutter.AlignConstraint({
        source: this.actor,
        alignAxis: Clutter.AlignAxis.Y_AXIS,
        factor: 0,
      }),
    );
    this.closeButton.translationX = 8;
    this.closeButton.translationY = 8;
    this.closeButton.connect("clicked", () => onClose?.());
    this.actor.add_child(this.closeButton);

    this.scrollEventId = this.scrollView.connect(
      "captured-event",
      (_actor, event) => this.handleCapturedEvent(event),
    );
    this.allocationId = this.scrollView.connect("notify::allocation", () =>
      this.queueGeometryRefresh(),
    );
    this.showLoading();
  }

  showLoading() {
    this.clearLyrics();
    this.scrollView.hide();
    this.status.actor.show();
    this.status.showLoading();
  }

  showUnavailable() {
    this.clearLyrics();
    this.scrollView.hide();
    this.status.actor.show();
    this.status.showUnavailable();
  }

  showInstrumental() {
    this.clearLyrics();
    this.scrollView.hide();
    this.status.actor.show();
    this.status.showInstrumental();
  }

  renderSynced(lines, canSeek) {
    this.clearLyrics();
    this.lines = lines;
    this.canSeek = canSeek;
    this.topSpacer = new St.Widget();
    this.bottomSpacer = new St.Widget();
    this.lyricsList.add_child(this.topSpacer);
    lines.forEach((line, index) => {
      const row = this.createLineRow(line.text, canSeek, () => {
        if (!this.canSeek) return;
        this.resumeAutoFollow();
        this.onSeek?.(line.startTimeMs);
      });
      this.lineRows.push(row);
      this.lyricsList.add_child(row);
    });
    this.lyricsList.add_child(this.bottomSpacer);
    this.status.actor.hide();
    this.scrollView.show();
    this.queueGeometryRefresh();
  }

  renderPlain(text) {
    this.clearLyrics();
    this.topSpacer = new St.Widget();
    this.bottomSpacer = new St.Widget();
    this.lyricsList.add_child(this.topSpacer);
    for (const line of String(text).replaceAll("\r", "").split("\n")) {
      if (line.trim()) this.lyricsList.add_child(this.createLineRow(line, false));
      else
        this.lyricsList.add_child(
          new St.Widget({ styleClass: "mediashell-popup-lyrics-break" }),
        );
    }
    this.lyricsList.add_child(this.bottomSpacer);
    this.status.actor.hide();
    this.scrollView.show();
    this.queueGeometryRefresh();
  }

  createLineRow(text, reactive, onClick = null) {
    const row = new St.Button({
      styleClass: "mediashell-popup-lyrics-line",
      xExpand: true,
      xAlign: Clutter.ActorAlign.FILL,
      reactive,
      trackHover: reactive,
      canFocus: reactive,
    });
    const label = new St.Label({
      text,
      styleClass: "mediashell-popup-lyrics-line-label",
      xExpand: true,
      xAlign: Clutter.ActorAlign.FILL,
    });
    label.clutterText.set_line_wrap(true);
    label.clutterText.set_line_wrap_mode(Pango.WrapMode.WORD_CHAR);
    label.clutterText.set_ellipsize(Pango.EllipsizeMode.NONE);
    label.clutterText.set_single_line_mode(false);
    label.clutterText.set_line_alignment(Pango.Alignment.LEFT);
    row.set_child(label);
    if (onClick) row.connect("clicked", onClick);
    return row;
  }

  setCanSeek(canSeek) {
    this.canSeek = canSeek;
    for (const row of this.lineRows) {
      row.reactive = canSeek;
      row.trackHover = canSeek;
      row.canFocus = canSeek;
    }
  }

  setPosition(positionMilliseconds, animate = true) {
    if (this.lines.length === 0) return;
    const index = findActiveLyricIndex(this.lines, positionMilliseconds);
    if (index === this.activeLineIndex) return;
    this.setActiveLine(index, animate);
  }

  setActiveLine(index, animate = true) {
    const previous = this.lineRows[this.activeLineIndex];
    previous?.remove_style_class_name("active");
    this.activeLineIndex = index;
    const current = this.lineRows[index];
    current?.add_style_class_name("active");
    if (current && !this.autoFollowSourceId) this.scrollActiveLine(animate);
  }

  scrollActiveLine(animate) {
    const row = this.lineRows[this.activeLineIndex];
    const adjustment = this.getAdjustment();
    const viewportHeight = this.scrollView.get_height();
    if (!row || !adjustment || viewportHeight <= 0) return;

    const lower = adjustment.get_lower?.() ?? adjustment.lower ?? 0;
    const upper = adjustment.get_upper?.() ?? adjustment.upper ?? 0;
    const pageSize = adjustment.get_page_size?.() ?? adjustment.pageSize ?? 0;
    const rowCenter = row.get_y() + row.get_height() / 2;
    const target = Math.min(
      Math.max(lower, upper - pageSize),
      Math.max(lower, rowCenter - viewportHeight / 2),
    );
    const current = adjustment.get_value?.() ?? adjustment.value ?? 0;
    if (!animate || Math.abs(target - current) < 1) {
      this.stopFollowTimeline();
      adjustment.set_value?.(target);
      if (!adjustment.set_value) adjustment.value = target;
      return;
    }

    this.stopFollowTimeline();
    const distance = Math.abs(target - current);
    const duration = Math.min(
      POPUP_LYRICS_FOLLOW_MAX_DURATION_MS,
      Math.max(
        POPUP_LYRICS_FOLLOW_MIN_DURATION_MS,
        POPUP_LYRICS_FOLLOW_MIN_DURATION_MS +
          distance * POPUP_LYRICS_FOLLOW_DURATION_PER_PIXEL,
      ),
    );
    this.followTimeline = new Clutter.Timeline({ duration });
    this.followFrameId = this.followTimeline.connect("new-frame", (timeline) => {
      const value = current + (target - current) * easeOutCubic(timeline.get_progress());
      adjustment.set_value?.(value);
      if (!adjustment.set_value) adjustment.value = value;
    });
    this.followTimeline.start();
  }

  getAdjustment() {
    return this.scrollView.get_vscroll_bar?.()?.get_adjustment?.() ?? null;
  }

  queueGeometryRefresh() {
    if (this.geometrySourceId != null) return;
    this.geometrySourceId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
      this.geometrySourceId = null;
      const viewportHeight = this.scrollView?.get_height() ?? 0;
      if (viewportHeight > 0) {
        const spacerHeight = Math.floor(viewportHeight / 2);
        if (this.topSpacer) this.topSpacer.height = spacerHeight;
        if (this.bottomSpacer) this.bottomSpacer.height = spacerHeight;
        this.scrollActiveLine(false);
      }
      return GLib.SOURCE_REMOVE;
    });
  }

  handleCapturedEvent(event) {
    const type = event.type();
    if (
      type === Clutter.EventType.SCROLL ||
      type === Clutter.EventType.BUTTON_PRESS ||
      type === Clutter.EventType.TOUCH_BEGIN
    )
      this.suspendAutoFollow();
    return Clutter.EVENT_PROPAGATE;
  }

  suspendAutoFollow() {
    this.stopFollowTimeline();
    if (this.autoFollowSourceId != null)
      GLib.Source.remove(this.autoFollowSourceId);
    this.autoFollowSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      POPUP_LYRICS_AUTO_FOLLOW_RESUME_MS,
      () => {
        this.autoFollowSourceId = null;
        this.scrollActiveLine(true);
        return GLib.SOURCE_REMOVE;
      },
    );
  }

  resumeAutoFollow() {
    if (this.autoFollowSourceId != null)
      GLib.Source.remove(this.autoFollowSourceId);
    this.autoFollowSourceId = null;
    this.scrollActiveLine(true);
  }

  stopFollowTimeline() {
    if (this.followTimeline && this.followFrameId != null)
      this.followTimeline.disconnect(this.followFrameId);
    this.followTimeline?.stop();
    this.followTimeline = null;
    this.followFrameId = null;
  }

  clearLyrics() {
    this.stopFollowTimeline();
    if (this.autoFollowSourceId != null)
      GLib.Source.remove(this.autoFollowSourceId);
    this.autoFollowSourceId = null;
    this.lyricsList?.remove_all_children();
    this.lines = [];
    this.lineRows = [];
    this.activeLineIndex = -1;
    this.topSpacer = null;
    this.bottomSpacer = null;
  }

  destroy() {
    if (this.geometrySourceId != null) GLib.Source.remove(this.geometrySourceId);
    this.geometrySourceId = null;
    if (this.scrollView && this.scrollEventId != null)
      this.scrollView.disconnect(this.scrollEventId);
    if (this.scrollView && this.allocationId != null)
      this.scrollView.disconnect(this.allocationId);
    this.scrollEventId = null;
    this.allocationId = null;
    this.clearLyrics();
    this.status?.destroy();
    this.actor?.destroy();
    this.status = null;
    this.actor = null;
    this.scrollView = null;
    this.lyricsList = null;
    this.lineRows = [];
    this.onSeek = null;
  }
}
''')

write("src/shell/ui/popup/PopupLyricsLayout.js", r'''/**
 * @file PopupLyricsLayout.js
 * @module shell.ui.popup.PopupLyricsLayout
 *
 * Owns temporary popup geometry and transitions for lyrics mode.
 *
 * The upper content and secondary controls ghost-fade while their released height
 * becomes a bounded lyrics viewport, keeping the primary controls on one smooth path.
 */

import Clutter from "gi://Clutter";

import {
  POPUP_LYRICS_GHOST_SCALE,
  POPUP_LYRICS_MIN_VIEWPORT_HEIGHT,
  POPUP_LYRICS_MODE_TRANSITION_MS,
  POPUP_LYRICS_SECONDARY_GAP,
} from "../../constants/popupLyrics.js";

function naturalHeight(actor) {
  if (!actor) return 0;
  const [, natural] = actor.get_preferred_height(-1);
  return Math.max(0, actor.get_height(), natural);
}

function clearTransitions(actor) {
  actor?.remove_all_transitions();
}

export default class PopupLyricsLayout {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.generation = 0;
    this.isOpen = false;
  }

  open(viewActor) {
    if (this.isOpen) return;
    this.isOpen = true;
    const generation = ++this.generation;
    const upper = this.popupContent.upperBox;
    const secondary = this.popupContent.playbackControls.secondaryActor;
    const slot = this.popupContent.lyricsSlot;
    this.upperHeight = naturalHeight(upper);
    this.secondaryHeight = secondary?.visible ? naturalHeight(secondary) : 0;
    const releasedHeight =
      this.upperHeight +
      this.secondaryHeight +
      (this.secondaryHeight > 0 ? POPUP_LYRICS_SECONDARY_GAP : 0);
    this.lyricsHeight = Math.max(
      POPUP_LYRICS_MIN_VIEWPORT_HEIGHT,
      releasedHeight,
    );

    clearTransitions(upper);
    clearTransitions(secondary);
    clearTransitions(slot);
    upper.show();
    upper.clipToAllocation = true;
    upper.height = this.upperHeight;
    upper.opacity = 255;
    upper.scaleX = 1;
    upper.scaleY = 1;
    upper.set_pivot_point(0.5, 0.5);
    if (secondary) {
      secondary.show();
      secondary.clipToAllocation = true;
      secondary.height = this.secondaryHeight;
      secondary.opacity = 255;
      secondary.scaleX = 1;
      secondary.scaleY = 1;
      secondary.set_pivot_point(0.5, 0.5);
    }

    viewActor.get_parent()?.remove_child(viewActor);
    slot.set_child(viewActor);
    slot.show();
    slot.clipToAllocation = true;
    slot.height = 0;
    slot.opacity = 0;

    upper.ease({
      height: 0,
      opacity: 0,
      scale_x: POPUP_LYRICS_GHOST_SCALE,
      scale_y: POPUP_LYRICS_GHOST_SCALE,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    secondary?.ease({
      height: 0,
      opacity: 0,
      scale_x: POPUP_LYRICS_GHOST_SCALE,
      scale_y: POPUP_LYRICS_GHOST_SCALE,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    slot.ease({
      height: this.lyricsHeight,
      opacity: 255,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (!this.isOpen || generation !== this.generation) return;
        upper.hide();
        secondary?.hide();
        slot.clipToAllocation = false;
      },
    });
  }

  close(animate = true) {
    if (!this.isOpen && !this.popupContent?.lyricsSlot?.visible) return;
    this.isOpen = false;
    const generation = ++this.generation;
    const upper = this.popupContent.upperBox;
    const secondary = this.popupContent.playbackControls.secondaryActor;
    const slot = this.popupContent.lyricsSlot;
    clearTransitions(upper);
    clearTransitions(secondary);
    clearTransitions(slot);

    if (!animate) {
      this.restoreNormalLayout();
      return;
    }

    upper.show();
    upper.clipToAllocation = true;
    upper.height = 0;
    upper.opacity = 0;
    upper.scaleX = POPUP_LYRICS_GHOST_SCALE;
    upper.scaleY = POPUP_LYRICS_GHOST_SCALE;
    if (secondary) {
      secondary.show();
      secondary.clipToAllocation = true;
      secondary.height = 0;
      secondary.opacity = 0;
      secondary.scaleX = POPUP_LYRICS_GHOST_SCALE;
      secondary.scaleY = POPUP_LYRICS_GHOST_SCALE;
    }
    slot.clipToAllocation = true;
    slot.height = Math.max(0, slot.get_height(), this.lyricsHeight ?? 0);

    upper.ease({
      height: this.upperHeight ?? naturalHeight(upper),
      opacity: 255,
      scale_x: 1,
      scale_y: 1,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    secondary?.ease({
      height: this.secondaryHeight ?? naturalHeight(secondary),
      opacity: 255,
      scale_x: 1,
      scale_y: 1,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
    });
    slot.ease({
      height: 0,
      opacity: 0,
      duration: POPUP_LYRICS_MODE_TRANSITION_MS,
      mode: Clutter.AnimationMode.EASE_OUT_QUAD,
      onComplete: () => {
        if (generation !== this.generation) return;
        this.restoreNormalLayout();
      },
    });
  }

  restoreNormalLayout() {
    const upper = this.popupContent?.upperBox;
    const secondary = this.popupContent?.playbackControls?.secondaryActor;
    const slot = this.popupContent?.lyricsSlot;
    clearTransitions(upper);
    clearTransitions(secondary);
    clearTransitions(slot);
    for (const actor of [upper, secondary]) {
      if (!actor) continue;
      actor.show();
      actor.height = -1;
      actor.opacity = 255;
      actor.scaleX = 1;
      actor.scaleY = 1;
      actor.clipToAllocation = false;
    }
    if (slot) {
      slot.get_child()?.get_parent()?.remove_child(slot.get_child());
      slot.height = 0;
      slot.opacity = 0;
      slot.clipToAllocation = true;
      slot.hide();
    }
    this.upperHeight = 0;
    this.secondaryHeight = 0;
    this.lyricsHeight = 0;
  }

  destroy() {
    this.generation++;
    this.isOpen = false;
    this.restoreNormalLayout();
    this.popupContent = null;
  }
}
''')

write("src/shell/ui/popup/PopupLyricsController.js", r'''/**
 * @file PopupLyricsController.js
 * @module shell.ui.popup.PopupLyricsController
 *
 * Coordinates the temporary lyrics mode for the active media app.
 *
 * Request generations, cancellation, track changes, synchronization, seek, web
 * fallback, layout, and teardown are owned here while transport and actors stay isolated.
 */

import Gio from "gi://Gio";
import GLib from "gi://GLib";

import { WidgetFlags } from "../../../shared/enums/widget.js";
import {
  buildLyricsTrack,
  buildLyricsWebSearchUri,
} from "../../../shared/utils/lyrics.js";
import { createLogger } from "../../../shared/utils/log.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { POPUP_LYRICS_SYNC_INTERVAL_MS } from "../../constants/popupLyrics.js";
import LyricsResolver from "../../services/lyrics/LyricsResolver.js";
import { isCancellationError } from "../../utils/errors.js";
import PopupLyricsLayout from "./PopupLyricsLayout.js";
import PopupLyricsView from "./PopupLyricsView.js";

const logger = createLogger("PopupLyricsController");

export default class PopupLyricsController {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.isOpen = false;
    this.requestGeneration = 0;
    const metadata = popupContent.extensionController.extensionInstance.metadata;
    this.resolver = new LyricsResolver(
      String(metadata["version-name"] ?? metadata.version ?? ""),
    );
    this.layout = new PopupLyricsLayout(popupContent);
    this.view = new PopupLyricsView({
      onClose: () => this.close(),
      onSearchWeb: () => this.searchWeb(),
      onSeek: (positionMilliseconds) => this.seek(positionMilliseconds),
    });
  }

  toggle() {
    if (this.isOpen) this.close();
    else this.open();
  }

  open() {
    if (this.isOpen || !this.popupContent.extensionController.popupSyncedLyricsShow)
      return;
    this.isOpen = true;
    this.popupContent.appSelectorController.close(false);
    this.view.showLoading();
    this.layout.open(this.view.actor);
    logger.debug("Lyrics mode opened");
    this.reload();
    if (this.mediaApp.playbackStatus === PlaybackStatus.PLAYING) this.startSync();
  }

  close(animate = true) {
    if (!this.isOpen && !this.layout.isOpen) return;
    this.isOpen = false;
    this.cancelRequest();
    this.stopSync();
    this.layout.close(animate);
    logger.debug("Lyrics mode closed");
  }

  get mediaApp() {
    return this.popupContent.mediaApp;
  }

  async reload() {
    if (!this.isOpen) return;
    this.cancelRequest();
    const generation = ++this.requestGeneration;
    const mediaApp = this.mediaApp;
    const track = buildLyricsTrack(mediaApp.metadata);
    this.currentTrack = track;
    this.view.showLoading();
    this.cancellable = new Gio.Cancellable();

    if (!track.normalizedTitle) {
      this.view.showUnavailable();
      return;
    }

    try {
      const result = await this.resolver.resolve(track, this.cancellable);
      if (!this.isCurrentRequest(generation, mediaApp, track.identity)) return;
      if (!result) {
        this.view.showUnavailable();
        return;
      }
      if (result.type === "synced") {
        this.view.renderSynced(
          result.lines,
          mediaApp.canControl && mediaApp.canSeek,
        );
        this.updatePosition(false);
      } else if (result.type === "plain") {
        this.view.renderPlain(result.text);
      } else if (result.type === "instrumental") {
        this.view.showInstrumental();
      } else {
        this.view.showUnavailable();
      }
    } catch (error) {
      if (!isCancellationError(error) && this.isCurrentRequest(generation, mediaApp)) {
        logger.warn("Lyrics lookup failed; showing the common unavailable state", error);
        this.view.showUnavailable();
      }
    } finally {
      if (generation === this.requestGeneration) this.cancellable = null;
    }
  }

  isCurrentRequest(generation, mediaApp, identity = null) {
    return Boolean(
      this.isOpen &&
        generation === this.requestGeneration &&
        this.mediaApp === mediaApp &&
        (identity == null || this.currentTrack?.identity === identity),
    );
  }

  cancelRequest() {
    this.requestGeneration++;
    this.cancellable?.cancel();
    this.cancellable = null;
  }

  handleWidgetUpdate(widgetFlags) {
    if (!this.popupContent.extensionController.popupSyncedLyricsShow) {
      this.close();
      return;
    }
    if (!this.isOpen) return;
    if (
      widgetFlags &
      (WidgetFlags.POPUP_ALBUM_ART | WidgetFlags.POPUP_TRACK_INFORMATION)
    ) {
      const track = buildLyricsTrack(this.mediaApp.metadata);
      if (track.identity !== this.currentTrack?.identity) this.reload();
    }
    if (widgetFlags & WidgetFlags.POPUP_PROGRESS_BAR)
      this.view.setCanSeek(this.mediaApp.canControl && this.mediaApp.canSeek);
  }

  setPlaybackPosition(positionMicroseconds) {
    if (!this.isOpen || !Number.isFinite(positionMicroseconds)) return;
    this.view.setPosition(positionMicroseconds / 1000);
  }

  updatePosition(animate = true) {
    if (!this.isOpen) return;
    this.view.setPosition(
      this.mediaApp.estimatedPositionMicroseconds / 1000,
      animate,
    );
  }

  startSync() {
    if (this.syncSourceId != null || !this.isOpen) return;
    this.syncSourceId = GLib.timeout_add(
      GLib.PRIORITY_DEFAULT,
      POPUP_LYRICS_SYNC_INTERVAL_MS,
      () => {
        if (!this.isOpen) {
          this.syncSourceId = null;
          return GLib.SOURCE_REMOVE;
        }
        this.updatePosition(true);
        return GLib.SOURCE_CONTINUE;
      },
    );
  }

  stopSync() {
    if (this.syncSourceId != null) GLib.Source.remove(this.syncSourceId);
    this.syncSourceId = null;
  }

  pause() {
    this.stopSync();
    this.updatePosition(false);
  }

  resume() {
    if (this.isOpen) this.startSync();
  }

  seek(positionMilliseconds) {
    if (!this.isOpen || !this.mediaApp.canControl || !this.mediaApp.canSeek) return;
    const trackId = this.mediaApp.metadata["mpris:trackid"];
    this.mediaApp.setPosition(trackId, Math.round(positionMilliseconds * 1000));
    this.view.setPosition(positionMilliseconds, false);
  }

  searchWeb() {
    try {
      Gio.AppInfo.launch_default_for_uri(
        buildLyricsWebSearchUri(this.currentTrack),
        null,
      );
    } catch (error) {
      logger.warn("Could not open the lyrics web search", error);
    }
  }

  destroy() {
    this.isOpen = false;
    this.cancelRequest();
    this.stopSync();
    this.layout?.destroy();
    this.view?.destroy();
    this.resolver?.destroy();
    this.layout = null;
    this.view = null;
    this.resolver = null;
    this.currentTrack = null;
    this.popupContent = null;
  }
}
''')

# PopupContent is replaced as one coherent owner because the clean root/upper/lyrics/lower
# structure is the key to edge-to-edge scrolling and stable minimum lyrics geometry.
write("src/shell/ui/popup/PopupContent.js", r'''/**
 * @file PopupContent.js
 * @module shell.ui.popup.PopupContent
 *
 * Orchestrates every widget inside the MediaShell popup.
 *
 * PopupContent owns the edge-to-edge root and separates normal upper content,
 * the temporary lyrics slot, and lower playback content while coalescing updates.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import * as PopupMenu from "resource:///org/gnome/shell/ui/popupMenu.js";

import { POPUP_WIDTH } from "../../../shared/constants/settings.js";
import { PlaybackStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { createLogger } from "../../../shared/utils/log.js";
import { POPUP_CONTAINER_PADDING } from "../../constants/popup.js";
import PopupAlbumArt from "./PopupAlbumArt.js";
import PopupPlaybackControls from "./PopupPlaybackControls.js";
import PopupAppSelectorController from "./PopupAppSelectorController.js";
import PopupTrackInformation from "./PopupTrackInformation.js";
import PopupProgressBar from "./PopupProgressBar.js";

const logger = createLogger("PopupContent");

export default class PopupContent {
  constructor(topBarButton) {
    this.topBarButton = topBarButton;
    this.pendingWidgetFlags = 0;
    this.appliedPopupOuterWidth = null;
    this.lyricsController = null;
    this.lyricsControllerPromise = null;

    this.popupItem = new PopupMenu.PopupBaseMenuItem({
      style_class: "no-padding mediashell-popup-root",
      activate: false,
    });
    this.popupItem.set_orientation(Clutter.Orientation.VERTICAL);
    this.popupItem.remove_style_class_name("popup-menu-item");
    this.upperBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-upper",
      xExpand: true,
    });
    this.lyricsSlot = new St.Bin({
      styleClass: "mediashell-popup-lyrics-slot",
      xExpand: true,
      visible: false,
      height: 0,
      opacity: 0,
      clipToAllocation: true,
    });
    this.lowerBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-lower",
      xExpand: true,
    });
    this.popupItem.add_child(this.upperBox);
    this.popupItem.add_child(this.lyricsSlot);
    this.popupItem.add_child(this.lowerBox);

    this.appSelectorController = new PopupAppSelectorController(this);
    this.albumArt = new PopupAlbumArt(this);
    this.trackInformation = new PopupTrackInformation(this);
    this.progressBar = new PopupProgressBar(this);
    this.playbackControls = new PopupPlaybackControls(this);

    this.menu.addMenuItem(this.popupItem);
    this.popupItemCapturedEventId = this.popupItem.connect(
      "captured-event",
      (_actor, event) => this.appSelectorController.handleCapturedEvent(event),
    );
    this.menuOpenSignalId = this.menu.connect(
      "open-state-changed",
      (_menu, isOpen) => {
        if (isOpen) {
          logger.debug("Popup opened for", this.mediaApp.busName);
          let widgetFlags =
            this.pendingWidgetFlags |
            WidgetFlags.POPUP_APP_SELECTOR |
            WidgetFlags.POPUP_ALBUM_ART |
            WidgetFlags.POPUP_TRACK_INFORMATION |
            WidgetFlags.POPUP_PLAYBACK_CONTROLS;
          if (this.extensionController.popupProgressBarShow)
            widgetFlags |= WidgetFlags.POPUP_PROGRESS_BAR;
          this.pendingWidgetFlags = 0;
          this.updateWidgets(widgetFlags, true);
          if (this.mediaApp.playbackStatus === PlaybackStatus.PLAYING)
            this.resume();
          else this.pause();
        } else {
          logger.debug("Popup closed");
          this.appSelectorController.close();
          this.albumArt.cancelAlbumArtLoad();
          this.lyricsController?.close(false);
          this.pause();
        }
      },
    );
  }

  get extensionController() {
    return this.topBarButton.extensionController;
  }
  get mediaApp() {
    return this.topBarButton.mediaApp;
  }
  get menu() {
    return this.topBarButton.menu;
  }

  isSameMediaApp(mediaApp) {
    return this.topBarButton.isSameMediaApp(mediaApp);
  }
  selectMediaApp(mediaApp) {
    return this.extensionController.selectMediaApp(mediaApp);
  }
  toggleMediaAppPin(mediaApp) {
    return this.extensionController.toggleMediaAppPin(mediaApp);
  }

  updateWidgets(widgetFlags, forceRender = false) {
    const popupFlags = widgetFlags & WidgetFlags.POPUP;
    if (popupFlags === 0) return;
    this.applyPopupSize();
    if (!forceRender && !this.menu.isOpen) {
      this.pendingWidgetFlags |= popupFlags;
      return;
    }

    if (!this.extensionController.popupSyncedLyricsShow)
      this.lyricsController?.close();

    if (popupFlags & WidgetFlags.POPUP_APP_SELECTOR)
      this.runWidgetUpdate("app selector", () => this.appSelectorController.render());
    if (popupFlags & WidgetFlags.POPUP_ALBUM_ART) {
      this.runWidgetUpdate("album art", () => {
        if (this.extensionController.popupAlbumArtShow) return this.albumArt.render();
        this.albumArt.remove();
        return null;
      });
    }
    if (popupFlags & WidgetFlags.POPUP_TRACK_INFORMATION) {
      this.runWidgetUpdate("track information", () => {
        if (this.extensionController.popupTrackInformationShow)
          return this.trackInformation.render();
        this.trackInformation.remove();
        return null;
      });
    }
    if (popupFlags & WidgetFlags.POPUP_PROGRESS_BAR) {
      this.runWidgetUpdate("progress bar", () => {
        if (this.extensionController.popupProgressBarShow)
          return this.progressBar.render();
        this.progressBar.remove();
        return null;
      });
    }
    if (popupFlags & WidgetFlags.POPUP_PLAYBACK_CONTROLS)
      this.runWidgetUpdate("playback controls", () =>
        this.playbackControls.render(popupFlags),
      );
    this.lyricsController?.handleWidgetUpdate(popupFlags);
  }

  runWidgetUpdate(componentName, update) {
    try {
      const result = update();
      result?.catch?.((error) =>
        logger.errorOnce(
          `component-update:${componentName}`,
          `Popup ${componentName} update failed`,
          error,
        ),
      );
    } catch (error) {
      logger.errorOnce(
        `component-update:${componentName}`,
        `Popup ${componentName} update failed`,
        error,
      );
    }
  }

  async toggleLyrics() {
    if (!this.extensionController.popupSyncedLyricsShow) return;
    try {
      if (!this.lyricsController) {
        this.lyricsControllerPromise ??= import("./PopupLyricsController.js");
        const { default: PopupLyricsController } = await this.lyricsControllerPromise;
        this.lyricsControllerPromise = null;
        if (!this.topBarButton || !this.extensionController.popupSyncedLyricsShow)
          return;
        this.lyricsController = new PopupLyricsController(this);
      }
      this.lyricsController.toggle();
    } catch (error) {
      this.lyricsControllerPromise = null;
      logger.errorOnce(
        "lyrics-initialization",
        "Lyrics mode could not be initialized; the popup remains available",
        error,
      );
    }
  }

  pause() {
    this.trackInformation.pause();
    this.progressBar.pause();
    this.lyricsController?.pause();
  }
  resume() {
    this.trackInformation.resume();
    this.progressBar.resume();
    this.lyricsController?.resume();
  }
  setPlaybackRate(playbackRate) {
    this.progressBar.setPlaybackRate(playbackRate);
  }
  setPlaybackPosition(positionMicroseconds) {
    this.progressBar.setPlaybackPosition(positionMicroseconds);
    this.lyricsController?.setPlaybackPosition(positionMicroseconds);
  }

  buildFixedWidthStyle(width) {
    return [
      `width: ${width}px;`,
      `min-width: ${width}px;`,
      `max-width: ${width}px;`,
    ].join(" ");
  }
  getTrackInformationWidth() {
    return this.getPopupContentWidth();
  }
  getPopupOuterWidth() {
    return Number.isFinite(this.extensionController.popupWidth)
      ? this.extensionController.popupWidth
      : POPUP_WIDTH.DEFAULT;
  }
  getPopupContentWidth() {
    return this.getPopupOuterWidth() - POPUP_CONTAINER_PADDING * 2;
  }
  getAlbumArtWidth() {
    return this.getPopupContentWidth();
  }
  applyPopupSize() {
    if (!this.popupItem) return;
    const width = this.getPopupOuterWidth();
    if (width === this.appliedPopupOuterWidth) return;
    this.appliedPopupOuterWidth = width;
    this.popupItem.style = this.buildFixedWidthStyle(width);
    this.appSelectorController.syncAppSelectorWidth();
  }

  destroy() {
    if (!this.topBarButton) return;
    this.lyricsController?.destroy();
    this.lyricsController = null;
    this.lyricsControllerPromise = null;
    for (const [object, signalId, label] of [
      [this.menu, this.menuOpenSignalId, "menu open-state"],
      [this.popupItem, this.popupItemCapturedEventId, "popup captured-event"],
    ]) {
      if (!object || signalId === null) continue;
      try {
        object.disconnect(signalId);
      } catch {
        logger.debug(`${label} signal was already gone during teardown`);
      }
    }
    this.menuOpenSignalId = null;
    this.popupItemCapturedEventId = null;
    for (const property of [
      "progressBar",
      "trackInformation",
      "playbackControls",
      "albumArt",
      "appSelectorController",
      "popupItem",
    ]) {
      const component = this[property];
      this[property] = null;
      try {
        component?.destroy();
      } catch (error) {
        logger.error(`Failed to destroy ${property}`, error);
      }
    }
    this.upperBox = null;
    this.lowerBox = null;
    this.lyricsSlot = null;
    this.pendingWidgetFlags = 0;
    this.appliedPopupOuterWidth = null;
    this.topBarButton = null;
  }
}
''')

write("src/shell/ui/popup/PopupPlaybackControls.js", r'''/**
 * @file PopupPlaybackControls.js
 * @module shell.ui.popup.PopupPlaybackControls
 *
 * Renders popup playback, shuffle, repeat, and lyrics controls.
 *
 * Transport state stays descriptor-driven while the lyrics action is an internal
 * popup command whose visibility follows its dedicated setting directly.
 */

import Clutter from "gi://Clutter";
import St from "gi://St";
import { gettext as _ } from "resource:///org/gnome/shell/extensions/extension.js";

import { PlaybackControls } from "../../../shared/constants/playbackControls.js";
import { LoopStatus } from "../../../shared/enums/playback.js";
import { WidgetFlags } from "../../../shared/enums/widget.js";
import { resolvePlayPauseControl } from "../../../shared/utils/playbackControlState.js";
import {
  ACTIVE_OPACITY,
  INACTIVE_OPACITY,
} from "../../constants/actorState.js";
import { createIcon, setIconName } from "../../utils/icons.js";

function getPopupPlaybackControlIndex(controlName) {
  if (
    controlName === PlaybackControls.SHUFFLE_ON.name ||
    controlName === PlaybackControls.PREVIOUS.name
  )
    return 0;
  if (controlName === PlaybackControls.PLAY.name) return 1;
  if (
    controlName === PlaybackControls.NEXT.name ||
    controlName === PlaybackControls.LOOP_NONE.name
  )
    return 2;
  return 0;
}

export default class PopupPlaybackControls {
  constructor(popupContent) {
    this.popupContent = popupContent;
    this.controlButtons = new Map();
  }
  get mediaApp() {
    return this.popupContent.mediaApp;
  }
  get popupItem() {
    return this.popupContent.lowerBox;
  }
  get actor() {
    return this.playbackControlsBox;
  }
  get primaryActor() {
    return this.primaryPlaybackControlsBox;
  }
  get secondaryActor() {
    return this.secondaryPlaybackControlsBox;
  }

  render(widgetFlags) {
    this.ensureActors();
    const mediaApp = this.mediaApp;
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_SHUFFLE) {
      this.updatePlaybackControl(
        mediaApp.shuffle
          ? PlaybackControls.SHUFFLE_ON
          : PlaybackControls.SHUFFLE_OFF,
        mediaApp.canControl,
        () => mediaApp.toggleShuffle(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PREVIOUS) {
      this.updatePlaybackControl(
        PlaybackControls.PREVIOUS,
        mediaApp.canGoPrevious && mediaApp.canControl,
        () => mediaApp.previous(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_PLAY_PAUSE)
      this.updatePlayPause(mediaApp);
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_NEXT) {
      this.updatePlaybackControl(
        PlaybackControls.NEXT,
        mediaApp.canGoNext && mediaApp.canControl,
        () => mediaApp.next(),
      );
    }
    if (widgetFlags & WidgetFlags.POPUP_PLAYBACK_LOOP) {
      const definition =
        mediaApp.loopStatus === LoopStatus.NONE
          ? PlaybackControls.LOOP_NONE
          : mediaApp.loopStatus === LoopStatus.TRACK
            ? PlaybackControls.LOOP_TRACK
            : PlaybackControls.LOOP_PLAYLIST;
      this.updatePlaybackControl(
        definition,
        mediaApp.canControl,
        () => mediaApp.toggleLoop(),
      );
    }
    this.updateLyricsButton();
    if (!this.playbackControlsBox.get_parent())
      this.popupItem.add_child(this.playbackControlsBox);
  }

  ensureActors() {
    if (this.playbackControlsBox) return;
    this.playbackControlsBox = new St.BoxLayout({
      orientation: Clutter.Orientation.VERTICAL,
      styleClass: "mediashell-popup-playback-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.primaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: "mediashell-popup-primary-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.secondaryPlaybackControlsBox = new St.BoxLayout({
      styleClass: "mediashell-popup-secondary-controls",
      xAlign: Clutter.ActorAlign.CENTER,
    });
    this.playbackControlsBox.add_child(this.primaryPlaybackControlsBox);
    this.playbackControlsBox.add_child(this.secondaryPlaybackControlsBox);
  }

  updateLyricsButton() {
    if (!this.popupContent.extensionController.popupSyncedLyricsShow) {
      this.lyricsButton?.destroy();
      this.lyricsButton = null;
      this.lyricsIcon = null;
      return;
    }
    if (!this.lyricsButton) {
      this.lyricsButton = new St.Button({
        name: "lyrics",
        styleClass:
          "button mediashell-popup-control-button mediashell-popup-control-button-state",
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
        reactive: true,
        trackHover: true,
        canFocus: true,
        accessibleName: _("Lyrics"),
      });
      this.lyricsIcon = createIcon({
        iconName: "folder-music-symbolic",
        styleClass: "popup-menu-icon mediashell-popup-control-icon",
      });
      this.lyricsButton.set_child(this.lyricsIcon);
      this.lyricsButton.connect("clicked", () =>
        this.popupContent.toggleLyrics(),
      );
    }
    this.placePlaybackControl(
      this.secondaryPlaybackControlsBox,
      this.lyricsButton,
      1,
    );
  }

  updatePlayPause(mediaApp) {
    const { control, isReactive, action } = resolvePlayPauseControl(mediaApp);
    this.updatePlaybackControl(control, isReactive, action);
  }

  updatePlaybackControl(controlDefinition, isReactive, onClick) {
    const controlName = controlDefinition.name;
    const isPrimaryTransport = controlName === PlaybackControls.PLAY.name;
    const isSecondary =
      controlName === PlaybackControls.LOOP_NONE.name ||
      controlName === PlaybackControls.SHUFFLE_ON.name;
    const isActive =
      controlDefinition === PlaybackControls.LOOP_TRACK ||
      controlDefinition === PlaybackControls.LOOP_PLAYLIST ||
      controlDefinition === PlaybackControls.SHUFFLE_ON;
    const targetControlsBox = isSecondary
      ? this.secondaryPlaybackControlsBox
      : this.primaryPlaybackControlsBox;
    let control = this.controlButtons.get(controlName);
    if (!control) {
      const styleClasses = [
        "button",
        "mediashell-popup-control-button",
        isPrimaryTransport
          ? "mediashell-popup-control-button-primary"
          : "mediashell-popup-control-button-circular",
        isSecondary ? "mediashell-popup-control-button-state" : "",
      ]
        .filter(Boolean)
        .join(" ");
      const button = new St.Button({
        name: controlName,
        styleClass: styleClasses,
        xAlign: Clutter.ActorAlign.CENTER,
        yAlign: Clutter.ActorAlign.CENTER,
        toggleMode: isSecondary,
      });
      const icon = createIcon({
        styleClass: "popup-menu-icon mediashell-popup-control-icon",
      });
      control = { button, icon, onClick };
      button.set_child(icon);
      button.connect("clicked", () => {
        if (control.button.reactive) control.onClick?.();
      });
      this.controlButtons.set(controlName, control);
    }
    control.onClick = onClick;
    setIconName(control.icon, controlDefinition.iconName);
    control.button.trackHover = isReactive;
    control.button.opacity = isReactive ? ACTIVE_OPACITY : INACTIVE_OPACITY;
    control.button.reactive = isReactive;
    control.button.canFocus = isReactive;
    control.button.checked = isActive;
    this.placePlaybackControl(
      targetControlsBox,
      control.button,
      getPopupPlaybackControlIndex(controlName),
    );
  }

  placePlaybackControl(targetControlsBox, button, index) {
    const children = targetControlsBox.get_children();
    const currentIndex = children.indexOf(button);
    const targetIndex = Math.min(
      index,
      children.length - (currentIndex >= 0 ? 1 : 0),
    );
    if (
      currentIndex === targetIndex &&
      button.get_parent() === targetControlsBox
    )
      return;
    button.get_parent()?.remove_child(button);
    targetControlsBox.insert_child_at_index(button, Math.max(0, targetIndex));
  }

  destroy() {
    this.playbackControlsBox?.destroy();
    this.controlButtons.clear();
    this.lyricsButton = null;
    this.lyricsIcon = null;
    this.playbackControlsBox = null;
    this.primaryPlaybackControlsBox = null;
    this.secondaryPlaybackControlsBox = null;
    this.popupContent = null;
  }
}
''')

# Repoint existing popup components to the clean upper/lower ownership boxes.
for path, old, new in [
    ("src/shell/ui/popup/PopupAlbumArt.js", "return this.popupContent.popupItem;", "return this.popupContent.upperBox;"),
    ("src/shell/ui/popup/PopupAppSelectorButton.js", "return this.popupContent.popupItem;", "return this.popupContent.upperBox;"),
    ("src/shell/ui/popup/PopupAppSelectorList.js", "return this.popupContent.popupItem;", "return this.popupContent.upperBox;"),
    ("src/shell/ui/popup/PopupTrackInformation.js", "return this.popupContent.popupItem;", "return this.popupContent.lowerBox;"),
    ("src/shell/ui/popup/PopupProgressBar.js", "return this.popupContent.popupItem;", "return this.popupContent.lowerBox;"),
]:
    replace_once(path, old, new)

replace_once(
    "assets/org.gnome.shell.extensions.mediashell.gschema.xml",
    '''    <key name="popup-progress-bar-show" type="b">\n      <default>true</default>\n    </key>''',
    '''    <key name="popup-progress-bar-show" type="b">\n      <default>true</default>\n    </key>\n    <key name="popup-synced-lyrics-show" type="b">\n      <default>false</default>\n    </key>''',
)

replace_once(
    "src/shell/settings/SettingsSpec.js",
    '''  "popup-progress-bar-show": {\n    property: "popupProgressBarShow",\n    read: "get_boolean",\n    impact: WidgetFlags.POPUP_PROGRESS_BAR,\n  },''',
    '''  "popup-progress-bar-show": {\n    property: "popupProgressBarShow",\n    read: "get_boolean",\n    impact: WidgetFlags.POPUP_PROGRESS_BAR,\n  },\n  "popup-synced-lyrics-show": {\n    property: "popupSyncedLyricsShow",\n    read: "get_boolean",\n    impact: WidgetFlags.POPUP_PLAYBACK_CONTROLS,\n  },''',
)

replace_once(
    "src/prefs/bindings/PreferenceBindings.js",
    '''  ["popup-progress-bar-show", "sr-popup-progress-bar-show", "active"],''',
    '''  ["popup-progress-bar-show", "sr-popup-progress-bar-show", "active"],\n  ["popup-synced-lyrics-show", "sw-popup-synced-lyrics-show", "active"],''',
)

lyrics_group = '''    <child>\n      <object class="AdwPreferencesGroup">\n        <property name="title" translatable="yes">Lyrics</property>\n        <child>\n          <object class="AdwActionRow" id="ar-popup-synced-lyrics-show">\n            <property name="title" translatable="yes">Synchronized lyrics</property>\n            <property name="subtitle" translatable="yes">Add a button to the secondary controls to show lyrics for the current track</property>\n            <child type="suffix">\n              <object class="GtkMenuButton" id="mb-popup-synced-lyrics-info">\n                <property name="icon-name">info-outline-symbolic</property>\n                <property name="tooltip-text" translatable="yes">Lyrics source</property>\n                <property name="has-frame">false</property>\n                <property name="valign">center</property>\n                <property name="popover">\n                  <object class="GtkPopover">\n                    <property name="child">\n                      <object class="GtkBox">\n                        <property name="orientation">vertical</property>\n                        <property name="spacing">8</property>\n                        <property name="margin-top">12</property>\n                        <property name="margin-bottom">12</property>\n                        <property name="margin-start">12</property>\n                        <property name="margin-end">12</property>\n                        <child>\n                          <object class="GtkLabel">\n                            <property name="label" translatable="yes">Lyrics are provided by LRCLIB, an open community-maintained database.</property>\n                            <property name="wrap">true</property>\n                            <property name="max-width-chars">42</property>\n                            <property name="xalign">0</property>\n                          </object>\n                        </child>\n                        <child>\n                          <object class="GtkLabel">\n                            <property name="label" translatable="yes">When lyrics mode is opened, MediaShell sends the current track title, artist, album, and duration to LRCLIB. Availability and accuracy depend on the service's data.</property>\n                            <property name="wrap">true</property>\n                            <property name="max-width-chars">42</property>\n                            <property name="xalign">0</property>\n                          </object>\n                        </child>\n                      </object>\n                    </property>\n                  </object>\n                </property>\n              </object>\n            </child>\n            <child type="suffix">\n              <object class="GtkSwitch" id="sw-popup-synced-lyrics-show">\n                <property name="valign">center</property>\n              </object>\n            </child>\n          </object>\n        </child>\n      </object>\n    </child>\n'''
metadata_anchor = '''    <child>\n      <object class="AdwPreferencesGroup">\n        <property name="title" translatable="yes">Metadata</property>'''
replace_once("assets/ui/prefs.ui", metadata_anchor, lyrics_group + metadata_anchor)

write("src/prefs/constants/about.js", r'''/**
 * @file about.js
 * @module prefs.constants.about
 *
 * Defines immutable links and labels used by the About dialog.
 *
 * Keeping project and upstream credit URLs here leaves the controller responsible
 * only for constructing Libadwaita presentation.
 */

export const ABOUT_APP_ICON_NAME = "mediashell";
export const ABOUT_GITHUB_URL = "https://github.com/WSTxda/MediaShell";
export const ABOUT_DONATION_URL = "https://buymeacoffee.com/wstxda";
export const ABOUT_ISSUE_URL = "https://github.com/WSTxda/MediaShell/issues";
export const MEDIA_CONTROLS_GITHUB_URL = "https://github.com/sakithb/media-controls";
export const LRCLIB_WEBSITE_URL = "https://lrclib.net";
export const LRCLIB_GITHUB_URL = "https://github.com/tranxuanthang/lrclib";
''')

replace_once(
    "src/prefs/about/AboutDialogController.js",
    '''import { createLogger } from "../../shared/utils/log.js";\n\nconst logger = createLogger("AboutDialogController");\nconst APP_ICON_NAME = "mediashell";\nconst GITHUB_URL = "https://github.com/WSTxda/MediaShell";\nconst DONATION_URL = "https://buymeacoffee.com/wstxda";\nconst ISSUE_URL = "https://github.com/WSTxda/MediaShell/issues";\nconst MEDIA_CONTROLS_CONTRIBUTORS_URL =\n  "https://github.com/sakithb/media-controls/graphs/contributors?all=1";''',
    '''import { createLogger } from "../../shared/utils/log.js";\nimport {\n  ABOUT_APP_ICON_NAME,\n  ABOUT_DONATION_URL,\n  ABOUT_GITHUB_URL,\n  ABOUT_ISSUE_URL,\n  LRCLIB_GITHUB_URL,\n  LRCLIB_WEBSITE_URL,\n  MEDIA_CONTROLS_GITHUB_URL,\n} from "../constants/about.js";\n\nconst logger = createLogger("AboutDialogController");''',
)
replace_once(
    "src/prefs/about/AboutDialogController.js",
    '''      application_icon: APP_ICON_NAME,''',
    '''      application_icon: ABOUT_APP_ICON_NAME,''',
)
replace_once(
    "src/prefs/about/AboutDialogController.js",
    '''      issue_url: ISSUE_URL,''',
    '''      issue_url: ABOUT_ISSUE_URL,''',
)
replace_once(
    "src/prefs/about/AboutDialogController.js",
    '''    aboutDialog.add_link("GitHub", GITHUB_URL);\n    aboutDialog.add_link(_("Donate"), DONATION_URL);''',
    '''    aboutDialog.add_link("GitHub", ABOUT_GITHUB_URL);\n    aboutDialog.add_link(_("Donate"), ABOUT_DONATION_URL);''',
)
replace_once(
    "src/prefs/about/AboutDialogController.js",
    '''    aboutDialog.add_credit_section("Media Controls", [\n      "Sakith B. https://github.com/sakithb",\n      "Christian Lauinger https://github.com/ChrisLauinger77",\n      "Winston Ma https://github.com/winstonma",\n      "Ahmet Oğuzhan Kökülü https://github.com/Oguzhankokulu",\n      `${_("View all...")} ${MEDIA_CONTROLS_CONTRIBUTORS_URL}`,\n    ]);''',
    '''    aboutDialog.add_credit_section("Media Controls", [\n      `GitHub ${MEDIA_CONTROLS_GITHUB_URL}`,\n    ]);\n    aboutDialog.add_credit_section("LRCLIB", [\n      `${_("Website")} ${LRCLIB_WEBSITE_URL}`,\n      `GitHub ${LRCLIB_GITHUB_URL}`,\n    ]);''',
)

# Replace the popup root CSS and append focused lyrics styles.
replace_once(
    "src/stylesheet.css",
    '''/* Popup structure ------------------------------------------------------\n * `.mediashell-popup-container` is the Shell menu box; it stays flush so only the\n * component root below controls spacing.\n *\n * `.mediashell-popup-box` is the single source of truth for popup outer padding:\n * - horizontal padding: 16px, matched by POPUP_CONTAINER_PADDING in shell/constants/popup.js;\n * - top padding: 16px, matching Quick Settings density;\n * - bottom padding: 18px, a small optical balance for round controls.\n */\n.mediashell-popup-container {\n    padding: 0;\n}\n\n.mediashell-popup-box {\n    border-width: 0;\n    padding: 16px 16px 18px;\n    spacing: 12px;\n}\n\n.mediashell-popup-box > * {\n    margin-top: 0;\n    margin-bottom: 0;\n}\n''',
    '''/* Popup structure ------------------------------------------------------\n * The root is edge-to-edge. Normal upper and lower sections own the same 16 px\n * content inset as before, while the lyrics slot can reach both popup edges.\n */\n.mediashell-popup-container {\n    padding: 0;\n}\n\n.mediashell-popup-root {\n    border-width: 0;\n    padding: 0;\n    spacing: 0;\n}\n\n.mediashell-popup-upper {\n    padding: 16px 16px 0;\n    spacing: 12px;\n}\n\n.mediashell-popup-lower {\n    padding: 12px 16px 18px;\n    spacing: 12px;\n}\n\n.mediashell-popup-upper > *,\n.mediashell-popup-lower > * {\n    margin-top: 0;\n    margin-bottom: 0;\n}\n''',
)

with (ROOT / "src/stylesheet.css").open("a", encoding="utf-8") as stylesheet:
    stylesheet.write(r'''

/* Popup — Lyrics ------------------------------------------------------
 * The scroll surface owns the full popup width. Text padding belongs to the inner
 * list, leaving the overlay scrollbar flush with the popup's right edge.
 */
.mediashell-popup-lyrics-slot,
.mediashell-popup-lyrics-view,
.mediashell-popup-lyrics-scroll {
    padding: 0;
    margin: 0;
    min-width: 0;
}

.mediashell-popup-lyrics-scroll {
    -st-vfade-offset: 32px;
}

.mediashell-popup-lyrics-scroll StScrollBar {
    margin: 0;
    padding: 0;
}

.mediashell-popup-lyrics-list {
    padding: 0 24px 0 16px;
    spacing: 16px;
}

.mediashell-popup-lyrics-line {
    padding: 0;
    margin: 0;
    border-width: 0;
    border-radius: 0;
    background-color: transparent;
    box-shadow: none;
    text-align: left;
}

.mediashell-popup-lyrics-line:hover,
.mediashell-popup-lyrics-line:active,
.mediashell-popup-lyrics-line:focus {
    background-color: transparent;
    box-shadow: none;
}

.mediashell-popup-lyrics-line-label {
    font-size: 140%;
    font-weight: normal;
    opacity: 160;
    text-align: left;
}

.mediashell-popup-lyrics-line.active .mediashell-popup-lyrics-line-label {
    font-weight: bold;
    opacity: 255;
}

.mediashell-popup-lyrics-break {
    min-height: 10px;
}

.mediashell-popup-lyrics-close {
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    padding: 6px;
    border-width: 0;
    border-radius: 999px;
    background-color: transparent;
    box-shadow: none;
}

.mediashell-popup-lyrics-close:hover,
.mediashell-popup-lyrics-close:focus {
    background-color: rgba(128, 128, 128, 0.18);
    box-shadow: none;
}

.mediashell-popup-lyrics-close:active {
    background-color: rgba(128, 128, 128, 0.28);
    box-shadow: none;
}

.mediashell-popup-lyrics-close-icon {
    icon-size: 16px;
    padding: 0;
}

.mediashell-popup-lyrics-status {
    spacing: 14px;
    padding: 32px 24px;
}

.mediashell-popup-lyrics-status-icon {
    icon-size: 28px;
}

.mediashell-popup-lyrics-status-message {
    text-align: center;
}

.mediashell-popup-lyrics-search-button {
    border-radius: 999px;
    padding: 8px 12px;
}

.mediashell-popup-lyrics-search-content {
    spacing: 6px;
}

.mediashell-popup-lyrics-search-icon {
    icon-size: 16px;
}
''')

# Documentation changes are intentionally limited to the new feature and its owner flow.
replace_once(
    "README.md",
    '''#### Album art\n\n- Supports local and remote artwork with a configurable corner radius.\n- Optional disk cache for faster loads, adjustable from settings.\n''',
    '''#### Album art\n\n- Supports local and remote artwork with a configurable corner radius.\n- Optional disk cache for faster loads, adjustable from settings.\n\n#### Lyrics\n\n- Optional synchronized and plain lyrics from LRCLIB in a temporary popup mode.\n- Synchronized lines follow playback and support seeking when the media app exposes MPRIS seeking.\n''',
)

with (ROOT / "docs/ARCHITECTURE.md").open("a", encoding="utf-8") as architecture:
    architecture.write(r'''

## Lyrics

Lyrics are an optional popup subsystem and are loaded lazily only after the user
opens lyrics mode. `LrclibClient` owns bounded cancellable Soup transport,
`LyricsResolver` owns exact/search fallback and the session-only lookup cache,
and pure helpers under `shared/` own metadata matching and LRC parsing.

`PopupLyricsController` owns request generations, cancellation, synchronization,
seek, and reset. `PopupLyricsLayout` exchanges the normal upper popup area and
secondary controls for a minimum-height edge-to-edge lyrics slot without changing
ownership of track information, the progress bar, or primary controls.
`PopupLyricsView` owns wrapping, native `St.ScrollView` fades, a scrollbar at the
outer edge, centered smooth follow, and manual-scroll suspension.

Failure is fail-open: LRCLIB, parsing, or actor errors must not participate in
extension enablement or top bar construction. Every lookup problem shown to the
user converges on the common unavailable state with the external web-search action.
Lyrics results are cached only for the current Shell process; no persistent lyrics
cache or cache preference exists.
''')

write("tests/lrc.test.mjs", r'''import test from "node:test";
import assert from "node:assert/strict";

import {
  findActiveLyricIndex,
  parseLrc,
} from "../src/shared/utils/lrc.js";

test("parses timestamps, fractions, offsets, and multiple timestamps", () => {
  const lines = parseLrc(`
[offset:+100]
[00:01.5][00:02.050]Hello
[00:03.125]World
`);
  assert.deepEqual(lines, [
    { startTimeMs: 1600, text: "Hello" },
    { startTimeMs: 2150, text: "Hello" },
    { startTimeMs: 3225, text: "World" },
  ]);
});

test("ignores malformed and empty entries and sorts output", () => {
  assert.deepEqual(parseLrc("[00:02]B\ninvalid\n[00:01]A\n[00:03]"), [
    { startTimeMs: 1000, text: "A" },
    { startTimeMs: 2000, text: "B" },
  ]);
});

test("finds the active line with binary-search boundary behavior", () => {
  const lines = parseLrc("[00:01]A\n[00:02]B\n[00:04]C");
  assert.equal(findActiveLyricIndex(lines, 500), -1);
  assert.equal(findActiveLyricIndex(lines, 1000), 0);
  assert.equal(findActiveLyricIndex(lines, 3999), 1);
  assert.equal(findActiveLyricIndex(lines, 9000), 2);
});
''')

write("tests/lyrics.test.mjs", r'''import test from "node:test";
import assert from "node:assert/strict";

import {
  buildLyricsTrack,
  buildLyricsWebSearchUri,
  selectLyricsCandidate,
} from "../src/shared/utils/lyrics.js";
import LyricsLookupCache from "../src/shared/utils/lyricsCache.js";

test("normalizes MPRIS track metadata", () => {
  const track = buildLyricsTrack({
    "xesam:title": "Runaway",
    "xesam:artist": ["Kanye West"],
    "xesam:album": "My Beautiful Dark Twisted Fantasy",
    "mpris:length": 547_000_000,
  });
  assert.equal(track.artist, "Kanye West");
  assert.equal(track.durationSeconds, 547);
  assert.ok(track.identity.includes("runaway"));
});

test("selects a matching recording instead of the first search result", () => {
  const track = buildLyricsTrack({
    "xesam:title": "Runaway",
    "xesam:artist": ["Kanye West"],
    "mpris:length": 547_000_000,
  });
  const selected = selectLyricsCandidate(track, [
    { trackName: "Runaway", artistName: "Aurora", duration: 250, syncedLyrics: "x" },
    { trackName: "Runaway", artistName: "Kanye West", duration: 548, syncedLyrics: "y" },
  ]);
  assert.equal(selected.artistName, "Kanye West");
});

test("builds an encoded browser search", () => {
  const uri = buildLyricsWebSearchUri({ title: "Água", artist: "João" });
  assert.equal(uri, "https://www.google.com/search?q=%C3%81gua%20Jo%C3%A3o%20lyrics");
});

test("session cache retains values, short misses, and never caches failures", async () => {
  let now = 0;
  const cache = new LyricsLookupCache(() => now);
  let loads = 0;
  const first = await cache.resolve("track", null, async () => {
    loads++;
    return { type: "plain", text: "hello" };
  });
  const second = await cache.resolve("track", null, async () => {
    loads++;
    return null;
  });
  assert.deepEqual(first, second);
  assert.equal(loads, 1);

  await assert.rejects(
    cache.resolve("error", null, async () => {
      throw new Error("network");
    }),
  );
  await assert.rejects(
    cache.resolve("error", null, async () => {
      throw new Error("network again");
    }),
  );
});
''')

print("Lyrics reimplementation applied")
