import {
  DEFAULT_COVER_URL,
  DEFAULT_TRACK,
  type SongMetadata
} from "../data/playerDefaults";

const NOW_PLAYING_ENDPOINT = "https://www.blurfm.com/icecast-proxy.php";
const ITUNES_SEARCH_ENDPOINT = "https://itunes.apple.com/search";
const REQUEST_TIMEOUT_MS = 5000;

interface IcecastResponse {
  title?: string;
}

interface ItunesTrack {
  artworkUrl100?: string;
  collectionName?: string;
  releaseDate?: string;
}

interface ItunesResponse {
  results?: ItunesTrack[];
}

function splitNowPlaying(rawTitle?: string): Pick<SongMetadata, "artist" | "title"> | null {
  if (!rawTitle || typeof rawTitle !== "string") {
    return null;
  }

  const cleanTitle = rawTitle.trim();
  if (!cleanTitle) {
    return null;
  }

  const parts = cleanTitle.split(" - ");
  if (parts.length < 2) {
    return {
      artist: DEFAULT_TRACK.artist,
      title: cleanTitle
    };
  }

  const artist = parts.shift()?.trim() || DEFAULT_TRACK.artist;
  const title = parts.join(" - ").trim() || DEFAULT_TRACK.title;

  return { artist, title };
}

async function fetchJsonWithTimeout<T>(url: string, options?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed (${response.status})`);
    }

    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchArtwork(song: Pick<SongMetadata, "artist" | "title">): Promise<Partial<SongMetadata>> {
  const searchTerm = `${song.artist} ${song.title}`.trim();
  const url = new URL(ITUNES_SEARCH_ENDPOINT);
  url.searchParams.set("term", searchTerm);
  url.searchParams.set("media", "music");
  url.searchParams.set("limit", "1");

  const data = await fetchJsonWithTimeout<ItunesResponse>(url.toString(), {
    cache: "no-store"
  });

  const result = data.results?.[0];
  if (!result) {
    return {};
  }

  const coverUrl = result.artworkUrl100
    ? result.artworkUrl100.replace("100x100", "600x600")
    : undefined;

  const album = result.collectionName?.trim() || undefined;
  const releaseYear = result.releaseDate
    ? new Date(result.releaseDate).getFullYear()
    : undefined;
  const year = Number.isFinite(releaseYear) ? String(releaseYear) : undefined;

  return {
    coverUrl,
    album,
    year
  };
}

export async function fetchNowPlayingSong(): Promise<SongMetadata> {
  const fallback: SongMetadata = { ...DEFAULT_TRACK };

  try {
    const nowPlayingUrl = new URL(NOW_PLAYING_ENDPOINT);
    nowPlayingUrl.searchParams.set("t", Date.now().toString());

    const payload = await fetchJsonWithTimeout<IcecastResponse>(nowPlayingUrl.toString(), {
      cache: "no-store"
    });
    const parsed = splitNowPlaying(payload.title);

    if (!parsed) {
      return fallback;
    }

    const metadata: SongMetadata = {
      title: parsed.title,
      artist: parsed.artist,
      coverUrl: DEFAULT_COVER_URL
    };

    try {
      const artwork = await fetchArtwork(parsed);
      return {
        ...metadata,
        ...artwork,
        coverUrl: artwork.coverUrl || DEFAULT_COVER_URL
      };
    } catch {
      return metadata;
    }
  } catch {
    return fallback;
  }
}
