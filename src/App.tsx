import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { translations, type Language, type TranslationKey } from "./i18n";
import "./App.css";

type View = "playlists" | "settings";

type Playlist = {
  id: number;
  title: string;
  track_count: number;
  is_private: boolean;
  artwork_url?: string | null;
  has_local_link: boolean;
  has_local_folder: boolean;
};

type PlaylistTrack = {
  id: number;
  title: string;
  duration_ms?: number | null;
  artist?: string | null;
  permalink_url?: string | null;
  associated_url?: string | null;
  artwork_url?: string | null;
  genre?: string | null;
  bpm?: number | null;
  key_signature?: string | null;
  playback_count?: number | null;
  likes_count?: number | null;
  reposts_count?: number | null;
  comment_count?: number | null;
  created_at?: string | null;
  release_date?: string | null;
  tag_list?: string | null;
  label_name?: string | null;
  local_file?: LocalAudioFileInfo | null;
};

type LocalAudioFileInfo = {
  file_path: string;
  file_name: string;
  file_size_bytes?: number | null;
  modified_at?: number | null;
  matched_soundcloud_url: string;
  local_cover_data_url?: string | null;
  local_title?: string | null;
  local_artist?: string | null;
  local_duration_seconds?: number | null;
  local_format?: string | null;
  local_bitrate_kbps?: number | null;
  local_max_frequency_hz?: number | null;
  local_quality_label?: string | null;
  local_sample_rate_hz?: number | null;
  local_channels?: number | null;
};

type PlaylistDetails = {
  id: number;
  title: string;
  track_count: number;
  is_private: boolean;
  permalink_url?: string | null;
  tracks: PlaylistTrack[];
};

type SoundCloudConfigStatus = {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
};

type SpotifyConfigStatus = {
  configured: boolean;
  connected: boolean;
  redirect_uri: string;
};

type AuthStartPayload = {
  state: string;
  auth_url: string;
  code_verifier?: string | null;
};

type DebugSettings = {
  soundcloud_fallback_headless: boolean;
  logs_enabled: boolean;
};

type PlaylistCoverMode = "first" | "random";

type MiscSettings = {
  playlist_cover_mode: PlaylistCoverMode;
  download_embed_cover?: boolean;
  download_rename_with_soundcloud_title?: boolean;
  hypeddit_download_headless?: boolean;
  hypeddit_download_comment?: string;
  hypeddit_download_name?: string;
  hypeddit_download_email?: string;
};

type PlaylistLocalFolderAssociation = {
  playlist_id: number;
  folder_path?: string | null;
  folder_available: boolean;
};

type PlaylistDetailsCacheEntry = {
  details: PlaylistDetails;
  cached_at_ms: number;
};

type PlaylistLocalScanResult = {
  playlist_id: number;
  folder_path: string;
  scanned_files: number;
  matched_files: number;
};

type ThemeMode = "light" | "dark";
type CoverQuality = "large" | "t300x300" | "t500x500" | "original";
type TrackSortOrder = "original" | "alphabetical" | "mostPlayed";
type DownloadSourceFilter = "all" | "downloadable" | "hypeddit" | "bandcamp";
type LocalDownloadFilter = "all" | "downloaded" | "notDownloaded";
type AudioQualityFilter = "all" | "high" | "good" | "medium" | "low" | "unknown";
type TrackViewMode = "list" | "icons";
type SpectrogramAnalysisScope = "quarter" | "half" | "full";

type SpectrogramPreviewResult = {
  temp_path: string;
  image_data_url: string;
  estimated_cutoff_hz?: number | null;
};

type LocalAnalysisUpdateResult = {
  local_max_frequency_hz?: number | null;
  local_quality_label?: string | null;
};

type PlaylistGlobalAudioAnalysisResult = {
  analyzed_tracks: number;
  updated_tracks: number;
  skipped_tracks: number;
  failed_tracks: number;
};

type MovePlaylistTrackResult = {
  moved_local_link: boolean;
  moved_local_file_path?: string | null;
};

type HypedditDownloadResult = {
  file_path: string;
  file_name: string;
  overwrote_existing: boolean;
};

type HypedditDownloadProgressPayload = {
  phase: string;
};

const MAX_PLAYLIST_DETAILS_CACHE_SIZE = 4;

function App() {
  const cardScrollRef = useRef<HTMLElement | null>(null);
  const sectionControlsRef = useRef<HTMLDivElement | null>(null);
  const [activeView, setActiveView] = useState<View>("playlists");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [configStatus, setConfigStatus] = useState<SoundCloudConfigStatus | null>(null);
  const [spotifyStatus, setSpotifyStatus] = useState<SpotifyConfigStatus | null>(null);
  const [status, setStatus] = useState("");
  const [globalPopupMessage, setGlobalPopupMessage] = useState<string | null>(null);
  const [loadingPlaylists, setLoadingPlaylists] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectingSpotify, setConnectingSpotify] = useState(false);
  const [selectedPlaylistDetails, setSelectedPlaylistDetails] = useState<PlaylistDetails | null>(null);
  const [selectedTrackInfo, setSelectedTrackInfo] = useState<PlaylistTrack | null>(null);
  const [debugSettings, setDebugSettings] = useState<DebugSettings>({
    soundcloud_fallback_headless: true,
    logs_enabled: true,
  });
  const [playlistCoverMode, setPlaylistCoverMode] = useState<PlaylistCoverMode>("first");
  const [savingPlaylistCoverMode, setSavingPlaylistCoverMode] = useState(false);
  const [downloadEmbedCover, setDownloadEmbedCover] = useState(false);
  const [downloadRenameWithSoundcloudTitle, setDownloadRenameWithSoundcloudTitle] = useState(false);
  const [hypedditDownloadHeadless, setHypedditDownloadHeadless] = useState(true);
  const [hypedditDownloadComment, setHypedditDownloadComment] = useState("Nice tune!");
  const [hypedditDownloadName, setHypedditDownloadName] = useState("Jojo");
  const [hypedditDownloadEmail, setHypedditDownloadEmail] = useState("jouch@hippo.com");
  const [themeMode, setThemeMode] = useState<ThemeMode>("dark");
  const [panelCoverQuality, setPanelCoverQuality] = useState<CoverQuality>("t500x500");
  const [language, setLanguage] = useState<Language>("fr");
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [trackSortOrder, setTrackSortOrder] = useState<TrackSortOrder>("original");
  const [downloadSourceFilter, setDownloadSourceFilter] = useState<DownloadSourceFilter>("all");
  const [localDownloadFilter, setLocalDownloadFilter] = useState<LocalDownloadFilter>("all");
  const [audioQualityFilter, setAudioQualityFilter] = useState<AudioQualityFilter>("all");
  const [trackViewMode, setTrackViewMode] = useState<TrackViewMode>("list");
  const [spectrogramAnalysisScope, setSpectrogramAnalysisScope] = useState<SpectrogramAnalysisScope>("half");
  const [playlistFolderPath, setPlaylistFolderPath] = useState("");
  const [playlistFolderAvailable, setPlaylistFolderAvailable] = useState(true);
  const [loadingPlaylistFolder, setLoadingPlaylistFolder] = useState(false);
  const [scanningLocalFiles, setScanningLocalFiles] = useState(false);
  const [associatingLocalFile, setAssociatingLocalFile] = useState(false);
  const [dissociatingLocalFile, setDissociatingLocalFile] = useState(false);
  const [embeddingLocalCover, setEmbeddingLocalCover] = useState(false);
  const [downloadingFromHypeddit, setDownloadingFromHypeddit] = useState(false);
  const [hypedditDownloadPhase, setHypedditDownloadPhase] = useState("");
  const [showHypedditDownloadMenu, setShowHypedditDownloadMenu] = useState(false);
  const [overwriteExistingHypedditDownload, setOverwriteExistingHypedditDownload] = useState(false);
  const [exportingSpectrogram, setExportingSpectrogram] = useState(false);
  const [loadingSpectrogramPreview, setLoadingSpectrogramPreview] = useState(false);
  const [savingManualCutoff, setSavingManualCutoff] = useState(false);
  const [runningGlobalAudioAnalysis, setRunningGlobalAudioAnalysis] = useState(false);
  const [confirmGlobalAudioAnalysis, setConfirmGlobalAudioAnalysis] = useState(false);
  const [overwriteExistingGlobalAnalysis, setOverwriteExistingGlobalAnalysis] = useState(false);
  const [manualCutoffInputHz, setManualCutoffInputHz] = useState("");
  const [spectrogramPreview, setSpectrogramPreview] = useState<SpectrogramPreviewResult | null>(null);
  const [targetPlaylistIdForMove, setTargetPlaylistIdForMove] = useState<number | "">("");
  const [movingTrackBetweenPlaylists, setMovingTrackBetweenPlaylists] = useState(false);
  const spectrogramPreviewTempPathRef = useRef<string | null>(null);
  const playlistDetailsCacheRef = useRef<Map<number, PlaylistDetailsCacheEntry>>(new Map());
  const [refreshingPlaylistDetails, setRefreshingPlaylistDetails] = useState(false);

  function upsertPlaylistDetailsCache(details: PlaylistDetails) {
    // Reinsert key to keep recency order, then evict oldest entries if needed.
    playlistDetailsCacheRef.current.delete(details.id);
    playlistDetailsCacheRef.current.set(details.id, {
      details,
      cached_at_ms: Date.now(),
    });

    while (playlistDetailsCacheRef.current.size > MAX_PLAYLIST_DETAILS_CACHE_SIZE) {
      const oldest = playlistDetailsCacheRef.current.keys().next().value as number | undefined;
      if (oldest === undefined) {
        break;
      }
      playlistDetailsCacheRef.current.delete(oldest);
    }
  }

  function setSelectedPlaylistDetailsWithCache(details: PlaylistDetails | null) {
    if (details) {
      upsertPlaylistDetailsCache(details);
    }
    setSelectedPlaylistDetails(details);
  }

  function updateSelectedPlaylistDetailsWithCache(
    updater: (current: PlaylistDetails | null) => PlaylistDetails | null,
  ) {
    setSelectedPlaylistDetails((current) => {
      const next = updater(current);
      if (next) {
        upsertPlaylistDetailsCache(next);
      }
      return next;
    });
  }

  function applyPlaylistsSnapshot(items: Playlist[], clearSelectionWhenEmpty: boolean) {
    setPlaylists(items);

    const currentIds = new Set(items.map((playlist) => playlist.id));
    for (const playlistId of playlistDetailsCacheRef.current.keys()) {
      if (!currentIds.has(playlistId)) {
        playlistDetailsCacheRef.current.delete(playlistId);
      }
    }

    if (selectedPlaylistDetails && !currentIds.has(selectedPlaylistDetails.id)) {
      setSelectedPlaylistDetails(null);
      setSelectedTrackInfo(null);
    }

    if (clearSelectionWhenEmpty && items.length === 0) {
      setSelectedPlaylistDetails(null);
      setSelectedTrackInfo(null);
      playlistDetailsCacheRef.current.clear();
    }
  }

  function t(key: TranslationKey) {
    return translations[language][key];
  }

  function getHypedditProgressLabel(phase: string) {
    switch (phase) {
      case "browser_ready":
        return t("hypedditProgressBrowserReady");
      case "gate_running":
        return t("hypedditProgressGateRunning");
      case "download_started":
        return t("hypedditProgressDownloadStarted");
      case "browser_cut":
        return t("hypedditProgressBrowserCut");
      case "file_saving":
        return t("hypedditProgressSaving");
      default:
        return t("hypedditDownloadRunning");
    }
  }

  async function removeTemporaryPreview(path?: string | null) {
    if (!path) {
      return;
    }

    try {
      await invoke("delete_local_spectrogram_preview", { tempPath: path });
    } catch {
    }
  }

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    void (async () => {
      unlisten = await listen<HypedditDownloadProgressPayload>("hypeddit-download-progress", (event) => {
        const phase = event.payload?.phase?.trim();
        if (!phase) {
          return;
        }
        setHypedditDownloadPhase(phase);
      });
    })();

    return () => {
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(() => {
    const storedTheme = localStorage.getItem("glazer_theme") as ThemeMode | null;
    const initialTheme = storedTheme === "light" || storedTheme === "dark" ? storedTheme : "dark";
    const storedCoverQuality = localStorage.getItem("glazer_panel_cover_quality") as CoverQuality | null;
    const storedLanguage = localStorage.getItem("glazer_language") as Language | null;
    const storedSpectrogramAnalysisScope = localStorage.getItem("glazer_spectrogram_analysis_scope") as SpectrogramAnalysisScope | null;
    const initialCoverQuality =
      storedCoverQuality === "large" ||
      storedCoverQuality === "t300x300" ||
      storedCoverQuality === "t500x500" ||
      storedCoverQuality === "original"
        ? storedCoverQuality
        : "t500x500";
      const initialLanguage = storedLanguage === "fr" || storedLanguage === "en" ? storedLanguage : "fr";
      const initialSpectrogramAnalysisScope =
        storedSpectrogramAnalysisScope === "quarter" ||
        storedSpectrogramAnalysisScope === "half" ||
        storedSpectrogramAnalysisScope === "full"
          ? storedSpectrogramAnalysisScope
          : "half";
    applyTheme(initialTheme);
    setThemeMode(initialTheme);
    setPanelCoverQuality(initialCoverQuality);
      setLanguage(initialLanguage);
      setSpectrogramAnalysisScope(initialSpectrogramAnalysisScope);

    loadInitialData();
  }, []);

  useEffect(() => {
    cardScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView, selectedPlaylistDetails?.id]);

  useEffect(() => {
    const previousPath = spectrogramPreviewTempPathRef.current;
    spectrogramPreviewTempPathRef.current = null;
    setSpectrogramPreview(null);
    setManualCutoffInputHz("");
    setLoadingSpectrogramPreview(false);
    void removeTemporaryPreview(previousPath);

    return () => {
      const cleanupPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = null;
      void removeTemporaryPreview(cleanupPath);
    };
  }, [selectedTrackInfo?.id, spectrogramAnalysisScope]);

  useEffect(() => {
    if (!selectedTrackInfo || !selectedPlaylistDetails) {
      setTargetPlaylistIdForMove("");
      setShowHypedditDownloadMenu(false);
      setOverwriteExistingHypedditDownload(false);
      return;
    }

    const sourceHasLocalFolder = Boolean(playlistFolderPath.trim());
    const availableTargets = playlists.filter(
      (playlist) =>
        playlist.id !== selectedPlaylistDetails.id &&
        playlist.has_local_folder === sourceHasLocalFolder,
    );
    if (availableTargets.length === 0) {
      setTargetPlaylistIdForMove("");
      return;
    }

    const currentTargetStillValid = availableTargets.some((playlist) => playlist.id === targetPlaylistIdForMove);
    if (!currentTargetStillValid) {
      setTargetPlaylistIdForMove(availableTargets[0].id);
    }
  }, [selectedTrackInfo?.id, selectedPlaylistDetails?.id, playlists]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!isFilterMenuOpen && !isActionsMenuOpen) {
        return;
      }

      const target = event.target as Node | null;
      if (!target) {
        return;
      }

      if (sectionControlsRef.current?.contains(target)) {
        return;
      }

      setIsFilterMenuOpen(false);
      setIsActionsMenuOpen(false);
      setConfirmGlobalAudioAnalysis(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isFilterMenuOpen, isActionsMenuOpen]);

  async function persistCutoffAnalysis(cutoffHz: number) {
    if (!selectedPlaylistDetails || !selectedTrackInfo?.permalink_url || !selectedTrackInfo.local_file) {
      return;
    }

    const analysisUpdate = await invoke<LocalAnalysisUpdateResult>("save_playlist_track_cutoff_analysis", {
      playlistId: selectedPlaylistDetails.id,
      trackPermalinkUrl: selectedTrackInfo.permalink_url,
      cutoffHz,
    });

    setSelectedPlaylistDetails((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        tracks: current.tracks.map((track) =>
          track.id === selectedTrackInfo.id && track.local_file
            ? {
                ...track,
                local_file: {
                  ...track.local_file,
                  local_max_frequency_hz: analysisUpdate.local_max_frequency_hz ?? track.local_file.local_max_frequency_hz,
                  local_quality_label: analysisUpdate.local_quality_label ?? track.local_file.local_quality_label,
                },
              }
            : track,
        ),
      };
    });

    setSelectedTrackInfo((current) => {
      if (!current || current.id !== selectedTrackInfo.id || !current.local_file) {
        return current;
      }

      return {
        ...current,
        local_file: {
          ...current.local_file,
          local_max_frequency_hz: analysisUpdate.local_max_frequency_hz ?? current.local_file.local_max_frequency_hz,
          local_quality_label: analysisUpdate.local_quality_label ?? current.local_file.local_quality_label,
        },
      };
    });
  }

  async function saveManualCutoff() {
    const parsed = Number.parseInt(manualCutoffInputHz.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus(t("localSpectrogramManualInvalid"));
      return;
    }

    try {
      setSavingManualCutoff(true);
      await persistCutoffAnalysis(parsed);
      setStatus(`${t("localSpectrogramManualSaved")}: ${formatFrequency(parsed)}`);
    } catch (error) {
      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
    } finally {
      setSavingManualCutoff(false);
    }
  }

  async function generateSpectrogramPreview() {
    const localFilePath = selectedTrackInfo?.local_file?.file_path;
    if (!localFilePath) {
      return;
    }

    setLoadingSpectrogramPreview(true);

    try {
      const result = await invoke<SpectrogramPreviewResult>("generate_local_spectrogram_preview", {
        filePath: localFilePath,
        analysisScope: spectrogramAnalysisScope,
      });

      const previousPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = result.temp_path;
      setSpectrogramPreview(result);

      if (result.estimated_cutoff_hz && result.estimated_cutoff_hz > 0) {
        try {
          await persistCutoffAnalysis(result.estimated_cutoff_hz);
        } catch (persistError) {
          // Keep preview visible even if analysis persistence fails.
          setStatus(`${t("localSpectrogramExportError")}: ${String(persistError)}`);
        }
        setManualCutoffInputHz(String(result.estimated_cutoff_hz));
      }

      if (previousPath && previousPath !== result.temp_path) {
        await removeTemporaryPreview(previousPath);
      }
    } catch (error) {
      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
    } finally {
      setLoadingSpectrogramPreview(false);
    }
  }

  async function loadInitialData() {
    const [soundcloud] = await Promise.all([
      loadConfigStatus(),
      loadSpotifyStatus(),
      loadDebugSettings(),
      loadMiscSettings(),
    ]);

    if (soundcloud?.connected) {
      await syncPlaylists(true);
    } else {
      await loadPlaylists();
    }
  }

  function applyTheme(mode: ThemeMode) {
    document.documentElement.setAttribute("data-theme", mode);
    localStorage.setItem("glazer_theme", mode);
  }

  function onThemeChange(mode: ThemeMode) {
    setThemeMode(mode);
    applyTheme(mode);
  }

  function onPanelCoverQualityChange(quality: CoverQuality) {
    setPanelCoverQuality(quality);
    localStorage.setItem("glazer_panel_cover_quality", quality);
  }

  function onLanguageChange(nextLanguage: Language) {
    setLanguage(nextLanguage);
    localStorage.setItem("glazer_language", nextLanguage);
  }

  function onSpectrogramAnalysisScopeChange(scope: SpectrogramAnalysisScope) {
    setSpectrogramAnalysisScope(scope);
    localStorage.setItem("glazer_spectrogram_analysis_scope", scope);
  }

  async function loadConfigStatus(): Promise<SoundCloudConfigStatus | null> {
    try {
      const currentStatus = await invoke<SoundCloudConfigStatus>("get_connection_status");
      setConfigStatus(currentStatus);
      return currentStatus;
    } catch (error) {
      setStatus(`${t("statusConfigError")}: ${String(error)}`);
      return null;
    }
  }

  async function loadSpotifyStatus() {
    try {
      const currentStatus = await invoke<SpotifyConfigStatus>("get_spotify_connection_status");
      setSpotifyStatus(currentStatus);
    } catch (error) {
      setStatus(`${t("statusSpotifyConfigError")}: ${String(error)}`);
    }
  }

  async function loadPlaylists() {
    setLoadingPlaylists(true);
    try {
      const items = await invoke<Playlist[]>("get_playlists");
      applyPlaylistsSnapshot(items, true);
    } catch (error) {
      setStatus(`${t("statusPlaylistsError")}: ${String(error)}`);
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function syncPlaylists(silent = false) {
    setLoadingPlaylists(true);
    try {
      const items = await invoke<Playlist[]>("sync_soundcloud_playlists");
      applyPlaylistsSnapshot(items, false);

      if (!silent) {
        setStatus(t("statusSyncOk"));
      }
    } catch (error) {
      if (!silent) {
        setStatus(`${t("statusSyncError")}: ${String(error)}`);
      }
    } finally {
      setLoadingPlaylists(false);
    }
  }

  async function loadDebugSettings() {
    try {
      const settings = await invoke<DebugSettings>("get_debug_settings");
      setDebugSettings(settings);
    } catch (error) {
      setStatus(`${t("statusDebugError")}: ${String(error)}`);
    }
  }

  async function loadMiscSettings() {
    try {
      const settings = await invoke<MiscSettings>("get_misc_settings");
      setPlaylistCoverMode(settings.playlist_cover_mode ?? "first");
      setDownloadEmbedCover(Boolean(settings.download_embed_cover));
      setDownloadRenameWithSoundcloudTitle(Boolean(settings.download_rename_with_soundcloud_title));
      setHypedditDownloadHeadless(settings.hypeddit_download_headless ?? true);
      setHypedditDownloadComment(settings.hypeddit_download_comment?.trim() || "Nice tune!");
      setHypedditDownloadName(settings.hypeddit_download_name?.trim() || "Jojo");
      setHypedditDownloadEmail(settings.hypeddit_download_email?.trim() || "jouch@hippo.com");
    } catch (error) {
      setStatus(`${t("statusMiscSettingsError")}: ${String(error)}`);
    }
  }

  async function saveDownloadEmbedCover(enabled: boolean) {
    try {
      await invoke("set_download_embed_cover", { enabled });
      setDownloadEmbedCover(enabled);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveDownloadRenameWithSoundcloudTitle(enabled: boolean) {
    try {
      await invoke("set_download_rename_with_soundcloud_title", { enabled });
      setDownloadRenameWithSoundcloudTitle(enabled);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveHypedditDownloadHeadless(enabled: boolean) {
    try {
      await invoke("set_hypeddit_download_headless", { enabled });
      setHypedditDownloadHeadless(enabled);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveHypedditDownloadComment(comment: string) {
    const normalized = comment.trim() || "Nice tune!";
    try {
      await invoke("set_hypeddit_download_comment", { comment: normalized });
      setHypedditDownloadComment(normalized);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveHypedditDownloadName(name: string) {
    const normalized = name.trim() || "Jojo";
    try {
      await invoke("set_hypeddit_download_name", { name: normalized });
      setHypedditDownloadName(normalized);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveHypedditDownloadEmail(email: string) {
    const normalized = email.trim() || "jouch@hippo.com";
    try {
      await invoke("set_hypeddit_download_email", { email: normalized });
      setHypedditDownloadEmail(normalized);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveFallbackHeadless(headless: boolean) {
    try {
      await invoke("set_soundcloud_fallback_headless", { headless });
      setDebugSettings((current) => ({ ...current, soundcloud_fallback_headless: headless }));
    } catch (error) {
      setStatus(`${t("statusDebugSaveError")}: ${String(error)}`);
    }
  }

  async function saveLogsEnabled(enabled: boolean) {
    try {
      await invoke("set_logs_enabled", { enabled });
      setDebugSettings((current) => ({ ...current, logs_enabled: enabled }));
    } catch (error) {
      setStatus(`${t("statusDebugSaveError")}: ${String(error)}`);
    }
  }

  async function savePlaylistCoverMode(mode: PlaylistCoverMode) {
    try {
      setSavingPlaylistCoverMode(true);
      await invoke("set_playlist_cover_mode", { mode });
      setPlaylistCoverMode(mode);

      // Re-sync so playlist artworks reflect the selected cover strategy immediately.
      if (configStatus?.connected) {
        const items = await invoke<Playlist[]>("sync_soundcloud_playlists");
        applyPlaylistsSnapshot(items, false);
      }
      setStatus(t("statusPlaylistCoverModeSaved"));
    } catch (error) {
      setStatus(`${t("statusPlaylistCoverModeError")}: ${String(error)}`);
    } finally {
      setSavingPlaylistCoverMode(false);
    }
  }

  async function connectSoundCloud() {
    setStatus("");
    setConnecting(true);

    try {
      const start = await invoke<AuthStartPayload>("start_soundcloud_auth");
      await openUrl(start.auth_url);
      setStatus(t("statusAuthWindowSoundcloud"));

      const items = await invoke<Playlist[]>("complete_soundcloud_auth", {
        expectedState: start.state,
      });

      applyPlaylistsSnapshot(items, true);
      await loadConfigStatus();
      setActiveView("playlists");
      setStatus(t("statusAuthSoundcloudOk"));
    } catch (error) {
      setStatus(`${t("statusAuthError")}: ${String(error)}`);
    } finally {
      setConnecting(false);
    }
  }

  async function connectSpotify() {
    setStatus("");
    setConnectingSpotify(true);

    try {
      const start = await invoke<AuthStartPayload>("start_spotify_auth");
      const codeVerifier = start.code_verifier?.trim();
      if (!codeVerifier) {
        throw new Error("PKCE verifier manquant");
      }

      await openUrl(start.auth_url);
      setStatus(t("statusAuthWindowSpotify"));

      await invoke("complete_spotify_auth", {
        expectedState: start.state,
        codeVerifier,
      });

      await loadSpotifyStatus();
      setStatus(t("statusAuthSpotifyOk"));
    } catch (error) {
      setStatus(`${t("statusAuthSpotifyError")}: ${String(error)}`);
    } finally {
      setConnectingSpotify(false);
    }
  }

  async function openPlaylistDetails(playlistId: number) {
    setStatus("");
    const cached = playlistDetailsCacheRef.current.get(playlistId);

    if (cached) {
      setSelectedPlaylistDetailsWithCache(cached.details);
      setSelectedTrackInfo(null);
      await loadPlaylistLocalFolderAssociation(playlistId);
      return;
    }

    try {
      const details = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId,
        headless: debugSettings.soundcloud_fallback_headless,
      });
      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo(null);
      await loadPlaylistLocalFolderAssociation(playlistId);
    } catch (error) {
      const errorMessage = String(error);
      setSelectedPlaylistDetails(null);

      if (/\b401\b/.test(errorMessage) || /unauthorized/i.test(errorMessage)) {
        setGlobalPopupMessage(t("popupSessionExpired"));
        setStatus(t("statusSessionExpired"));
        return;
      }

      setStatus(`${t("statusPlaylistError")}: ${errorMessage}`);
    }
  }

  function closePlaylistDetails() {
    setSelectedPlaylistDetails(null);
    setSelectedTrackInfo(null);
    setPlaylistFolderPath("");
    setPlaylistFolderAvailable(true);
    setIsFilterMenuOpen(false);
    setTrackSortOrder("original");
    setDownloadSourceFilter("all");
    setLocalDownloadFilter("all");
    setTrackViewMode("list");
  }

  async function loadPlaylistLocalFolderAssociation(playlistId: number) {
    setLoadingPlaylistFolder(true);
    try {
      const association = await invoke<PlaylistLocalFolderAssociation>("get_playlist_local_folder_association", {
        playlistId,
      });
      setPlaylistFolderPath(association.folder_path ?? "");
      setPlaylistFolderAvailable(association.folder_available);

      if (association.folder_path && !association.folder_available) {
        setStatus(t("localFolderUnavailableStatus"));
      }
    } catch (error) {
      setStatus(`${t("statusPlaylistError")}: ${String(error)}`);
      setPlaylistFolderPath("");
      setPlaylistFolderAvailable(true);
    } finally {
      setLoadingPlaylistFolder(false);
    }
  }

  async function selectFolderAndScan() {
    if (!selectedPlaylistDetails) {
      return;
    }

    try {
      const selected = await openDialog({
        directory: true,
        multiple: false,
        defaultPath: playlistFolderPath.trim() || undefined,
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setPlaylistFolderPath(selected);
      setPlaylistFolderAvailable(true);
      setScanningLocalFiles(true);
      setStatus(t("localScanRunning"));

      const result = await invoke<PlaylistLocalScanResult>("scan_playlist_local_files", {
        playlistId: selectedPlaylistDetails.id,
        folderPath: selected,
      });

      setPlaylistFolderPath(result.folder_path);
      setPlaylistFolderAvailable(true);
      setStatus(
        `${t("localScanDone")}: ${result.matched_files}/${result.scanned_files} ${t("localScanMatched")}`,
      );

      const details = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId: selectedPlaylistDetails.id,
        headless: debugSettings.soundcloud_fallback_headless,
      });
      const linkedTracks = details.tracks.filter((track) => Boolean(track.local_file)).length;
      setStatus(
        `${t("localScanDone")}: ${linkedTracks}/${details.track_count} ${t("localTracksLinked")} (${result.matched_files}/${result.scanned_files} ${t("localScanMatched")})`,
      );
      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo((current) => {
        if (!current) {
          return null;
        }
        return details.tracks.find((track) => track.id === current.id) ?? null;
      });
    } catch (error) {
      setStatus(`${t("localScanError")}: ${String(error)}`);
    } finally {
      setScanningLocalFiles(false);
    }
  }

  async function dissociateFolder() {
    if (!selectedPlaylistDetails) {
      return;
    }

    try {
      await invoke("dissociate_playlist_local_folder", { playlistId: selectedPlaylistDetails.id });
      setPlaylistFolderPath("");
      setPlaylistFolderAvailable(true);
      setAudioQualityFilter("all");
      setIsActionsMenuOpen(false);
      setConfirmGlobalAudioAnalysis(false);
      setOverwriteExistingGlobalAnalysis(false);
      setStatus(t("localUnlinkDone"));

      updateSelectedPlaylistDetailsWithCache((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          tracks: current.tracks.map((track) => ({ ...track, local_file: null })),
        };
      });

      setSelectedTrackInfo((current) => (current ? { ...current, local_file: null } : null));
    } catch (error) {
      setStatus(`${t("localUnlinkError")}: ${String(error)}`);
    }
  }

  async function associateLocalFileToSelectedTrack() {
    if (!selectedPlaylistDetails || !selectedTrackInfo) {
      return;
    }

    if (!selectedTrackInfo.permalink_url) {
      setStatus(t("localAssociateTrackMissingUrl"));
      return;
    }

    try {
      const selected = await openDialog({
        directory: false,
        multiple: false,
        defaultPath: playlistFolderPath.trim() || undefined,
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setAssociatingLocalFile(true);
      await invoke("associate_playlist_track_local_file", {
        playlistId: selectedPlaylistDetails.id,
        trackPermalinkUrl: selectedTrackInfo.permalink_url,
        filePath: selected,
      });

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });

      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo((current) => {
        if (!current) {
          return null;
        }
        return details.tracks.find((track) => track.id === current.id) ?? null;
      });
      setStatus(t("localAssociateDone"));
    } catch (error) {
      setStatus(`${t("localAssociateError")}: ${String(error)}`);
    } finally {
      setAssociatingLocalFile(false);
    }
  }

  async function dissociateLocalFileFromSelectedTrack() {
    if (!selectedPlaylistDetails || !selectedTrackInfo?.permalink_url) {
      return;
    }

    try {
      setDissociatingLocalFile(true);
      const trackId = selectedTrackInfo.id;
      await invoke("dissociate_playlist_track_local_file", {
        playlistId: selectedPlaylistDetails.id,
        trackPermalinkUrl: selectedTrackInfo.permalink_url,
      });

      updateSelectedPlaylistDetailsWithCache((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          tracks: current.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  local_file: null,
                }
              : track,
          ),
        };
      });

      setSelectedTrackInfo((current) => {
        if (!current || current.id !== trackId) {
          return current;
        }

        return {
          ...current,
          local_file: null,
        };
      });

      const previousPreviewPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = null;
      setSpectrogramPreview(null);
      setManualCutoffInputHz("");
      setLoadingSpectrogramPreview(false);
      await removeTemporaryPreview(previousPreviewPath);

      setStatus(t("localDissociateDone"));
    } catch (error) {
      setStatus(`${t("localDissociateError")}: ${String(error)}`);
    } finally {
      setDissociatingLocalFile(false);
    }
  }

  async function moveSelectedTrackToAnotherPlaylist() {
    if (!selectedPlaylistDetails || !selectedTrackInfo) {
      return;
    }

    if (targetPlaylistIdForMove === "") {
      setStatus(t("moveTrackNoTarget"));
      return;
    }

    try {
      setMovingTrackBetweenPlaylists(true);
      const targetPlaylistId = Number(targetPlaylistIdForMove);
      const result = await invoke<MovePlaylistTrackResult>("move_track_between_playlists", {
        sourcePlaylistId: selectedPlaylistDetails.id,
        targetPlaylistId,
        trackId: selectedTrackInfo.id,
        trackPermalinkUrl:
          selectedTrackInfo.permalink_url ??
          selectedTrackInfo.local_file?.matched_soundcloud_url ??
          null,
        localFilePath: selectedTrackInfo.local_file?.file_path ?? null,
        localFileName: selectedTrackInfo.local_file?.file_name ?? null,
      });

      const refreshedSourceDetails = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId: selectedPlaylistDetails.id,
        headless: debugSettings.soundcloud_fallback_headless,
      });
      setSelectedPlaylistDetailsWithCache(refreshedSourceDetails);

      // Refresh destination playlist cache too so the moved track appears immediately when opened.
      try {
        const refreshedTargetDetails = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
          playlistId: targetPlaylistId,
          headless: debugSettings.soundcloud_fallback_headless,
        });
        upsertPlaylistDetailsCache(refreshedTargetDetails);
      } catch {
        // If target refresh fails, avoid stale cache by forcing a fresh load on next open.
        playlistDetailsCacheRef.current.delete(targetPlaylistId);
      }

      setSelectedTrackInfo(null);
      await loadPlaylistLocalFolderAssociation(selectedPlaylistDetails.id);
      await syncPlaylists(true);

      if (result.moved_local_link) {
        const destination = result.moved_local_file_path?.trim();
        setStatus(
          destination
            ? `${t("moveTrackDoneWithLocal")} -> ${destination}`
            : t("moveTrackDoneWithLocal"),
        );
      } else if (playlistFolderPath) {
        setStatus(t("moveTrackDoneWithoutLocal"));
      } else {
        setStatus(t("moveTrackDone"));
      }
    } catch (error) {
      setStatus(`${t("moveTrackError")}: ${String(error)}`);
    } finally {
      setMovingTrackBetweenPlaylists(false);
    }
  }

  async function embedSelectedTrackCoverIntoLocalMp3() {
    if (!selectedPlaylistDetails || !selectedTrackInfo?.local_file?.file_path) {
      return;
    }

    const artworkUrl = resolvePanelArtworkUrl(selectedTrackInfo.artwork_url) ?? selectedTrackInfo.artwork_url;
    if (!artworkUrl) {
      setStatus(t("localEmbedCoverMissingArtwork"));
      return;
    }

    try {
      setEmbeddingLocalCover(true);
      await invoke("embed_local_mp3_cover", {
        filePath: selectedTrackInfo.local_file.file_path,
        artworkUrl,
      });

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });

      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo((current) => {
        if (!current) {
          return null;
        }
        return details.tracks.find((track) => track.id === current.id) ?? null;
      });

      setStatus(t("localEmbedCoverDone"));
    } catch (error) {
      setStatus(`${t("localEmbedCoverError")}: ${String(error)}`);
    } finally {
      setEmbeddingLocalCover(false);
    }
  }

  async function revealSelectedTrackLocalFileInExplorer() {
    const localFilePath = selectedTrackInfo?.local_file?.file_path;
    if (!localFilePath) {
      setStatus(t("localRevealFileMissingPath"));
      return;
    }

    try {
      await invoke("reveal_local_file_in_explorer", { filePath: localFilePath });
    } catch (error) {
      setStatus(`${t("localRevealFileError")}: ${String(error)}`);
    }
  }

  async function downloadSelectedTrackFromHypeddit() {
    if (!selectedPlaylistDetails || !selectedTrackInfo) {
      return;
    }

    if (!selectedTrackInfo.associated_url || getAssociatedSource(selectedTrackInfo.associated_url) !== "hypeddit") {
      setStatus(t("hypedditDownloadMissingLink"));
      return;
    }

    if (!selectedTrackInfo.permalink_url) {
      setStatus(t("localAssociateTrackMissingUrl"));
      return;
    }

    if (!hasAvailableLocalFolder) {
      setStatus(t("hypedditDownloadMissingFolder"));
      return;
    }

    try {
      setDownloadingFromHypeddit(true);
      setHypedditDownloadPhase("");
      const result = await invoke<HypedditDownloadResult>("download_hypeddit_track_to_local_folder", {
        playlistId: selectedPlaylistDetails.id,
        trackPermalinkUrl: selectedTrackInfo.permalink_url,
        trackTitle: selectedTrackInfo.title,
        hypedditUrl: selectedTrackInfo.associated_url,
        artworkUrl: resolvePanelArtworkUrl(selectedTrackInfo.artwork_url) ?? selectedTrackInfo.artwork_url ?? null,
        overwriteExisting: overwriteExistingHypedditDownload,
        existingFilePath: selectedTrackInfo.local_file?.file_path ?? null,
      });

      const downloadedLocalFile: LocalAudioFileInfo = {
        file_path: result.file_path,
        file_name: result.file_name,
        matched_soundcloud_url: selectedTrackInfo.permalink_url,
      };

      await new Promise((resolve) => {
        window.setTimeout(resolve, 500);
      });

      const hydratedLocalFile = await invoke<LocalAudioFileInfo | null>("get_playlist_track_local_file_info", {
        playlistId: selectedPlaylistDetails.id,
        trackPermalinkUrl: selectedTrackInfo.permalink_url,
      });

      const localFileForUi = hydratedLocalFile ?? downloadedLocalFile;

      updateSelectedPlaylistDetailsWithCache((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          tracks: current.tracks.map((track) =>
            track.id === selectedTrackInfo.id
              ? {
                  ...track,
                  local_file: localFileForUi,
                }
              : track,
          ),
        };
      });

      setSelectedTrackInfo((current) => {
        if (!current || current.id !== selectedTrackInfo.id) {
          return current;
        }

        return {
          ...current,
          local_file: localFileForUi,
        };
      });

      setShowHypedditDownloadMenu(false);
      setOverwriteExistingHypedditDownload(false);
      setStatus(
        result.overwrote_existing
          ? `${t("hypedditDownloadDoneOverwrite")}: ${result.file_path}`
          : `${t("hypedditDownloadDone")}: ${result.file_path}`,
      );
    } catch (error) {
      setStatus(`${t("hypedditDownloadError")}: ${String(error)}`);
    } finally {
      setDownloadingFromHypeddit(false);
      setHypedditDownloadPhase("");
    }
  }

  async function refreshSelectedPlaylistDetails() {
    if (!selectedPlaylistDetails) {
      return;
    }

    try {
      setRefreshingPlaylistDetails(true);
      const details = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId: selectedPlaylistDetails.id,
        headless: debugSettings.soundcloud_fallback_headless,
      });

      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo((current) => {
        if (!current) {
          return null;
        }
        return details.tracks.find((track) => track.id === current.id) ?? null;
      });

      await loadPlaylistLocalFolderAssociation(details.id);
      setIsActionsMenuOpen(false);
      setConfirmGlobalAudioAnalysis(false);
      setOverwriteExistingGlobalAnalysis(false);
      setStatus(t("statusPlaylistRefreshOk"));
    } catch (error) {
      const errorMessage = String(error);
      if (/\b401\b/.test(errorMessage) || /unauthorized/i.test(errorMessage)) {
        setGlobalPopupMessage(t("popupSessionExpired"));
        setStatus(t("statusSessionExpired"));
        return;
      }

      setStatus(`${t("statusPlaylistError")}: ${errorMessage}`);
    } finally {
      setRefreshingPlaylistDetails(false);
    }
  }

  async function exportSelectedTrackSpectrogram() {
    if (!selectedTrackInfo?.local_file?.file_path) {
      return;
    }

    const sourcePath = selectedTrackInfo.local_file.file_path;
    const defaultName = selectedTrackInfo.local_file.file_name
      ? `${selectedTrackInfo.local_file.file_name.replace(/\.[^.]+$/, "")}-spectrogram.jpg`
      : "spectrogram.jpg";

    try {
      const selectedOutputPath = await saveDialog({
        title: t("localSpectrogramSaveTitle"),
        defaultPath: defaultName,
        filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
      });

      if (!selectedOutputPath || Array.isArray(selectedOutputPath)) {
        return;
      }

      setExportingSpectrogram(true);

      const result = await invoke<{ output_path: string; estimated_cutoff_hz?: number | null }>("export_local_spectrogram_jpg", {
        filePath: sourcePath,
        outputPath: selectedOutputPath,
        analysisScope: spectrogramAnalysisScope,
      });

      const cutoffLabel =
        result.estimated_cutoff_hz && result.estimated_cutoff_hz > 0
          ? ` • ${t("localSpectrogramCutoffLabel")}: ${(result.estimated_cutoff_hz / 1000).toFixed(1)} kHz`
          : "";

      setStatus(`${t("localSpectrogramExportDone")}: ${result.output_path}${cutoffLabel}`);
    } catch (error) {
      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
    } finally {
      setExportingSpectrogram(false);
    }
  }

  function clearTrackFilters() {
    setTrackSortOrder("original");
    setDownloadSourceFilter("all");
    setLocalDownloadFilter("all");
    setAudioQualityFilter("all");
  }

  async function confirmAndRunGlobalPlaylistAudioAnalysis() {
    if (!selectedPlaylistDetails) {
      return;
    }

    try {
      setRunningGlobalAudioAnalysis(true);
      setConfirmGlobalAudioAnalysis(false);
      setOverwriteExistingGlobalAnalysis(false);
      setStatus(t("globalAudioAnalysisRunning"));

      const result = await invoke<PlaylistGlobalAudioAnalysisResult>("analyze_playlist_local_audio_quality", {
        playlistId: selectedPlaylistDetails.id,
        analysisScope: spectrogramAnalysisScope,
        overwriteExisting: overwriteExistingGlobalAnalysis,
      });

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });
      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackInfo((current) => {
        if (!current) {
          return null;
        }
        return details.tracks.find((track) => track.id === current.id) ?? null;
      });

      setStatus(
        `${t("globalAudioAnalysisDone")}: ${result.updated_tracks}/${result.analyzed_tracks} ${t("globalAudioAnalysisUpdated")} • ${result.skipped_tracks} ${t("globalAudioAnalysisSkipped")} • ${result.failed_tracks} ${t("globalAudioAnalysisFailed")}`,
      );
    } catch (error) {
      setStatus(`${t("globalAudioAnalysisError")}: ${String(error)}`);
    } finally {
      setRunningGlobalAudioAnalysis(false);
    }
  }

  function getAssociatedSource(url?: string | null) {
    if (!url) {
      return null;
    }

    try {
      const hostname = new URL(url).hostname.toLowerCase();
      if (hostname.includes("hypeddit")) {
        return "hypeddit";
      }
      if (hostname.includes("bandcamp")) {
        return "bandcamp";
      }
      return "other";
    } catch {
      return null;
    }
  }

  function getFilteredTracks(tracks: PlaylistTrack[]) {
    const filtered = tracks.filter((track) => {
      if (downloadSourceFilter === "downloadable" && !track.associated_url) {
        return false;
      }
      if (downloadSourceFilter === "hypeddit" && getAssociatedSource(track.associated_url) !== "hypeddit") {
        return false;
      }
      if (downloadSourceFilter === "bandcamp" && getAssociatedSource(track.associated_url) !== "bandcamp") {
        return false;
      }

      if (playlistFolderPath) {
        if (localDownloadFilter === "downloaded" && !track.local_file) {
          return false;
        }
        if (localDownloadFilter === "notDownloaded" && track.local_file) {
          return false;
        }
      }

      if (playlistFolderPath && audioQualityFilter !== "all") {
        const quality = (track.local_file?.local_quality_label ?? "").toLowerCase();
        if (audioQualityFilter === "unknown") {
          if (quality === "high" || quality === "good" || quality === "medium" || quality === "low") {
            return false;
          }
        } else if (quality !== audioQualityFilter) {
          return false;
        }
      }

      return true;
    });

    if (trackSortOrder === "alphabetical") {
      return [...filtered].sort((left, right) =>
        left.title.localeCompare(right.title, language === "fr" ? "fr" : "en", { sensitivity: "base" }),
      );
    }

    if (trackSortOrder === "mostPlayed") {
      return [...filtered].sort((left, right) => (right.playback_count ?? -1) - (left.playback_count ?? -1));
    }

    return filtered;
  }

  const hasActiveTrackFilters =
    downloadSourceFilter !== "all" ||
    trackSortOrder !== "original" ||
    (playlistFolderPath ? localDownloadFilter !== "all" : false) ||
    (playlistFolderPath ? audioQualityFilter !== "all" : false);
  const activeFilterCount =
    (downloadSourceFilter !== "all" ? 1 : 0) +
    (trackSortOrder !== "original" ? 1 : 0) +
    (playlistFolderPath && localDownloadFilter !== "all" ? 1 : 0) +
    (playlistFolderPath && audioQualityFilter !== "all" ? 1 : 0);

  function formatDuration(durationMs?: number | null) {
    if (!durationMs || durationMs <= 0) {
      return "--:--";
    }

    const totalSeconds = Math.floor(durationMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  }

  function formatCount(value?: number | null) {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "—";
    }

    return new Intl.NumberFormat(language === "fr" ? "fr-FR" : "en-US").format(value);
  }

  function formatDate(value?: string | null) {
    if (!value) {
      return "—";
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return value;
    }

    return parsed.toLocaleDateString(language === "fr" ? "fr-FR" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  function formatFileSize(value?: number | null) {
    if (!value || value <= 0) {
      return "—";
    }

    const units = ["B", "KB", "MB", "GB"];
    let size = value;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }

    const formatted = size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1);
    return `${formatted} ${units[unitIndex]}`;
  }

  function formatDurationFromSeconds(value?: number | null) {
    if (!value || value <= 0) {
      return "--:--";
    }

    return formatDuration(value * 1000);
  }

  function formatFrequency(value?: number | null) {
    if (!value || value <= 0) {
      return "—";
    }

    const rounded = Math.round(value / 100) * 100;
    return `${formatCount(rounded)} Hz`;
  }

  function formatBitrate(value?: number | null) {
    if (!value || value <= 0) {
      return "—";
    }

    return `${formatCount(value)} kbps`;
  }

  function formatQuality(value?: string | null) {
    switch ((value ?? "").toLowerCase()) {
      case "high":
        return t("localQualityHigh");
      case "good":
        return t("localQualityGood");
      case "medium":
        return t("localQualityMedium");
      case "low":
        return t("localQualityLow");
      default:
        return "—";
    }
  }

  function formatText(value?: string | null) {
    if (!value || !value.trim()) {
      return "—";
    }

    return value;
  }

  function formatEstimatedDuration(seconds: number) {
    if (seconds < 60) {
      return `${seconds}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (remainingSeconds === 0) {
      return `${minutes} min`;
    }

    return `${minutes} min ${remainingSeconds}s`;
  }

  function resolvePanelArtworkUrl(artworkUrl?: string | null) {
    if (!artworkUrl) {
      return null;
    }

    if (panelCoverQuality === "original") {
      return artworkUrl;
    }

    if (artworkUrl.includes("-large.")) {
      return artworkUrl.replace("-large.", `-${panelCoverQuality}.`);
    }

    return artworkUrl;
  }

  function getAssociatedDestinationLabel(url?: string | null) {
    if (!url) {
      return null;
    }

    try {
      const hostname = new URL(url).hostname.toLowerCase();

      if (hostname.includes("hypeddit")) {
        return "Hypeddit";
      }
      if (hostname.includes("bandcamp")) {
        return "Bandcamp";
      }
      if (hostname.includes("spotify")) {
        return "Spotify";
      }
      if (hostname.includes("youtube") || hostname.includes("youtu.be")) {
        return "YouTube";
      }
      if (hostname.includes("apple.com") || hostname.includes("music.apple")) {
        return "Apple Music";
      }

      return hostname.replace(/^www\./, "");
    } catch {
      return t("associatedLinkFallback");
    }
  }

  function getAssociatedButtonLabel(url?: string | null) {
    const destination = getAssociatedDestinationLabel(url);
    if (!destination) {
      return t("openAssociatedFallback");
    }

    return `${t("openAssociatedOn")} ${destination}`;
  }

  function openTrackInfo(track: PlaylistTrack) {
    setSelectedTrackInfo((current) => {
      if (current?.id === track.id) {
        return null;
      }

      return track;
    });
  }

  const filteredTracks = selectedPlaylistDetails ? getFilteredTracks(selectedPlaylistDetails.tracks) : [];
  const hasAvailableLocalFolder = Boolean(playlistFolderPath.trim()) && playlistFolderAvailable;
  const canDownloadSelectedTrackFromHypeddit =
    hasAvailableLocalFolder &&
    Boolean(selectedTrackInfo?.associated_url) &&
    getAssociatedSource(selectedTrackInfo?.associated_url) === "hypeddit" &&
    Boolean(selectedTrackInfo?.permalink_url);
  const availableMoveTargetPlaylists = selectedPlaylistDetails
    ? playlists.filter(
      (playlist) =>
        playlist.id !== selectedPlaylistDetails.id &&
        playlist.has_local_folder === hasAvailableLocalFolder,
    )
    : [];
  const analyzableTracksCount = selectedPlaylistDetails
    ? selectedPlaylistDetails.tracks.filter((track) => Boolean(track.local_file)).length
    : 0;
  const estimatedGlobalAnalysisSeconds = analyzableTracksCount * 7;

  return (
    <main className="app">
      <header className="header">
        <h1>Glazer — SoundCloud</h1>
        <div className="tabs">
          <button
            className={activeView === "playlists" ? "tab tab-active" : "tab"}
            onClick={() => setActiveView("playlists")}
            type="button"
          >
            {t("tabPlaylists")}
          </button>
          <button
            className={activeView === "settings" ? "tab tab-active" : "tab"}
            onClick={() => setActiveView("settings")}
            type="button"
          >
            {t("tabSettings")}
          </button>
        </div>
      </header>

      {activeView === "playlists" ? (
        <section className="card" ref={(element) => { cardScrollRef.current = element; }}>
          {!selectedPlaylistDetails ? (
            <>
              <div className="section-head">
                <h2>{t("myPlaylists")}</h2>
                <div className="actions">
                  <button type="button" onClick={() => { void syncPlaylists(); }}>
                    {t("refresh")}
                  </button>
                </div>
              </div>

              {loadingPlaylists ? <p>{t("loading")}</p> : null}

              {!loadingPlaylists && playlists.length === 0 ? (
                <p>{t("noPlaylistFound")}</p>
              ) : null}

              <ul className="playlist-list">
                {playlists.map((playlist) => (
                  <li
                    key={playlist.id}
                    className="playlist-item"
                    onClick={() => openPlaylistDetails(playlist.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openPlaylistDetails(playlist.id);
                      }
                    }}
                  >
                    <div className="playlist-main">
                      {playlist.artwork_url ? (
                        <img src={playlist.artwork_url} alt={playlist.title} className="playlist-cover" />
                      ) : (
                        <div className="playlist-cover placeholder">SC</div>
                      )}
                      <div className="playlist-text">
                        <div className="playlist-title-row">
                          <strong>{playlist.title}</strong>
                        </div>
                        <p className="playlist-meta">{playlist.track_count} {t("tracksUnit")}</p>
                      </div>
                    </div>
                    <div className="playlist-badges">
                      <span className={playlist.is_private ? "badge private" : "badge public"}>
                        {playlist.is_private ? t("private") : t("public")}
                      </span>
                      {playlist.has_local_link ? (
                        <span className="badge local" title={t("playlistLocalLinked")}>
                          {t("localBadgeShort")}
                        </span>
                      ) : null}
                    </div>
                    <span className="playlist-action" aria-label={t("openPlaylist")}>
                      <span className="playlist-arrow">›</span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className={selectedTrackInfo ? "tracks-layout with-panel" : "tracks-layout"}>
              <section className="tracks-column">
              <div className="local-folder-association">
                <div className="local-folder-meta">
                  <label>
                    {playlistFolderPath ? t("localFolderLabel") : t("localNoFolderLabel")}
                  </label>
                  {playlistFolderPath ? <p className="local-folder-path">{playlistFolderPath}</p> : null}
                  {playlistFolderPath && !playlistFolderAvailable ? (
                    <div className="local-folder-warning-row">
                      <p className="local-folder-warning">{t("localFolderUnavailable")}</p>
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPlaylistDetails) {
                            void loadPlaylistLocalFolderAssociation(selectedPlaylistDetails.id);
                          }
                        }}
                        disabled={loadingPlaylistFolder}
                      >
                        {t("refresh")}
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={closePlaylistDetails}
                >
                  {t("back")}
                </button>
              </div>

              <div className="section-head">
                <div className="section-head-main">
                  <h2>{selectedPlaylistDetails.title}</h2>
                  <p className="playlist-title-meta-inline">
                    {filteredTracks.length}/{selectedPlaylistDetails.track_count} {t("tracksUnit")} • {selectedPlaylistDetails.is_private ? t("private") : t("public")}
                  </p>
                </div>
                <div className="section-head-controls" ref={sectionControlsRef}>
                  <button
                    type="button"
                    className="icon-toggle-btn"
                    aria-label={trackViewMode === "list" ? t("viewModeIcons") : t("viewModeList")}
                    title={trackViewMode === "list" ? t("viewModeIcons") : t("viewModeList")}
                    onClick={() => setTrackViewMode((current) => (current === "list" ? "icons" : "list"))}
                  >
                    {trackViewMode === "list" ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="3" y="3" width="7" height="7" rx="1.5" />
                        <rect x="14" y="3" width="7" height="7" rx="1.5" />
                        <rect x="3" y="14" width="7" height="7" rx="1.5" />
                        <rect x="14" y="14" width="7" height="7" rx="1.5" />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <rect x="4" y="5" width="16" height="3" rx="1.5" />
                        <rect x="4" y="10.5" width="16" height="3" rx="1.5" />
                        <rect x="4" y="16" width="16" height="3" rx="1.5" />
                      </svg>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsActionsMenuOpen(false);
                      setConfirmGlobalAudioAnalysis(false);
                      setOverwriteExistingGlobalAnalysis(false);
                      setIsFilterMenuOpen((current) => !current);
                    }}
                  >
                    {hasActiveTrackFilters ? `${t("filterButton")} (${activeFilterCount})` : t("filterButton")}
                  </button>
                  {selectedPlaylistDetails ? (
                    <button
                      type="button"
                      onClick={() => {
                        setIsFilterMenuOpen(false);
                        setConfirmGlobalAudioAnalysis(false);
                        setOverwriteExistingGlobalAnalysis(false);
                        setIsActionsMenuOpen((current) => !current);
                      }}
                    >
                      {t("actionsButton")}
                    </button>
                  ) : null}
                  {isFilterMenuOpen ? (
                    <div className="filter-menu">
                      <h4>{t("filtersTitle")}</h4>
                      <label className="filter-option filter-option-select">
                        <span>{t("sortOrderLabel")}</span>
                        <select
                          value={trackSortOrder}
                          onChange={(event) => setTrackSortOrder(event.currentTarget.value as TrackSortOrder)}
                        >
                          <option value="original">{t("sortOriginal")}</option>
                          <option value="alphabetical">{t("sortAlphabetical")}</option>
                          <option value="mostPlayed">{t("sortMostPlayed")}</option>
                        </select>
                      </label>

                      <label className="filter-option filter-option-select">
                        <span>{t("downloadFilterLabel")}</span>
                        <select
                          value={downloadSourceFilter}
                          onChange={(event) => setDownloadSourceFilter(event.currentTarget.value as DownloadSourceFilter)}
                        >
                          <option value="all">{t("downloadAll")}</option>
                          <option value="downloadable">{t("downloadAny")}</option>
                          <option value="hypeddit">{t("downloadHypeddit")}</option>
                          <option value="bandcamp">{t("downloadBandcamp")}</option>
                        </select>
                      </label>

                      {playlistFolderPath ? (
                        <label className="filter-option filter-option-select">
                          <span>{t("localDownloadFilterLabel")}</span>
                          <select
                            value={localDownloadFilter}
                            onChange={(event) => setLocalDownloadFilter(event.currentTarget.value as LocalDownloadFilter)}
                          >
                            <option value="all">{t("localDownloadAll")}</option>
                            <option value="downloaded">{t("localDownloadOnly")}</option>
                            <option value="notDownloaded">{t("localNotDownloadedOnly")}</option>
                          </select>
                        </label>
                      ) : null}

                      {playlistFolderPath ? (
                        <label className="filter-option filter-option-select">
                          <span>{t("audioQualityFilterLabel")}</span>
                          <select
                            value={audioQualityFilter}
                            onChange={(event) => setAudioQualityFilter(event.currentTarget.value as AudioQualityFilter)}
                          >
                            <option value="all">{t("audioQualityFilterAll")}</option>
                            <option value="high">{t("localQualityHigh")}</option>
                            <option value="good">{t("localQualityGood")}</option>
                            <option value="medium">{t("localQualityMedium")}</option>
                            <option value="low">{t("localQualityLow")}</option>
                            <option value="unknown">{t("audioQualityFilterUnknown")}</option>
                          </select>
                        </label>
                      ) : null}
                      <button type="button" className="filter-reset" onClick={clearTrackFilters}>
                        {t("clearFilters")}
                      </button>
                    </div>
                  ) : null}

                  {isActionsMenuOpen ? (
                    <div className="actions-menu">
                      <h4>{t("actionsTitle")}</h4>
                      <button
                        type="button"
                        className="filter-reset"
                        onClick={refreshSelectedPlaylistDetails}
                        disabled={refreshingPlaylistDetails || runningGlobalAudioAnalysis}
                      >
                        {refreshingPlaylistDetails ? t("playlistRefreshRunning") : t("playlistRefreshAction")}
                      </button>
                      {hasAvailableLocalFolder && !confirmGlobalAudioAnalysis ? (
                        <button
                          type="button"
                          className="filter-reset"
                          onClick={() => setConfirmGlobalAudioAnalysis(true)}
                          disabled={runningGlobalAudioAnalysis}
                        >
                          {runningGlobalAudioAnalysis ? t("globalAudioAnalysisRunning") : t("globalAudioAnalysisAction")}
                        </button>
                      ) : null}
                      {hasAvailableLocalFolder && confirmGlobalAudioAnalysis ? (
                        <>
                          <p className="actions-disclaimer">{t("globalAudioAnalysisDisclaimer")}</p>
                          <p className="actions-disclaimer">
                            {t("globalAudioAnalysisEstimatePrefix")} {formatCount(analyzableTracksCount)} {t("tracksUnit")} : {formatEstimatedDuration(estimatedGlobalAnalysisSeconds)}
                          </p>
                          <label className="setting-toggle actions-option">
                            <input
                              type="checkbox"
                              checked={overwriteExistingGlobalAnalysis}
                              onChange={(event) => setOverwriteExistingGlobalAnalysis(event.currentTarget.checked)}
                              disabled={runningGlobalAudioAnalysis}
                            />
                            <span>{t("globalAudioAnalysisOverwrite")}</span>
                          </label>
                          <div className="actions">
                            <button
                              type="button"
                              className="filter-reset"
                              onClick={confirmAndRunGlobalPlaylistAudioAnalysis}
                              disabled={runningGlobalAudioAnalysis}
                            >
                              {runningGlobalAudioAnalysis ? t("globalAudioAnalysisRunning") : t("globalAudioAnalysisConfirm")}
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setConfirmGlobalAudioAnalysis(false);
                                setOverwriteExistingGlobalAnalysis(false);
                              }}
                              disabled={runningGlobalAudioAnalysis}
                            >
                              {t("globalAudioAnalysisCancel")}
                            </button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="button"
                    onClick={playlistFolderPath ? dissociateFolder : selectFolderAndScan}
                    disabled={loadingPlaylistFolder || scanningLocalFiles}
                  >
                    {scanningLocalFiles
                      ? t("localScanRunning")
                      : playlistFolderPath
                        ? t("localUnlinkButton")
                        : t("localScanButton")}
                  </button>
                </div>
              </div>

              {selectedPlaylistDetails.tracks.length === 0 ? (
                <p>{t("noTrackInPlaylist")}</p>
              ) : null}

              {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length === 0 ? (
                <p>{t("noTrackAfterFilter")}</p>
              ) : null}

              {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length > 0 && trackViewMode === "list" ? (
                <ul className="track-list">
                  {filteredTracks.map((track) => (
                    <li
                      key={track.id}
                      className="track-item"
                      onClick={() => openTrackInfo(track)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          openTrackInfo(track);
                        }
                      }}
                    >
                      {track.artwork_url ? (
                        <img src={track.artwork_url} alt={track.title} className="track-cover" />
                      ) : (
                        <div className="track-cover placeholder">SC</div>
                      )}
                      <div className="track-main">
                        <strong>{track.title}</strong>
                        <p>{track.artist ?? t("unknownArtist")}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : null}

              {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length > 0 && trackViewMode === "icons" ? (
                <ul className="track-icon-grid">
                  {filteredTracks.map((track) => (
                    <li key={track.id} className="track-icon-item">
                      <button
                        type="button"
                        className="track-icon-btn"
                        onClick={() => openTrackInfo(track)}
                        title={track.title}
                        aria-label={track.title}
                      >
                        {track.artwork_url ? (
                          <img src={track.artwork_url} alt={track.title} className="track-icon-cover" />
                        ) : (
                          <div className="track-icon-cover placeholder">SC</div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              </section>

              {selectedTrackInfo ? (
              <aside className="track-panel open">
                  <div className="track-panel-content">
                    <section className="track-panel-actions-card">
                      <h3>{t("utilitiesTitle")}</h3>
                      <div className="panel-actions">
                        <button
                          type="button"
                          disabled={!selectedTrackInfo.permalink_url}
                          onClick={() => {
                            if (selectedTrackInfo.permalink_url) {
                              openUrl(selectedTrackInfo.permalink_url);
                            }
                          }}
                        >
                          {t("openOnSoundcloud")}
                        </button>

                        {selectedTrackInfo.associated_url ? (
                          <button
                            type="button"
                            onClick={() => {
                              const associatedUrl = selectedTrackInfo.associated_url;
                              if (associatedUrl) {
                                openUrl(associatedUrl);
                              }
                            }}
                          >
                            {getAssociatedButtonLabel(selectedTrackInfo.associated_url)}
                          </button>
                        ) : null}

                        {canDownloadSelectedTrackFromHypeddit ? (
                          <button
                            type="button"
                            onClick={() => {
                              setShowHypedditDownloadMenu((current) => !current);
                              if (showHypedditDownloadMenu) {
                                setOverwriteExistingHypedditDownload(false);
                              }
                            }}
                            disabled={downloadingFromHypeddit}
                          >
                            {downloadingFromHypeddit ? t("hypedditDownloadRunning") : t("hypedditDownloadButton")}
                          </button>
                        ) : null}

                        {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
                          <button
                            type="button"
                            onClick={revealSelectedTrackLocalFileInExplorer}
                          >
                            {t("localRevealFileButton")}
                          </button>
                        ) : null}

                        {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
                          <button
                            type="button"
                            onClick={embedSelectedTrackCoverIntoLocalMp3}
                            disabled={embeddingLocalCover}
                          >
                            {embeddingLocalCover ? t("localEmbedCoverRunning") : t("localEmbedCoverButton")}
                          </button>
                        ) : null}

                        {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
                          <button
                            type="button"
                            onClick={exportSelectedTrackSpectrogram}
                            disabled={exportingSpectrogram}
                          >
                            {exportingSpectrogram ? t("localSpectrogramExportRunning") : t("localSpectrogramExportButton")}
                          </button>
                        ) : null}

                        {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
                          <button
                            type="button"
                            onClick={dissociateLocalFileFromSelectedTrack}
                            disabled={dissociatingLocalFile}
                          >
                            {dissociatingLocalFile ? t("localDissociateRunning") : t("localDissociateButton")}
                          </button>
                        ) : null}
                      </div>

                      {canDownloadSelectedTrackFromHypeddit && showHypedditDownloadMenu ? (
                        <div className="panel-actions hypeddit-download-menu">
                          {selectedTrackInfo.local_file ? (
                            <label className="setting-toggle actions-option">
                              <input
                                type="checkbox"
                                checked={overwriteExistingHypedditDownload}
                                onChange={(event) => setOverwriteExistingHypedditDownload(event.currentTarget.checked)}
                                disabled={downloadingFromHypeddit}
                              />
                              <span>{t("hypedditDownloadOverwriteLabel")}</span>
                            </label>
                          ) : null}
                          <button
                            type="button"
                            onClick={downloadSelectedTrackFromHypeddit}
                            disabled={!canDownloadSelectedTrackFromHypeddit || downloadingFromHypeddit}
                          >
                            {downloadingFromHypeddit ? t("hypedditDownloadRunning") : t("hypedditDownloadConfirm")}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setShowHypedditDownloadMenu(false);
                              setOverwriteExistingHypedditDownload(false);
                            }}
                            disabled={downloadingFromHypeddit}
                          >
                            {t("globalAudioAnalysisCancel")}
                          </button>
                          {downloadingFromHypeddit ? <p className="status">{getHypedditProgressLabel(hypedditDownloadPhase)}</p> : null}
                        </div>
                      ) : null}

                      {availableMoveTargetPlaylists.length > 0 ? (
                        <div className="panel-actions move-track-controls">
                          <select
                            value={targetPlaylistIdForMove}
                            onChange={(event) => setTargetPlaylistIdForMove(Number(event.currentTarget.value))}
                            aria-label={t("moveTrackToPlaylistLabel")}
                            disabled={movingTrackBetweenPlaylists}
                          >
                            {availableMoveTargetPlaylists.map((playlist) => (
                              <option key={playlist.id} value={playlist.id}>
                                {playlist.title}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={moveSelectedTrackToAnotherPlaylist}
                            disabled={movingTrackBetweenPlaylists || targetPlaylistIdForMove === ""}
                          >
                            {movingTrackBetweenPlaylists ? t("moveTrackRunning") : t("moveTrackButton")}
                          </button>
                        </div>
                      ) : (
                        <p className="spectrogram-preview-meta">{t("moveTrackNoCompatibleTarget")}</p>
                      )}
                    </section>

                    {hasAvailableLocalFolder ? (
                      <section className="track-panel-actions-card">
                        <h3>{t("localSpectrogramPreviewTitle")}</h3>
                        <div className="panel-actions">
                          <button
                            type="button"
                            onClick={generateSpectrogramPreview}
                            disabled={!selectedTrackInfo.local_file || loadingSpectrogramPreview}
                          >
                            {loadingSpectrogramPreview ? t("localSpectrogramPreviewLoading") : t("localSpectrogramPreviewLoadButton")}
                          </button>
                          <input
                            type="number"
                            min={1}
                            step={100}
                            value={manualCutoffInputHz}
                            onChange={(event) => setManualCutoffInputHz(event.currentTarget.value)}
                            placeholder={t("localSpectrogramManualPlaceholder")}
                            aria-label={t("localSpectrogramManualLabel")}
                          />
                          <button
                            type="button"
                            onClick={saveManualCutoff}
                            disabled={!selectedTrackInfo.local_file || savingManualCutoff}
                          >
                            {savingManualCutoff ? t("localSpectrogramManualSaving") : t("localSpectrogramManualApply")}
                          </button>
                        </div>
                        {!loadingSpectrogramPreview && spectrogramPreview ? (
                          <>
                            <img src={spectrogramPreview.image_data_url} alt="Spectrogram preview" className="spectrogram-preview-image" />
                            <p className="spectrogram-preview-meta">
                              <strong>{t("localSpectrogramCutoffLabel")}:</strong>{" "}
                              {formatFrequency(spectrogramPreview.estimated_cutoff_hz ?? undefined)}
                            </p>
                            <p className="spectrogram-preview-meta">{t("localSpectrogramCutoffDisclaimer")}</p>
                          </>
                        ) : null}
                      </section>
                    ) : null}

                    <div className="track-panel-grid">
                      <section className="track-panel-section">
                        <div className="panel-head">
                          <h3>{t("trackInfos")}</h3>
                        </div>

                        {resolvePanelArtworkUrl(selectedTrackInfo.artwork_url) ? (
                          <img
                            src={resolvePanelArtworkUrl(selectedTrackInfo.artwork_url) ?? undefined}
                            alt={selectedTrackInfo.title}
                            className="panel-cover"
                          />
                        ) : (
                          <div className="panel-cover placeholder">SC</div>
                        )}

                        <div className="panel-details">
                          <p><strong>{t("titleLabel")}:</strong> {selectedTrackInfo.title}</p>
                          <p><strong>{t("artistLabel")}:</strong> {formatText(selectedTrackInfo.artist)}</p>
                          <p className="panel-duration-row"><strong>{t("durationLabel")}:</strong> {formatDuration(selectedTrackInfo.duration_ms)}</p>
                          <p><strong>{t("genreLabel")}:</strong> {formatText(selectedTrackInfo.genre)}</p>
                          <p><strong>{t("playsLabel")}:</strong> {formatCount(selectedTrackInfo.playback_count)}</p>
                          <p><strong>{t("releaseDateLabel")}:</strong> {formatDate(selectedTrackInfo.release_date ?? selectedTrackInfo.created_at)}</p>
                        </div>
                      </section>

                      {hasAvailableLocalFolder ? (
                        <section className="track-panel-section">
                          <div className="panel-head">
                            <h3>{t("localFileTitle")}</h3>
                          </div>
                          {selectedTrackInfo.local_file ? (
                            <>
                              {selectedTrackInfo.local_file.local_cover_data_url ? (
                                <img
                                  src={selectedTrackInfo.local_file.local_cover_data_url}
                                  alt={selectedTrackInfo.local_file.local_title ?? selectedTrackInfo.local_file.file_name}
                                  className="panel-cover"
                                />
                              ) : (
                                <div className="panel-cover placeholder">FILE</div>
                              )}

                              <div className="panel-details">
                                <p><strong>{t("titleLabel")}:</strong> {formatText(selectedTrackInfo.local_file.local_title ?? selectedTrackInfo.local_file.file_name)}</p>
                                <p><strong>{t("artistLabel")}:</strong> {formatText(selectedTrackInfo.local_file.local_artist)}</p>
                                <p className="panel-duration-row"><strong>{t("durationLabel")}:</strong> {formatDurationFromSeconds(selectedTrackInfo.local_file.local_duration_seconds)}</p>
                                <p><strong>{t("localFormatLabel")}:</strong> {formatText(selectedTrackInfo.local_file.local_format)}</p>
                                <p><strong>{t("localBitrateLabel")}:</strong> {formatBitrate(selectedTrackInfo.local_file.local_bitrate_kbps)}</p>
                                <p><strong>{t("localQualityLabel")}:</strong> {formatQuality(selectedTrackInfo.local_file.local_quality_label)}</p>
                                <p><strong>{t("localMaxFrequencyLabel")}:</strong> {formatFrequency(selectedTrackInfo.local_file.local_max_frequency_hz)}</p>
                                <p><strong>{t("localSampleRateLabel")}:</strong> {selectedTrackInfo.local_file.local_sample_rate_hz ? `${formatCount(selectedTrackInfo.local_file.local_sample_rate_hz)} Hz` : "—"}</p>
                                <p><strong>{t("localChannelsLabel")}:</strong> {formatCount(selectedTrackInfo.local_file.local_channels)}</p>
                                <p><strong>{t("fileSizeLabel")}:</strong> {formatFileSize(selectedTrackInfo.local_file.file_size_bytes)}</p>
                                <p><strong>{t("localFilePathLabel")}:</strong> {formatText(selectedTrackInfo.local_file.file_path)}</p>
                              </div>
                            </>
                          ) : (
                            <div className="panel-details">
                              <p>{t("localFilePlaceholder")}</p>
                              <button
                                type="button"
                                onClick={associateLocalFileToSelectedTrack}
                                disabled={associatingLocalFile}
                              >
                                {associatingLocalFile ? t("localAssociateRunning") : t("localAssociateButton")}
                              </button>
                            </div>
                          )}
                        </section>
                      ) : null}
                    </div>
                  </div>
              </aside>
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <section className="card" ref={(element) => { cardScrollRef.current = element; }}>
          <h2>{t("settingsTitle")}</h2>

          <h3>{t("interfaceTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={themeMode === "dark"}
              onChange={(event) => onThemeChange(event.currentTarget.checked ? "dark" : "light")}
            />
            <span>{t("darkModeEnabled")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("coverQualityLabel")}</span>
            <select
              value={panelCoverQuality}
              onChange={(event) => onPanelCoverQualityChange(event.currentTarget.value as CoverQuality)}
            >
              <option value="large">{t("qualityStandard")}</option>
              <option value="t300x300">{t("quality300")}</option>
              <option value="t500x500">{t("quality500")}</option>
              <option value="original">{t("qualityOriginal")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("languageLabel")}</span>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.currentTarget.value as Language)}
            >
              <option value="fr">{t("languageFrench")}</option>
              <option value="en">{t("languageEnglish")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("playlistCoverModeLabel")}</span>
            <select
              value={playlistCoverMode}
              onChange={(event) => savePlaylistCoverMode(event.currentTarget.value as PlaylistCoverMode)}
              disabled={savingPlaylistCoverMode}
            >
              <option value="first">{t("playlistCoverModeFirst")}</option>
              <option value="random">{t("playlistCoverModeRandom")}</option>
            </select>
          </label>
          <p className="playlist-cover-mode-hint">{t("playlistCoverModeHint")}</p>

          <h3>{t("analysisSettingsTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <span>{t("spectrogramScopeLabel")}</span>
            <select
              value={spectrogramAnalysisScope}
              onChange={(event) => onSpectrogramAnalysisScopeChange(event.currentTarget.value as SpectrogramAnalysisScope)}
            >
              <option value="quarter">{t("spectrogramScopeQuarter")}</option>
              <option value="half">{t("spectrogramScopeHalf")}</option>
              <option value="full">{t("spectrogramScopeFull")}</option>
            </select>
          </label>

          <h3>{t("downloadSettingsTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={downloadEmbedCover}
              onChange={(event) => saveDownloadEmbedCover(event.currentTarget.checked)}
            />
            <span>{t("downloadEmbedCoverSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={downloadRenameWithSoundcloudTitle}
              onChange={(event) => saveDownloadRenameWithSoundcloudTitle(event.currentTarget.checked)}
            />
            <span>{t("downloadRenameSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={hypedditDownloadHeadless}
              onChange={(event) => saveHypedditDownloadHeadless(event.currentTarget.checked)}
            />
            <span>{t("downloadHypedditHeadlessSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditCommentLabel")}</span>
            <input
              type="text"
              value={hypedditDownloadComment}
              placeholder={t("downloadHypedditCommentPlaceholder")}
              onChange={(event) => setHypedditDownloadComment(event.currentTarget.value)}
              onBlur={() => { void saveHypedditDownloadComment(hypedditDownloadComment); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveHypedditDownloadComment(hypedditDownloadComment);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditNameLabel")}</span>
            <input
              type="text"
              value={hypedditDownloadName}
              placeholder={t("downloadHypedditNamePlaceholder")}
              onChange={(event) => setHypedditDownloadName(event.currentTarget.value)}
              onBlur={() => { void saveHypedditDownloadName(hypedditDownloadName); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveHypedditDownloadName(hypedditDownloadName);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditEmailLabel")}</span>
            <input
              type="email"
              value={hypedditDownloadEmail}
              placeholder={t("downloadHypedditEmailPlaceholder")}
              onChange={(event) => setHypedditDownloadEmail(event.currentTarget.value)}
              onBlur={() => { void saveHypedditDownloadEmail(hypedditDownloadEmail); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void saveHypedditDownloadEmail(hypedditDownloadEmail);
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <h3>{t("connectionsTitle")}</h3>

          <div className="actions auth-actions">
            <button type="button" onClick={connectSoundCloud} disabled={connecting}>
              {connecting ? t("connectingSoundcloud") : t("connectSoundcloud")}
            </button>
            {configStatus?.connected ? <span className="badge public">{t("connected")}</span> : <span className="badge private">{t("notConnected")}</span>}
          </div>

          <div className="actions auth-actions">
            <button type="button" onClick={connectSpotify} disabled={connectingSpotify}>
              {connectingSpotify ? t("connectingSpotify") : t("connectSpotify")}
            </button>
            {spotifyStatus?.connected ? <span className="badge public">{t("connected")}</span> : <span className="badge private">{t("notConnected")}</span>}
          </div>

          <h3>{t("debugTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={debugSettings.soundcloud_fallback_headless}
              onChange={(event) => saveFallbackHeadless(event.currentTarget.checked)}
            />
            <span>{t("headlessEnabled")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={debugSettings.logs_enabled}
              onChange={(event) => saveLogsEnabled(event.currentTarget.checked)}
            />
            <span>{t("logsEnabled")}</span>
          </label>
        </section>
      )}

      {debugSettings.logs_enabled && status ? <p className="status">{status}</p> : null}

      {globalPopupMessage ? (
        <div className="global-popup" role="alert" aria-live="assertive">
          <p>{globalPopupMessage}</p>
          <button type="button" onClick={() => setGlobalPopupMessage(null)}>
            {t("close")}
          </button>
        </div>
      ) : null}
    </main>
  );
}

export default App;
