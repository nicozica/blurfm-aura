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

const PLAY_START_TIMEOUT_MS = 7000;

function isQualityKey(value: string | null | undefined): value is QualityKey {
  return value === "high" || value === "standard" || value === "datasaver" || value === "ultra";
}

function getTrackIdentity(track: SongMetadata): string {
  return `${track.artist}::${track.title}`.toLowerCase().trim();
}

function normalizeTextToken(value: string | null | undefined): string {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

function isDefaultTrack(track: SongMetadata): boolean {
  return getTrackIdentity(track) === getTrackIdentity(DEFAULT_TRACK);
}

function isStationIdTrack(track: SongMetadata): boolean {
  const title = normalizeTextToken(track.title);
  const artist = normalizeTextToken(track.artist);

  if (!title) {
    return false;
  }

  if (title.includes("station id")) {
    return true;
  }

  const looksLikeIdCode = /\bid[\s_-]*\d{1,3}\b/.test(title);
  const looksLikeJingle = /\bjingle\b|\bident\b/.test(title);
  const isBlurBrandTrack = artist === "blur fm";

  return isBlurBrandTrack && (looksLikeIdCode || looksLikeJingle);
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

function toAbsoluteUrl(url: string): string {
  try {
    return new URL(url, window.location.origin).toString();
  } catch {
    return url;
  }
}

function buildMediaSessionArtwork(coverUrl: string): Array<{ src: string; sizes: string; type: string }> {
  const artwork: Array<{ src: string; sizes: string; type: string }> = [];

  if (coverUrl && coverUrl.includes("mzstatic.com")) {
    [96, 128, 192, 256, 384, 512].forEach((size) => {
      artwork.push({
        src: coverUrl.replace(/\d+x\d+/, `${size}x${size}`),
        sizes: `${size}x${size}`,
        type: "image/jpeg"
      });
    });
    return artwork;
  }

  if (coverUrl) {
    artwork.push(
      {
        src: toAbsoluteUrl(coverUrl),
        sizes: "600x600",
        type: "image/webp"
      },
      {
        src: toAbsoluteUrl("/icon-512x512.png"),
        sizes: "512x512",
        type: "image/png"
      }
    );
    return artwork;
  }

  artwork.push(
    {
      src: toAbsoluteUrl("/icon-512x512.png"),
      sizes: "512x512",
      type: "image/png"
    },
    {
      src: toAbsoluteUrl("/icon-192x192.png"),
      sizes: "192x192",
      type: "image/png"
    }
  );

  return artwork;
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
  const playToggleIcon = document.getElementById("play-toggle-icon") as HTMLImageElement | null;
  const volumeIconButton = document.getElementById("volume-icon-btn") as HTMLButtonElement | null;
  const volumeIcon = document.getElementById("volume-icon") as HTMLImageElement | null;
  const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement | null;
  const fullscreenToggle = document.getElementById("fullscreen-toggle") as HTMLButtonElement | null;
  const fullscreenToggleLabel = document.getElementById("fullscreen-toggle-label");
  const recentlyToggle = document.getElementById("recently-toggle") as HTMLButtonElement | null;
  const recentlyToggleMobile = document.getElementById(
    "recently-toggle-mobile"
  ) as HTMLButtonElement | null;
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
    !playToggleIcon ||
    !volumeIconButton ||
    !volumeIcon ||
    !volumeSlider ||
    !fullscreenToggle ||
    !fullscreenToggleLabel ||
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
  let mediaSessionHandlersInit = false;
  let previousVolume = 1;
  const playIconSrc = playToggleIcon.dataset.playIcon || "/brand/player-controls/btn-play.svg";
  const stopIconSrc = playToggleIcon.dataset.stopIcon || "/brand/player-controls/btn-stop.svg";
  const volumeIconMuted = volumeIcon.dataset.muted || "/brand/volume-muted.svg";
  const volumeIconLow = volumeIcon.dataset.low || "/brand/volume-low.svg";
  const volumeIconMid = volumeIcon.dataset.mid || "/brand/volume-mid.svg";
  const volumeIconHigh = volumeIcon.dataset.high || "/brand/volume-high.svg";

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

  function updateMediaSessionMetadata(): void {
    if (!("mediaSession" in navigator)) {
      return;
    }

    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.title || "Blur FM",
        artist: currentTrack.artist || "Blur FM",
        album: "Blur FM Online Radio",
        artwork: buildMediaSessionArtwork(currentTrack.coverUrl || DEFAULT_TRACK.coverUrl)
      });
    } catch {
      return;
    }
  }

  function syncMediaSessionState(): void {
    if (!("mediaSession" in navigator)) {
      return;
    }
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }

  function initMediaSessionHandlers(): void {
    if (!("mediaSession" in navigator) || mediaSessionHandlersInit) {
      return;
    }

    mediaSessionHandlersInit = true;

    const safeSetHandler = (
      action: MediaSessionAction,
      handler: MediaSessionActionHandler | null
    ): void => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        return;
      }
    };

    safeSetHandler("play", async () => {
      if (!isPlaying) {
        await startPlayback();
      }
    });

    safeSetHandler("pause", () => {
      if (isPlaying || isStreamBusy || audio.currentSrc) {
        stopPlayback();
      }
    });

    safeSetHandler("stop", () => {
      if (isPlaying || isStreamBusy || audio.currentSrc) {
        stopPlayback();
      }
    });
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
    updateMediaSessionMetadata();
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
    if (isDefaultTrack(track) || isStationIdTrack(track)) {
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
    playToggleIcon.classList.toggle("is-busy", isStreamBusy);

    if (isStreamBusy) {
      playToggleIcon.src = isPlaying ? stopIconSrc : playIconSrc;
      playToggle.setAttribute("aria-label", "Connecting");
      return;
    }

    if (isPlaying) {
      playToggleIcon.src = stopIconSrc;
      playToggle.setAttribute("aria-label", "Stop");
      return;
    }

    playToggleIcon.src = playIconSrc;
    playToggle.setAttribute("aria-label", "Play");
  }

  function syncVolumeIcon(): void {
    const volumeLevel = Number.parseFloat(volumeSlider.value);
    if (audio.muted || volumeLevel <= 0) {
      volumeIcon.src = volumeIconMuted;
      volumeIconButton.setAttribute("aria-label", "Unmute");
      return;
    }

    if (volumeLevel <= 0.33) {
      volumeIcon.src = volumeIconLow;
      volumeIconButton.setAttribute("aria-label", "Mute");
      return;
    }

    if (volumeLevel <= 0.66) {
      volumeIcon.src = volumeIconMid;
      volumeIconButton.setAttribute("aria-label", "Mute");
      return;
    }

    volumeIcon.src = volumeIconHigh;
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
    if (recentlyToggleMobile) {
      recentlyToggleMobile.setAttribute("aria-expanded", String(open));
    }
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
      const playPromise = audio.play();
      const playResult = await Promise.race([
        playPromise.then(() => "ok" as const).catch(() => "error" as const),
        new Promise<"timeout">((resolve) => {
          window.setTimeout(() => resolve("timeout"), PLAY_START_TIMEOUT_MS);
        })
      ]);

      if (playResult === "ok") {
        isPlaying = true;
      } else if (playResult === "error") {
        isPlaying = false;
      } else {
        isPlaying = !audio.paused;
      }
    } catch {
      isPlaying = false;
    } finally {
      isStreamBusy = false;
      syncPlayButton();
      syncMediaSessionState();
    }
  }

  function stopPlayback(): void {
    audio.pause();
    audio.src = "";
    audio.load();
    isPlaying = false;
    isStreamBusy = false;
    syncPlayButton();
    syncMediaSessionState();
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
    fullscreenToggleLabel.textContent = fullscreenOn ? "Exit full screen" : "Full screen";
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
  updateMediaSessionMetadata();
  syncMediaSessionState();
  initMediaSessionHandlers();

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

  if (recentlyToggleMobile) {
    recentlyToggleMobile.addEventListener("click", () => {
      setRecentlyPanel(!isRecentlyPanelOpen);
    });
  }

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
    syncMediaSessionState();
  });

  audio.addEventListener("playing", () => {
    isPlaying = true;
    isStreamBusy = false;
    syncPlayButton();
    syncMediaSessionState();
    updateMediaSessionMetadata();
  });

  audio.addEventListener("waiting", () => {
    if (!audio.paused && audio.currentSrc) {
      isStreamBusy = true;
      syncPlayButton();
    }
  });

  audio.addEventListener("stalled", () => {
    if (!audio.paused && audio.currentSrc) {
      isStreamBusy = true;
      syncPlayButton();
    }
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
