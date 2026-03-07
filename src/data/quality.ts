export type QualityKey = "high" | "standard" | "datasaver" | "ultra";

export interface QualityConfig {
  key: QualityKey;
  url: string;
  badge: "MAX" | "HIGH" | "LOW";
  label: "Max" | "High" | "Low";
  bitrate: string;
  format: "MP3" | "aacPlus";
}

export const QUALITY_STORAGE_KEY = "blurfm_audio_quality";
export const DEFAULT_QUALITY: QualityKey = "standard";

export const LOW_QUALITY_KEYS: QualityKey[] = ["datasaver", "ultra"];

export const QUALITY_MAP: Record<QualityKey, QualityConfig> = {
  high: {
    key: "high",
    url: "https://play.blurfm.com/max",
    badge: "MAX",
    label: "Max",
    bitrate: "320 kbps",
    format: "MP3"
  },
  standard: {
    key: "standard",
    url: "https://play.blurfm.com/high",
    badge: "HIGH",
    label: "High",
    bitrate: "128 kbps",
    format: "MP3"
  },
  datasaver: {
    key: "datasaver",
    url: "https://play.blurfm.com/low",
    badge: "LOW",
    label: "Low",
    bitrate: "64 kbps",
    format: "MP3"
  },
  ultra: {
    key: "ultra",
    url: "https://play.blurfm.com/ultralow",
    badge: "LOW",
    label: "Low",
    bitrate: "32 kbps",
    format: "aacPlus"
  }
};
