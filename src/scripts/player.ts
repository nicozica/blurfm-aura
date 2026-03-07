import {
  DEFAULT_QUALITY,
  LOW_QUALITY_KEYS,
  QUALITY_MAP,
  QUALITY_STORAGE_KEY,
  type QualityKey
} from "../data/quality";
import {
  DEFAULT_TRACK,
  METADATA_POLL_INTERVAL_MS,
  RECENTLY_PLAYED_LIMIT,
  type SongMetadata
} from "../data/playerDefaults";
import { fetchNowPlayingSong } from "../services/metadata";

interface RecentlyPlayedItem extends SongMetadata {
  playedAt: number;
}

function isQualityKey(value: string | null | undefined): value is QualityKey {
  return value === "high" || value === "standard" || value === "datasaver" || value === "ultra";
}

function getTrackIdentity(track: SongMetadata): string {
  return `${track.artist}::${track.title}`.toLowerCase().trim();
}

function isDefaultTrack(track: SongMetadata): boolean {
  return getTrackIdentity(track) === getTrackIdentity(DEFAULT_TRACK);
}

function isSameTrack(a: SongMetadata, b: SongMetadata): boolean {
  return (
    a.title === b.title &&
    a.artist === b.artist &&
    a.coverUrl === b.coverUrl &&
    a.album === b.album &&
    a.year === b.year
  );
}

function getStoredQuality(): QualityKey {
  const rawValue = localStorage.getItem(QUALITY_STORAGE_KEY);
  return isQualityKey(rawValue) ? rawValue : DEFAULT_QUALITY;
}

function escapeArtworkUrl(url: string): string {
  return url.replace(/"/g, "%22");
}

export function initAuraPlayer(): void {
  if (typeof window === "undefined") {
    return;
  }

  const root = document.getElementById("aura-app");
  if (!root || root.dataset.playerInit === "true") {
    return;
  }
  root.dataset.playerInit = "true";

  const audio = document.getElementById("audio-player") as HTMLAudioElement | null;
  const coverImage = document.getElementById("cover-image") as HTMLImageElement | null;
  const songTitle = document.getElementById("song-title");
  const songArtist = document.getElementById("song-artist");
  const songExtra = document.getElementById("song-extra");
  const songAlbum = document.getElementById("song-album");
  const songYear = document.getElementById("song-year");
  const songSeparator = document.getElementById("song-extra-separator");
  const playToggle = document.getElementById("play-toggle") as HTMLButtonElement | null;
  const playToggleGlyph = document.getElementById("play-toggle-glyph");
  const volumeIconButton = document.getElementById("volume-icon-btn") as HTMLButtonElement | null;
  const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
  const fullscreenToggle = document.getElementById("fullscreen-toggle") as HTMLButtonElement | null;
  const recentlyToggle = document.getElementById("recently-toggle") as HTMLButtonElement | null;
  const recentlyModal = document.getElementById("recently-modal");
  const recentlyOverlay = document.getElementById("recently-overlay") as HTMLButtonElement | null;
  const recentlyPanel = document.getElementById("recently-panel");
  const recentlyList = document.getElementById("recently-list") as HTMLUListElement | null;
  const recentlyEmpty = document.getElementById("recently-empty");
  const qualitySelector = document.getElementById("quality-selector");
  const qualityTrigger = document.getElementById("quality-trigger") as HTMLButtonElement | null;
  const qualityPanel = document.getElementById("quality-panel");
  const qualityBadge = document.getElementById("quality-current-badge");
  const qualityLowSelect = document.getElementById("quality-low-select") as HTMLSelectElement | null;

  if (
    !audio ||
    !coverImage ||
    !songTitle ||
    !songArtist ||
    !songExtra ||
    !songAlbum ||
    !songYear ||
    !songSeparator ||
    !playToggle ||
    !playToggleGlyph ||
    !volumeIconButton ||
    !volumeSlider ||
    !fullscreenToggle ||
    !recentlyToggle ||
    !recentlyModal ||
    !recentlyOverlay ||
    !recentlyPanel ||
    !recentlyList ||
    !recentlyEmpty ||
    !qualitySelector ||
    !qualityTrigger ||
    !qualityPanel ||
    !qualityBadge ||
    !qualityLowSelect
  ) {
    return;
  }

  const qualityOptions = Array.from(
    qualityPanel.querySelectorAll<HTMLButtonElement>(".quality-option-main[data-quality-option]")
  );

  let currentQuality = getStoredQuality();
  let currentTrack: SongMetadata = { ...DEFAULT_TRACK };
  let recentlyPlayed: RecentlyPlayedItem[] = [];
  let metadataIntervalId: number | null = null;
  let isPlaying = false;
  let isStreamBusy = false;
  let isQualityPanelOpen = false;
  let isRecentlyPanelOpen = false;
  let previousVolume = 1;

  function applyTvModeClass(): void {
    const largeScreen = window.innerWidth >= 1400 && window.innerHeight >= 800;
    const noHover = window.matchMedia("(any-hover: none)").matches;
    const coarsePointer = window.matchMedia("(pointer: coarse)").matches;
    document.body.classList.toggle("is-tv", largeScreen && (noHover || coarsePointer));
  }

  function setArtwork(url: string): void {
    const safeUrl = url || DEFAULT_TRACK.coverUrl;
    coverImage.src = safeUrl;
    root.style.setProperty("--artwork-url", `url("${escapeArtworkUrl(safeUrl)}")`);
  }

  function renderTrack(song: SongMetadata): void {
    songTitle.textContent = song.title;
    songArtist.textContent = song.artist;
    setArtwork(song.coverUrl);

    const hasAlbum = Boolean(song.album);
    const hasYear = Boolean(song.year);
    songAlbum.textContent = song.album || "";
    songYear.textContent = song.year || "";
    songAlbum.hidden = !hasAlbum;
    songYear.hidden = !hasYear;
    songSeparator.hidden = !(hasAlbum && hasYear);
    songExtra.hidden = !(hasAlbum || hasYear);
  }

  function renderRecentlyPlayed(): void {
    recentlyList.textContent = "";

    if (recentlyPlayed.length === 0) {
      recentlyEmpty.hidden = false;
      return;
    }

    recentlyEmpty.hidden = true;
    const formatter = new Intl.DateTimeFormat(undefined, {
      hour: "2-digit",
      minute: "2-digit"
    });

    recentlyPlayed.forEach((item) => {
      const li = document.createElement("li");
      li.className = "recently-item";

      const thumb = document.createElement("img");
      thumb.className = "recently-thumb";
      thumb.src = item.coverUrl || DEFAULT_TRACK.coverUrl;
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.referrerPolicy = "no-referrer";

      const copy = document.createElement("div");
      copy.className = "recently-copy";

      const title = document.createElement("p");
      title.className = "recently-title";
      title.textContent = item.title;

      const artist = document.createElement("p");
      artist.className = "recently-artist";
      artist.textContent = item.artist;

      copy.append(title, artist);

      const metaTokens = [item.album, item.year].filter(Boolean) as string[];
      if (metaTokens.length > 0) {
        const meta = document.createElement("p");
        meta.className = "recently-meta";
        meta.textContent = metaTokens.join(" • ");
        copy.append(meta);
      }

      const time = document.createElement("time");
      time.className = "recently-time";
      time.textContent = formatter.format(item.playedAt);

      li.append(thumb, copy, time);
      recentlyList.append(li);
    });
  }

  function addRecentlyPlayed(track: SongMetadata): void {
    if (isDefaultTrack(track)) {
      return;
    }

    const identity = getTrackIdentity(track);
    recentlyPlayed = [
      { ...track, playedAt: Date.now() },
      ...recentlyPlayed.filter((item) => getTrackIdentity(item) !== identity)
    ].slice(0, RECENTLY_PLAYED_LIMIT);

    renderRecentlyPlayed();
  }

  function syncPlayButton(): void {
    playToggle.disabled = isStreamBusy;
    playToggle.setAttribute("aria-pressed", String(isPlaying));
    playToggle.classList.toggle("is-busy", isStreamBusy);

    if (isStreamBusy) {
      playToggleGlyph.textContent = "◌";
      playToggle.setAttribute("aria-label", "Connecting");
      return;
    }

    if (isPlaying) {
      playToggleGlyph.textContent = "■";
      playToggle.setAttribute("aria-label", "Stop");
      return;
    }

    playToggleGlyph.textContent = "▶";
    playToggle.setAttribute("aria-label", "Play");
  }

  function syncVolumeIcon(): void {
    const volumeLevel = Number.parseFloat(volumeSlider.value);
    if (audio.muted || volumeLevel <= 0) {
      volumeIconButton.dataset.volumeState = "muted";
      volumeIconButton.setAttribute("aria-label", "Unmute");
      return;
    }

    if (volumeLevel <= 0.33) {
      volumeIconButton.dataset.volumeState = "low";
      volumeIconButton.setAttribute("aria-label", "Mute");
      return;
    }

    if (volumeLevel <= 0.66) {
      volumeIconButton.dataset.volumeState = "mid";
      volumeIconButton.setAttribute("aria-label", "Mute");
      return;
    }

    volumeIconButton.dataset.volumeState = "high";
    volumeIconButton.setAttribute("aria-label", "Mute");
  }

  function syncQualityUi(): void {
    const selectedConfig = QUALITY_MAP[currentQuality];
    qualityBadge.textContent = selectedConfig.badge;
    qualityBadge.setAttribute("data-quality", currentQuality);

    if (LOW_QUALITY_KEYS.includes(currentQuality)) {
      qualityLowSelect.value = currentQuality;
    }

    qualityOptions.forEach((button) => {
      const option = button.dataset.qualityOption;
      const isChecked =
        option === "low" ? LOW_QUALITY_KEYS.includes(currentQuality) : option === currentQuality;
      button.setAttribute("aria-checked", isChecked ? "true" : "false");
      button.tabIndex = isChecked ? 0 : -1;
    });
  }

  function openQualityPanel(): void {
    isQualityPanelOpen = true;
    qualityTrigger.setAttribute("aria-expanded", "true");
    qualityPanel.hidden = false;
  }

  function closeQualityPanel(): void {
    isQualityPanelOpen = false;
    qualityTrigger.setAttribute("aria-expanded", "false");
    qualityPanel.hidden = true;
  }

  function setRecentlyPanel(open: boolean): void {
    isRecentlyPanelOpen = open;
    recentlyModal.hidden = !open;
    recentlyToggle.setAttribute("aria-expanded", String(open));
    document.body.classList.toggle("is-recently-open", open);
  }

  function streamUrlFor(quality: QualityKey): string {
    return `${QUALITY_MAP[quality].url}?t=${Date.now()}`;
  }

  async function startPlayback(): Promise<void> {
    if (isStreamBusy) {
      return;
    }

    isStreamBusy = true;
    syncPlayButton();

    try {
      audio.pause();
      audio.src = "";
      audio.load();
      audio.src = streamUrlFor(currentQuality);
      await audio.play();
      isPlaying = true;
    } catch {
      isPlaying = false;
    } finally {
      isStreamBusy = false;
      syncPlayButton();
    }
  }

  function stopPlayback(): void {
    if (isStreamBusy) {
      return;
    }

    audio.pause();
    audio.src = "";
    audio.load();
    isPlaying = false;
    syncPlayButton();
  }

  async function applyQuality(newQuality: QualityKey): Promise<void> {
    if (newQuality === currentQuality) {
      return;
    }

    currentQuality = newQuality;
    localStorage.setItem(QUALITY_STORAGE_KEY, newQuality);
    syncQualityUi();

    if (isPlaying) {
      await startPlayback();
    }
  }

  function syncFullscreenUi(): void {
    const fullscreenOn = Boolean(document.fullscreenElement);
    fullscreenToggle.textContent = fullscreenOn ? "Exit full screen" : "Full screen";
    fullscreenToggle.setAttribute("aria-pressed", String(fullscreenOn));
  }

  async function refreshMetadata(): Promise<void> {
    const nextTrack = await fetchNowPlayingSong();
    if (isSameTrack(nextTrack, currentTrack)) {
      return;
    }

    if (getTrackIdentity(nextTrack) !== getTrackIdentity(currentTrack)) {
      addRecentlyPlayed(currentTrack);
    }

    currentTrack = nextTrack;
    renderTrack(currentTrack);
  }

  applyTvModeClass();
  window.addEventListener("resize", applyTvModeClass);

  audio.volume = Math.min(1, Math.max(0, Number.parseFloat(volumeSlider.value) || 1));
  audio.muted = false;
  previousVolume = audio.volume;
  renderTrack(currentTrack);
  renderRecentlyPlayed();
  syncPlayButton();
  syncVolumeIcon();
  syncQualityUi();
  setRecentlyPanel(false);
  syncFullscreenUi();

  playToggle.addEventListener("click", () => {
    if (isPlaying) {
      stopPlayback();
      return;
    }
    void startPlayback();
  });

  volumeSlider.addEventListener("input", () => {
    const nextVolume = Number.parseFloat(volumeSlider.value);
    const safeVolume = Math.min(1, Math.max(0, Number.isFinite(nextVolume) ? nextVolume : 1));
    audio.volume = safeVolume;
    if (safeVolume > 0) {
      audio.muted = false;
      previousVolume = safeVolume;
    } else {
      audio.muted = true;
    }
    syncVolumeIcon();
  });

  volumeIconButton.addEventListener("click", () => {
    if (audio.muted || audio.volume <= 0) {
      const restored = previousVolume > 0 ? previousVolume : 0.75;
      audio.muted = false;
      audio.volume = restored;
      volumeSlider.value = restored.toString();
      syncVolumeIcon();
      return;
    }

    previousVolume = audio.volume;
    audio.volume = 0;
    audio.muted = true;
    volumeSlider.value = "0";
    syncVolumeIcon();
  });

  qualityTrigger.addEventListener("click", () => {
    if (isQualityPanelOpen) {
      closeQualityPanel();
      return;
    }
    openQualityPanel();
  });

  qualityLowSelect.addEventListener("click", (event) => {
    event.stopPropagation();
  });

  qualityLowSelect.addEventListener("change", () => {
    if (!isQualityKey(qualityLowSelect.value)) {
      return;
    }
    void applyQuality(qualityLowSelect.value);
  });

  qualityOptions.forEach((button, index) => {
    button.addEventListener("click", () => {
      const qualityOption = button.dataset.qualityOption;
      if (qualityOption === "low") {
        if (isQualityKey(qualityLowSelect.value)) {
          void applyQuality(qualityLowSelect.value);
        }
        closeQualityPanel();
        return;
      }

      if (isQualityKey(qualityOption)) {
        void applyQuality(qualityOption);
        closeQualityPanel();
      }
    });

    button.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = qualityOptions[index + 1] || qualityOptions[0];
        next.focus();
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        const prev = qualityOptions[index - 1] || qualityOptions[qualityOptions.length - 1];
        prev.focus();
      }

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        button.click();
      }
    });
  });

  document.addEventListener("click", (event) => {
    if (!isQualityPanelOpen) {
      return;
    }
    if (!(event.target instanceof Node)) {
      return;
    }
    if (!qualitySelector.contains(event.target)) {
      closeQualityPanel();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeQualityPanel();
      if (isRecentlyPanelOpen) {
        setRecentlyPanel(false);
      }
    }
  });

  recentlyToggle.addEventListener("click", () => {
    setRecentlyPanel(!isRecentlyPanelOpen);
  });

  recentlyOverlay.addEventListener("click", () => {
    setRecentlyPanel(false);
  });

  if (!document.fullscreenEnabled) {
    fullscreenToggle.hidden = true;
  } else {
    fullscreenToggle.addEventListener("click", async () => {
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
        } else {
          await document.exitFullscreen();
        }
      } catch {
        return;
      }
      syncFullscreenUi();
    });

    document.addEventListener("fullscreenchange", syncFullscreenUi);
  }

  audio.addEventListener("error", () => {
    isPlaying = false;
    isStreamBusy = false;
    syncPlayButton();
  });

  void refreshMetadata();
  metadataIntervalId = window.setInterval(() => {
    void refreshMetadata();
  }, METADATA_POLL_INTERVAL_MS);

  window.addEventListener("beforeunload", () => {
    if (metadataIntervalId !== null) {
      window.clearInterval(metadataIntervalId);
    }
    audio.pause();
    audio.src = "";
  });
}
