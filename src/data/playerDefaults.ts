export interface SongMetadata {
  title: string;
  artist: string;
  coverUrl: string;
  album?: string;
  year?: string;
}

export const DEFAULT_COVER_URL = "/brand/cover-default.webp";

export const DEFAULT_TRACK: SongMetadata = {
  title: "Blur FM",
  artist: "On Air",
  coverUrl: DEFAULT_COVER_URL
};

export const METADATA_POLL_INTERVAL_MS = 10000;
export const RECENTLY_PLAYED_LIMIT = 12;
