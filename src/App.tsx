import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { translations, type Language, type TranslationKey } from "./i18n";
import { PlaylistList } from "./components/PlaylistList";
import { PlaylistDetailsView } from "./components/PlaylistDetails";
import { SettingsView } from "./components/SettingsView";
import { TrackPanel } from "./components/TrackPanel";
import { useAsyncMap } from "./hooks/useAsyncMap";
import { useLocalFolder } from "./hooks/useLocalFolder";
import { usePlaylistDetails } from "./hooks/usePlaylistDetails";
import { usePlaylists } from "./hooks/usePlaylists";
import { useUnicodeSpinner } from "./hooks/useUnicodeSpinner";
import type {
  AudioQualityFilter,
  AuthStartPayload,
  CoverQuality,
  DebugSettings,
  DownloadSourceFilter,
  HypedditConversionFormat,
  HypedditDownloadProgressPayload,
  HypedditDownloadResult,
  LocalAnalysisUpdateResult,
  LocalAudioFileInfo,
  LocalDownloadFilter,
  MiscSettings,
  MovePlaylistTrackResult,
  Playlist,
  PlaylistCoverMode,
  PlaylistDetails,
  PlaylistGlobalAudioAnalysisResult,
  PlaylistLocalFolderAssociation,
  PlaylistLocalScanResult,
  PlaylistTrack,
  SoundCloudConfigStatus,
  SpectrogramAnalysisScope,
  SpectrogramPreviewResult,
  ThemeMode,
  TrackSortOrder,
  TrackViewMode,
  View,
} from "./types";
import "./App.css";

const ASYNC_KEYS = [
  "loadingPlaylists",
  "loadingPlaylistDetails",
  "connecting",
  "connectingSpotify",
  "connectingPlaywrightSoundcloud",
  "connectingPlaywrightSpotify",
  "savingPlaylistCoverMode",
  "loadingPlaylistFolder",
  "scanningLocalFiles",
  "associatingLocalFile",
  "dissociatingLocalFile",
  "embeddingLocalCover",
  "downloadingFromHypeddit",
  "downloadingCover",
  "exportingSpectrogram",
  "loadingSpectrogramPreview",
  "savingManualCutoff",
  "runningGlobalAudioAnalysis",
  "movingTrackBetweenPlaylists",
  "refreshingPlaylistDetails",
] as const;

function App() {
  const cardScrollRef = useRef<HTMLElement | null>(null);
  const sectionControlsRef = useRef<HTMLDivElement | null>(null);
  const [activeView, setActiveView] = useState<View>("playlists");
  const { playlists, setPlaylists } = usePlaylists();
  const {
    selectedPlaylistDetails,
    setSelectedPlaylistDetails,
    setSelectedPlaylistDetailsWithCache,
    updateSelectedPlaylistDetailsWithCache,
    selectedTrackId,
    setSelectedTrackId,
    selectedTrackInfo,
    playlistDetailsCacheRef,
  } = usePlaylistDetails();
  const {
    playlistFolderPath,
    setPlaylistFolderPath,
    playlistFolderAvailable,
    setPlaylistFolderAvailable,
    hasAvailableLocalFolder,
  } = useLocalFolder();
  const { state: asyncState, setAsyncState } = useAsyncMap(ASYNC_KEYS);
  const [configStatus, setConfigStatus] = useState<SoundCloudConfigStatus | null>(null);
  const [status, setStatus] = useState("");
  const [globalPopupMessage, setGlobalPopupMessage] = useState<string | null>(null);
  const [debugSettings, setDebugSettings] = useState<DebugSettings>({
    soundcloud_fallback_headless: true,
    logs_enabled: true,
  });
  const [playlistCoverMode, setPlaylistCoverMode] = useState<PlaylistCoverMode>("first");
  const [downloadEmbedCover, setDownloadEmbedCover] = useState(false);
  const [downloadRenameWithSoundcloudTitle, setDownloadRenameWithSoundcloudTitle] = useState(false);
  const [hypedditDownloadConversionFormat, setHypedditDownloadConversionFormat] = useState<HypedditConversionFormat>("original");
  const [analysisAutoApplyFrequencyMax, setAnalysisAutoApplyFrequencyMax] = useState(true);
  const [hypedditDownloadHeadless, setHypedditDownloadHeadless] = useState(true);
  const [hypedditDownloadStartTimeoutSeconds, setHypedditDownloadStartTimeoutSeconds] = useState(30);
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
  const [trackSearchQuery, setTrackSearchQuery] = useState("");
  const [trackViewMode, setTrackViewMode] = useState<TrackViewMode>("list");
  const [spectrogramAnalysisScope, setSpectrogramAnalysisScope] = useState<SpectrogramAnalysisScope>("half");
  const [hypedditDownloadPhase, setHypedditDownloadPhase] = useState("");
  const [overwriteExistingHypedditDownload, setOverwriteExistingHypedditDownload] = useState(false);
  const [confirmGlobalAudioAnalysis, setConfirmGlobalAudioAnalysis] = useState(false);
  const [overwriteExistingGlobalAnalysis, setOverwriteExistingGlobalAnalysis] = useState(false);
  const [manualCutoffInputHz, setManualCutoffInputHz] = useState("");
  const [spectrogramPreview, setSpectrogramPreview] = useState<SpectrogramPreviewResult | null>(null);
  const [targetPlaylistIdForMove, setTargetPlaylistIdForMove] = useState<number | "">("");
  const spectrogramPreviewTempPathRef = useRef<string | null>(null);
  const openTrackRequestRef = useRef(0);

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
      setSelectedTrackId(null);
    }

    if (clearSelectionWhenEmpty && items.length === 0) {
      setSelectedPlaylistDetails(null);
      setSelectedTrackId(null);
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

  function normalizeSoundCloudPermalink(url?: string | null) {
    const value = url?.trim();
    if (!value) {
      return null;
    }

    try {
      const parsed = new URL(value);
      const host = parsed.hostname.toLowerCase();
      if (!host.includes("soundcloud.com")) {
        return null;
      }
      parsed.search = "";
      parsed.hash = "";
      let normalized = parsed.toString();
      if (normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
      return normalized;
    } catch {
      return null;
    }
  }

  function mergeLocalFilesIntoDetails(previous: PlaylistDetails | null | undefined, next: PlaylistDetails) {
    if (!previous) {
      return next;
    }

    const byTrackId = new Map<number, LocalAudioFileInfo>();
    const byPermalink = new Map<string, LocalAudioFileInfo>();

    for (const track of previous.tracks) {
      if (!track.local_file) {
        continue;
      }
      byTrackId.set(track.id, track.local_file);
      const normalized = normalizeSoundCloudPermalink(track.permalink_url);
      if (normalized) {
        byPermalink.set(normalized, track.local_file);
      }
    }

    return {
      ...next,
      tracks: next.tracks.map((track) => {
        if (track.local_file) {
          return track;
        }

        const fromId = byTrackId.get(track.id);
        if (fromId) {
          return { ...track, local_file: fromId };
        }

        const normalized = normalizeSoundCloudPermalink(track.permalink_url);
        const fromPermalink = normalized ? byPermalink.get(normalized) : undefined;
        if (fromPermalink) {
          return { ...track, local_file: fromPermalink };
        }

        return track;
      }),
    };
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

    void loadInitialData();
    // Initial bootstrap is intentionally one-shot on app mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    cardScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [activeView, selectedPlaylistDetails?.id]);

  useEffect(() => {
    const previousPath = spectrogramPreviewTempPathRef.current;
    spectrogramPreviewTempPathRef.current = null;
    setSpectrogramPreview(null);
    setManualCutoffInputHz("");
    setAsyncState("loadingSpectrogramPreview", false);
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

    updateSelectedPlaylistDetailsWithCache((current) => {
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
  }

  async function saveManualCutoff() {
    const parsed = Number.parseInt(manualCutoffInputHz.trim(), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setStatus(t("localSpectrogramManualInvalid"));
      return;
    }

    try {
      setAsyncState("savingManualCutoff", true);
      await persistCutoffAnalysis(parsed);
      setStatus(`${t("localSpectrogramManualSaved")}: ${formatFrequency(parsed)}`);
    } catch (error) {
      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
    } finally {
      setAsyncState("savingManualCutoff", false);
    }
  }

  async function generateSpectrogramPreview() {
    const localFilePath = selectedTrackInfo?.local_file?.file_path;
    if (!localFilePath) {
      return;
    }

    setAsyncState("loadingSpectrogramPreview", true);

    try {
      const result = await invoke<SpectrogramPreviewResult>("generate_local_spectrogram_preview", {
        filePath: localFilePath,
        analysisScope: spectrogramAnalysisScope,
      });

      const previousPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = result.temp_path;
      setSpectrogramPreview(result);

      if (result.estimated_cutoff_hz && result.estimated_cutoff_hz > 0) {
        if (analysisAutoApplyFrequencyMax) {
          try {
            await persistCutoffAnalysis(result.estimated_cutoff_hz);
          } catch (persistError) {
            // Keep preview visible even if analysis persistence fails.
            setStatus(`${t("localSpectrogramExportError")}: ${String(persistError)}`);
          }
        }
        setManualCutoffInputHz(String(result.estimated_cutoff_hz));
      }

      if (previousPath && previousPath !== result.temp_path) {
        await removeTemporaryPreview(previousPath);
      }
    } catch (error) {
      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
    } finally {
      setAsyncState("loadingSpectrogramPreview", false);
    }
  }

  async function loadInitialData() {
    const [soundcloud] = await Promise.all([
      loadConfigStatus(),
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

  async function loadPlaylists() {
    setAsyncState("loadingPlaylists", true);
    try {
      const items = await invoke<Playlist[]>("get_playlists");
      applyPlaylistsSnapshot(items, true);
    } catch (error) {
      setStatus(`${t("statusPlaylistsError")}: ${String(error)}`);
    } finally {
      setAsyncState("loadingPlaylists", false);
    }
  }

  async function syncPlaylists(silent = false) {
    setAsyncState("loadingPlaylists", true);
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
      setAsyncState("loadingPlaylists", false);
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
      setHypedditDownloadConversionFormat(settings.hypeddit_download_conversion_format ?? "original");
      setAnalysisAutoApplyFrequencyMax(settings.analysis_auto_apply_frequency_max ?? true);
      setHypedditDownloadHeadless(settings.hypeddit_download_headless ?? true);
      setHypedditDownloadStartTimeoutSeconds(
        Math.min(300, Math.max(5, Math.round(settings.hypeddit_download_start_timeout_seconds ?? 30))),
      );
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

  async function saveHypedditDownloadConversionFormat(format: HypedditConversionFormat) {
    try {
      await invoke("set_hypeddit_download_conversion_format", { format });
      setHypedditDownloadConversionFormat(format);
      setStatus(t("statusDownloadSettingsSaved"));
    } catch (error) {
      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
    }
  }

  async function saveAnalysisAutoApplyFrequencyMax(enabled: boolean) {
    try {
      await invoke("set_analysis_auto_apply_frequency_max", { enabled });
      setAnalysisAutoApplyFrequencyMax(enabled);
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

  async function saveHypedditDownloadStartTimeoutSeconds(seconds: number) {
    const normalized = Number.isFinite(seconds)
      ? Math.min(300, Math.max(5, Math.round(seconds)))
      : 30;

    try {
      await invoke("set_hypeddit_download_start_timeout_seconds", { seconds: normalized });
      setHypedditDownloadStartTimeoutSeconds(normalized);
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
      setAsyncState("savingPlaylistCoverMode", true);
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
      setAsyncState("savingPlaylistCoverMode", false);
    }
  }

  async function connectSoundCloud() {
    setStatus("");
    setAsyncState("connecting", true);

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
      setAsyncState("connecting", false);
    }
  }

  async function disconnectSoundCloud() {
    setStatus("");
    setAsyncState("connecting", true);

    try {
      await invoke("disconnect_soundcloud");
      await loadConfigStatus();
      setStatus(t("statusAuthSoundcloudDisconnected"));
    } catch (error) {
      setStatus(`${t("statusAuthError")}: ${String(error)}`);
    } finally {
      setAsyncState("connecting", false);
    }
  }

  async function toggleSoundCloudConnection() {
    if (configStatus?.connected) {
      await disconnectSoundCloud();
      return;
    }

    await connectSoundCloud();
  }

  async function connectPlaywrightProfileSession(provider: "soundcloud" | "spotify") {
    const asyncKey =
      provider === "soundcloud"
        ? "connectingPlaywrightSoundcloud"
        : "connectingPlaywrightSpotify";

    setAsyncState(asyncKey, true);
    try {
      await invoke("connect_playwright_profile_session", { provider });
      setStatus(
        provider === "soundcloud"
          ? t("statusPlaywrightSessionSoundcloudReady")
          : t("statusPlaywrightSessionSpotifyReady"),
      );
    } catch (error) {
      setStatus(`${t("statusPlaywrightSessionError")}: ${String(error)}`);
    } finally {
      setAsyncState(asyncKey, false);
    }
  }

  async function openPlaylistDetails(playlistId: number) {
    setStatus("");
    setAsyncState("loadingPlaylistDetails", true);
    try {
      const cached = playlistDetailsCacheRef.current.get(playlistId);

      if (cached) {
        setSelectedPlaylistDetailsWithCache(cached.details);
        setSelectedTrackId(null);
        await loadPlaylistLocalFolderAssociation(playlistId);
        return;
      }

      const details = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId,
        headless: debugSettings.soundcloud_fallback_headless,
      });
      const mergedDetails = mergeLocalFilesIntoDetails(selectedPlaylistDetails, details);
      setSelectedPlaylistDetailsWithCache(mergedDetails);
      setSelectedTrackId(null);
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
    } finally {
      setAsyncState("loadingPlaylistDetails", false);
    }
  }

  function closePlaylistDetails() {
    setSelectedPlaylistDetails(null);
    setSelectedTrackId(null);
    setPlaylistFolderPath("");
    setPlaylistFolderAvailable(true);
    setIsFilterMenuOpen(false);
    setTrackSortOrder("original");
    setDownloadSourceFilter("all");
    setLocalDownloadFilter("all");
    setTrackSearchQuery("");
    setTrackViewMode("list");
  }

  async function loadPlaylistLocalFolderAssociation(playlistId: number) {
    setAsyncState("loadingPlaylistFolder", true);
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
      setAsyncState("loadingPlaylistFolder", false);
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
      setAsyncState("scanningLocalFiles", true);
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

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });
      const linkedTracks = details.tracks.filter((track) => Boolean(track.local_file)).length;
      setStatus(
        `${t("localScanDone")}: ${linkedTracks}/${details.track_count} ${t("localTracksLinked")} (${result.matched_files}/${result.scanned_files} ${t("localScanMatched")})`,
      );
      const mergedDetails = mergeLocalFilesIntoDetails(selectedPlaylistDetails, details);
      setSelectedPlaylistDetailsWithCache(mergedDetails);
      setSelectedTrackId((currentId) => {
        if (currentId === null) {
          return null;
        }
        return mergedDetails.tracks.some((track) => track.id === currentId) ? currentId : null;
      });
    } catch (error) {
      setStatus(`${t("localScanError")}: ${String(error)}`);
    } finally {
      setAsyncState("scanningLocalFiles", false);
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
        filters: [
          {
            name: "Audio",
            extensions: ["mp3", "wav", "aif", "aiff", "flac", "m4a", "ogg", "aac"],
          },
        ],
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      setAsyncState("associatingLocalFile", true);
      await invoke("associate_playlist_track_local_file", {
        playlistId: selectedPlaylistDetails.id,
        trackPermalinkUrl: selectedTrackInfo.permalink_url,
        filePath: selected,
      });

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });

      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackId((currentId) => {
        if (currentId === null) {
          return null;
        }
        return details.tracks.some((track) => track.id === currentId) ? currentId : null;
      });
      setStatus(t("localAssociateDone"));
    } catch (error) {
      setStatus(`${t("localAssociateError")}: ${String(error)}`);
    } finally {
      setAsyncState("associatingLocalFile", false);
    }
  }

  async function dissociateLocalFileFromSelectedTrack() {
    if (!selectedPlaylistDetails || !selectedTrackInfo?.permalink_url) {
      return;
    }

    try {
      setAsyncState("dissociatingLocalFile", true);
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

      const previousPreviewPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = null;
      setSpectrogramPreview(null);
      setManualCutoffInputHz("");
      setAsyncState("loadingSpectrogramPreview", false);
      await removeTemporaryPreview(previousPreviewPath);

      setStatus(t("localDissociateDone"));
    } catch (error) {
      setStatus(`${t("localDissociateError")}: ${String(error)}`);
    } finally {
      setAsyncState("dissociatingLocalFile", false);
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
      setAsyncState("movingTrackBetweenPlaylists", true);
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
      const mergedSourceDetails = mergeLocalFilesIntoDetails(selectedPlaylistDetails, refreshedSourceDetails);
      setSelectedPlaylistDetailsWithCache(mergedSourceDetails);

      // Refresh destination playlist cache too so the moved track appears immediately when opened.
      try {
        const refreshedTargetDetails = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
          playlistId: targetPlaylistId,
          headless: debugSettings.soundcloud_fallback_headless,
        });
        const previousTargetDetails = playlistDetailsCacheRef.current.get(targetPlaylistId)?.details;
        const mergedTargetDetails = mergeLocalFilesIntoDetails(previousTargetDetails, refreshedTargetDetails);
        playlistDetailsCacheRef.current.set(targetPlaylistId, {
          details: mergedTargetDetails,
          cached_at_ms: Date.now(),
        });
      } catch {
        // If target refresh fails, avoid stale cache by forcing a fresh load on next open.
        playlistDetailsCacheRef.current.delete(targetPlaylistId);
      }

      setSelectedTrackId(null);
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
      setAsyncState("movingTrackBetweenPlaylists", false);
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
      setAsyncState("embeddingLocalCover", true);
      await invoke("embed_local_mp3_cover", {
        filePath: selectedTrackInfo.local_file.file_path,
        artworkUrl,
      });

      const details = await invoke<PlaylistDetails>("get_playlist_details", {
        playlistId: selectedPlaylistDetails.id,
      });

      setSelectedPlaylistDetailsWithCache(details);
      setSelectedTrackId((currentId) => {
        if (currentId === null) {
          return null;
        }
        return details.tracks.some((track) => track.id === currentId) ? currentId : null;
      });

      setStatus(t("localEmbedCoverDone"));
    } catch (error) {
      setStatus(`${t("localEmbedCoverError")}: ${String(error)}`);
    } finally {
      setAsyncState("embeddingLocalCover", false);
    }
  }

  async function getHydratedLocalFileWithRetry(
    playlistId: number,
    trackPermalinkUrl: string,
    attempts = 5,
    delayMs = 200,
  ) {
    for (let index = 0; index < attempts; index += 1) {
      const hydratedLocalFile = await invoke<LocalAudioFileInfo | null>("get_playlist_track_local_file_info", {
        playlistId,
        trackPermalinkUrl,
      });

      if (hydratedLocalFile) {
        return hydratedLocalFile;
      }

      if (index < attempts - 1) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, delayMs);
        });
      }
    }

    return null;
  }

  async function ensureTrackLocalFileStillAvailable(targetTrack: PlaylistTrack) {
    const localFilePath = targetTrack.local_file?.file_path?.trim();
    if (!selectedPlaylistDetails || !localFilePath) {
      return true;
    }

    try {
      const exists = await invoke<boolean>("check_local_file_exists", { filePath: localFilePath });
      if (exists) {
        return true;
      }

      if (targetTrack.permalink_url) {
        try {
          await invoke("dissociate_playlist_track_local_file", {
            playlistId: selectedPlaylistDetails.id,
            trackPermalinkUrl: targetTrack.permalink_url,
          });
        } catch {
          // Keep going even if backend dissociation fails; UI is still updated below.
        }
      }

      updateSelectedPlaylistDetailsWithCache((current) => {
        if (!current) {
          return current;
        }

        return {
          ...current,
          tracks: current.tracks.map((trackItem) =>
            trackItem.id === targetTrack.id
              ? {
                  ...trackItem,
                  local_file: null,
                }
              : trackItem,
          ),
        };
      });

      const previousPreviewPath = spectrogramPreviewTempPathRef.current;
      spectrogramPreviewTempPathRef.current = null;
      setSpectrogramPreview(null);
      setManualCutoffInputHz("");
      setAsyncState("loadingSpectrogramPreview", false);
      void removeTemporaryPreview(previousPreviewPath);

      setOverwriteExistingHypedditDownload(false);

      const message = t("localFileMissingPopup");
      setStatus(message);
      setGlobalPopupMessage(message);
      return false;
    } catch (error) {
      setStatus(`${t("localFileCheckError")}: ${String(error)}`);
      return false;
    }
  }

  async function ensureSelectedTrackLocalFileStillAvailable() {
    const currentTrack = selectedTrackInfo;
    if (!currentTrack) {
      return false;
    }

    return ensureTrackLocalFileStillAvailable(currentTrack);
  }

  async function runSelectedLocalFileUtility(
    action: () => Promise<void>,
    missingPathStatusKey: TranslationKey,
  ) {
    const localFilePath = selectedTrackInfo?.local_file?.file_path?.trim();
    if (!localFilePath) {
      setStatus(t(missingPathStatusKey));
      return;
    }

    const localFileStillAvailable = await ensureSelectedTrackLocalFileStillAvailable();
    if (!localFileStillAvailable) {
      return;
    }

    await action();
  }

  async function prepareHypedditDownloadModal() {
    const localFilePath = selectedTrackInfo?.local_file?.file_path?.trim();
    if (!localFilePath) {
      return false;
    }

    return ensureSelectedTrackLocalFileStillAvailable();
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
      setAsyncState("downloadingFromHypeddit", true);
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

      const hydratedLocalFile = await getHydratedLocalFileWithRetry(
        selectedPlaylistDetails.id,
        selectedTrackInfo.permalink_url,
      );

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

      setOverwriteExistingHypedditDownload(false);
      setStatus(
        result.overwrote_existing
          ? `${t("hypedditDownloadDoneOverwrite")}: ${result.file_path}`
          : `${t("hypedditDownloadDone")}: ${result.file_path}`,
      );
    } catch (error) {
      setStatus(`${t("hypedditDownloadError")}: ${String(error)}`);
    } finally {
      setAsyncState("downloadingFromHypeddit", false);
      setHypedditDownloadPhase("");
    }
  }

  function sanitizeCoverFileStem(input: string) {
    const trimmed = input.trim();
    if (!trimmed) {
      return "track";
    }

    const sanitized = trimmed
      .replace(/[<>:"/\\|?*]+/g, "_")
      .replace(/\s+/g, " ")
      .trim();

    return sanitized || "track";
  }

  async function downloadSelectedTrackCover() {
    if (!selectedTrackInfo) {
      return;
    }

    const artworkUrl = resolvePanelArtworkUrl(selectedTrackInfo.artwork_url) ?? selectedTrackInfo.artwork_url;
    if (!artworkUrl) {
      setStatus(t("coverDownloadMissingArtwork"));
      return;
    }

    try {
      const defaultName = `${sanitizeCoverFileStem(selectedTrackInfo.title)}-cover.jpg`;
      const selectedOutputPath = await saveDialog({
        title: t("coverDownloadSaveTitle"),
        defaultPath: defaultName,
        filters: [{ name: "JPEG", extensions: ["jpg", "jpeg"] }],
      });

      if (!selectedOutputPath || Array.isArray(selectedOutputPath)) {
        return;
      }

      setAsyncState("downloadingCover", true);
      const result = await invoke<{ output_path: string }>("download_track_cover", {
        artworkUrl,
        outputPath: selectedOutputPath,
      });
      setStatus(`${t("coverDownloadDone")}: ${result.output_path}`);
    } catch (error) {
      setStatus(`${t("coverDownloadError")}: ${String(error)}`);
    } finally {
      setAsyncState("downloadingCover", false);
    }
  }

  async function refreshSelectedPlaylistDetails() {
    if (!selectedPlaylistDetails) {
      return;
    }

    try {
      setAsyncState("refreshingPlaylistDetails", true);
      const details = await invoke<PlaylistDetails>("get_playlist_details_with_fallback", {
        playlistId: selectedPlaylistDetails.id,
        headless: debugSettings.soundcloud_fallback_headless,
      });

      const mergedDetails = mergeLocalFilesIntoDetails(selectedPlaylistDetails, details);
      setSelectedPlaylistDetailsWithCache(mergedDetails);
      setSelectedTrackId((currentId) => {
        if (currentId === null) {
          return null;
        }
        return mergedDetails.tracks.some((track) => track.id === currentId) ? currentId : null;
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
      setAsyncState("refreshingPlaylistDetails", false);
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

      setAsyncState("exportingSpectrogram", true);

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
      setAsyncState("exportingSpectrogram", false);
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
      setAsyncState("runningGlobalAudioAnalysis", true);
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
      setSelectedTrackId((currentId) => {
        if (currentId === null) {
          return null;
        }
        return details.tracks.some((track) => track.id === currentId) ? currentId : null;
      });

      setStatus(
        `${t("globalAudioAnalysisDone")}: ${result.updated_tracks}/${result.analyzed_tracks} ${t("globalAudioAnalysisUpdated")} • ${result.skipped_tracks} ${t("globalAudioAnalysisSkipped")} • ${result.failed_tracks} ${t("globalAudioAnalysisFailed")}`,
      );
    } catch (error) {
      setStatus(`${t("globalAudioAnalysisError")}: ${String(error)}`);
    } finally {
      setAsyncState("runningGlobalAudioAnalysis", false);
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
    const normalizedSearch = trackSearchQuery
      .trim()
      .toLocaleLowerCase(language === "fr" ? "fr" : "en")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const filtered = tracks.filter((track) => {
      if (normalizedSearch) {
        const searchTarget = [track.title, track.artist, track.genre]
          .filter((value): value is string => Boolean(value?.trim()))
          .join(" ")
          .toLocaleLowerCase(language === "fr" ? "fr" : "en")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "");

        if (!searchTarget.includes(normalizedSearch)) {
          return false;
        }
      }

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
    if (selectedTrackId === track.id) {
      openTrackRequestRef.current += 1;
      setSelectedTrackId(null);
      return;
    }

    const requestId = openTrackRequestRef.current + 1;
    openTrackRequestRef.current = requestId;

    void (async () => {
      await ensureTrackLocalFileStillAvailable(track);
      if (openTrackRequestRef.current !== requestId) {
        return;
      }
      setSelectedTrackId(track.id);
    })();
  }

  const filteredTracks = selectedPlaylistDetails ? getFilteredTracks(selectedPlaylistDetails.tracks) : [];
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
  const estimatedGlobalAnalysisMinSeconds = analyzableTracksCount * 3;
  const estimatedGlobalAnalysisMaxSeconds = analyzableTracksCount * 7;
  const isAnyLoading = Object.values(asyncState).some(Boolean);
  const headerSpinnerFrame = useUnicodeSpinner(isAnyLoading, "waverows");

  return (
    <main className="app">
      <header className="header">
        <div className="app-brand">
          <img src="/glazer-logo.png" alt="" className="app-brand-logo" aria-hidden="true" />
          <h1>lazer</h1>
        </div>
        <div className="tabs">
          <span
            className={isAnyLoading ? "header-loading-spinner active" : "header-loading-spinner"}
            aria-live="polite"
            aria-label={isAnyLoading ? t("loading") : undefined}
          >
            {isAnyLoading ? headerSpinnerFrame : ""}
          </span>
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
            <PlaylistList
              playlists={playlists}
              loadingPlaylists={asyncState.loadingPlaylists}
              onSyncPlaylists={() => {
                syncPlaylists().catch((error) => {
                  setStatus(`${t("statusSyncError")}: ${String(error)}`);
                });
              }}
              onOpenPlaylistDetails={(playlistId) => {
                openPlaylistDetails(playlistId).catch((error) => {
                  setStatus(`${t("statusPlaylistError")}: ${String(error)}`);
                });
              }}
              t={t}
            />
          ) : (
            <div className={selectedTrackInfo ? "tracks-layout with-panel" : "tracks-layout"}>
              <PlaylistDetailsView
                t={t}
                selectedPlaylistDetails={selectedPlaylistDetails}
                filteredTracks={filteredTracks}
                playlistFolderPath={playlistFolderPath}
                playlistFolderAvailable={playlistFolderAvailable}
                loadingPlaylistFolder={asyncState.loadingPlaylistFolder}
                scanningLocalFiles={asyncState.scanningLocalFiles}
                refreshingPlaylistDetails={asyncState.refreshingPlaylistDetails}
                runningGlobalAudioAnalysis={asyncState.runningGlobalAudioAnalysis}
                confirmGlobalAudioAnalysis={confirmGlobalAudioAnalysis}
                overwriteExistingGlobalAnalysis={overwriteExistingGlobalAnalysis}
                hasAvailableLocalFolder={hasAvailableLocalFolder}
                analyzableTracksCount={analyzableTracksCount}
                estimatedGlobalAnalysisMinSeconds={estimatedGlobalAnalysisMinSeconds}
                estimatedGlobalAnalysisMaxSeconds={estimatedGlobalAnalysisMaxSeconds}
                activeFilterCount={activeFilterCount}
                hasActiveTrackFilters={hasActiveTrackFilters}
                isFilterMenuOpen={isFilterMenuOpen}
                isActionsMenuOpen={isActionsMenuOpen}
                trackSortOrder={trackSortOrder}
                downloadSourceFilter={downloadSourceFilter}
                localDownloadFilter={localDownloadFilter}
                audioQualityFilter={audioQualityFilter}
                trackSearchQuery={trackSearchQuery}
                trackViewMode={trackViewMode}
                sectionControlsRef={sectionControlsRef}
                onClosePlaylistDetails={closePlaylistDetails}
                onRefreshFolderAssociation={() => {
                  loadPlaylistLocalFolderAssociation(selectedPlaylistDetails.id).catch((error) => {
                    setStatus(`${t("statusPlaylistError")}: ${String(error)}`);
                  });
                }}
                onToggleTrackViewMode={() => setTrackViewMode((current) => (current === "list" ? "icons" : "list"))}
                onToggleFilterMenu={() => {
                  setIsActionsMenuOpen(false);
                  setConfirmGlobalAudioAnalysis(false);
                  setOverwriteExistingGlobalAnalysis(false);
                  setIsFilterMenuOpen((current) => !current);
                }}
                onToggleActionsMenu={() => {
                  setIsFilterMenuOpen(false);
                  setConfirmGlobalAudioAnalysis(false);
                  setOverwriteExistingGlobalAnalysis(false);
                  setIsActionsMenuOpen((current) => !current);
                }}
                setTrackSortOrder={(value) => setTrackSortOrder(value)}
                setDownloadSourceFilter={(value) => setDownloadSourceFilter(value)}
                setLocalDownloadFilter={(value) => setLocalDownloadFilter(value)}
                setAudioQualityFilter={(value) => setAudioQualityFilter(value)}
                setTrackSearchQuery={setTrackSearchQuery}
                onClearTrackFilters={clearTrackFilters}
                onRefreshSelectedPlaylistDetails={() => {
                  refreshSelectedPlaylistDetails().catch((error) => {
                    setStatus(`${t("statusPlaylistError")}: ${String(error)}`);
                  });
                }}
                onStartConfirmGlobalAudioAnalysis={() => setConfirmGlobalAudioAnalysis(true)}
                onSetOverwriteExistingGlobalAnalysis={(value) => setOverwriteExistingGlobalAnalysis(value)}
                onConfirmAndRunGlobalPlaylistAudioAnalysis={() => {
                  confirmAndRunGlobalPlaylistAudioAnalysis().catch((error) => {
                    setStatus(`${t("globalAudioAnalysisError")}: ${String(error)}`);
                  });
                }}
                onCancelGlobalAudioAnalysis={() => {
                  setConfirmGlobalAudioAnalysis(false);
                  setOverwriteExistingGlobalAnalysis(false);
                }}
                onToggleFolderScan={() => {
                  const action = playlistFolderPath ? dissociateFolder : selectFolderAndScan;
                  action().catch((error) => {
                    setStatus(`${t("statusPlaylistError")}: ${String(error)}`);
                  });
                }}
                onOpenTrackInfo={openTrackInfo}
                formatCount={formatCount}
                formatEstimatedDuration={formatEstimatedDuration}
              />

              {selectedTrackInfo ? (
                <TrackPanel
                  t={t}
                  selectedTrackInfo={selectedTrackInfo}
                  hasAvailableLocalFolder={hasAvailableLocalFolder}
                  canDownloadSelectedTrackFromHypeddit={canDownloadSelectedTrackFromHypeddit}
                  overwriteExistingHypedditDownload={overwriteExistingHypedditDownload}
                  setOverwriteExistingHypedditDownload={setOverwriteExistingHypedditDownload}
                  downloadEmbedCover={downloadEmbedCover}
                  downloadRenameWithSoundcloudTitle={downloadRenameWithSoundcloudTitle}
                  onSaveDownloadEmbedCover={(enabled) => {
                    saveDownloadEmbedCover(enabled).catch((error) => {
                      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
                    });
                  }}
                  onSaveDownloadRenameWithSoundcloudTitle={(enabled) => {
                    saveDownloadRenameWithSoundcloudTitle(enabled).catch((error) => {
                      setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
                    });
                  }}
                  hypedditDownloadPhase={hypedditDownloadPhase}
                  availableMoveTargetPlaylists={availableMoveTargetPlaylists}
                  targetPlaylistIdForMove={targetPlaylistIdForMove}
                  setTargetPlaylistIdForMove={(value) => setTargetPlaylistIdForMove(value)}
                  movingTrackBetweenPlaylists={asyncState.movingTrackBetweenPlaylists}
                  associatingLocalFile={asyncState.associatingLocalFile}
                  embeddingLocalCover={asyncState.embeddingLocalCover}
                  exportingSpectrogram={asyncState.exportingSpectrogram}
                  dissociatingLocalFile={asyncState.dissociatingLocalFile}
                  downloadingFromHypeddit={asyncState.downloadingFromHypeddit}
                  downloadingCover={asyncState.downloadingCover}
                  loadingSpectrogramPreview={asyncState.loadingSpectrogramPreview}
                  savingManualCutoff={asyncState.savingManualCutoff}
                  manualCutoffInputHz={manualCutoffInputHz}
                  setManualCutoffInputHz={setManualCutoffInputHz}
                  spectrogramPreview={spectrogramPreview}
                  onOpenSoundcloud={() => {
                    if (selectedTrackInfo.permalink_url) {
                      void openUrl(selectedTrackInfo.permalink_url);
                    }
                  }}
                  onOpenAssociatedUrl={() => {
                    if (selectedTrackInfo.associated_url) {
                      void openUrl(selectedTrackInfo.associated_url);
                    }
                  }}
                  onRevealLocalFile={() => {
                    runSelectedLocalFileUtility(
                      () => revealSelectedTrackLocalFileInExplorer(),
                      "localRevealFileMissingPath",
                    ).catch((error) => {
                      setStatus(`${t("localRevealFileError")}: ${String(error)}`);
                    });
                  }}
                  onEmbedLocalCover={() => {
                    runSelectedLocalFileUtility(
                      () => embedSelectedTrackCoverIntoLocalMp3(),
                      "localRevealFileMissingPath",
                    ).catch((error) => {
                      setStatus(`${t("localEmbedCoverError")}: ${String(error)}`);
                    });
                  }}
                  onExportSpectrogram={() => {
                    runSelectedLocalFileUtility(
                      () => exportSelectedTrackSpectrogram(),
                      "localRevealFileMissingPath",
                    ).catch((error) => {
                      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
                    });
                  }}
                  onDissociateLocalFile={() => {
                    dissociateLocalFileFromSelectedTrack().catch((error) => {
                      setStatus(`${t("localDissociateError")}: ${String(error)}`);
                    });
                  }}
                  onAssociateLocalFile={() => {
                    associateLocalFileToSelectedTrack().catch((error) => {
                      setStatus(`${t("localAssociateError")}: ${String(error)}`);
                    });
                  }}
                  onPrepareHypedditDownloadModal={() => prepareHypedditDownloadModal()}
                  onDownloadFromHypeddit={() => {
                    downloadSelectedTrackFromHypeddit().catch((error) => {
                      setStatus(`${t("hypedditDownloadError")}: ${String(error)}`);
                    });
                  }}
                  onDownloadCover={() => {
                    downloadSelectedTrackCover().catch((error) => {
                      setStatus(`${t("coverDownloadError")}: ${String(error)}`);
                    });
                  }}
                  onMoveTrack={() => {
                    const action = selectedTrackInfo.local_file?.file_path
                      ? runSelectedLocalFileUtility(
                          () => moveSelectedTrackToAnotherPlaylist(),
                          "localRevealFileMissingPath",
                        )
                      : moveSelectedTrackToAnotherPlaylist();

                    action.catch((error) => {
                      setStatus(`${t("moveTrackError")}: ${String(error)}`);
                    });
                  }}
                  onGenerateSpectrogramPreview={() => {
                    generateSpectrogramPreview().catch((error) => {
                      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
                    });
                  }}
                  onSaveManualCutoff={() => {
                    saveManualCutoff().catch((error) => {
                      setStatus(`${t("localSpectrogramExportError")}: ${String(error)}`);
                    });
                  }}
                  getAssociatedButtonLabel={getAssociatedButtonLabel}
                  getHypedditProgressLabel={getHypedditProgressLabel}
                  resolvePanelArtworkUrl={resolvePanelArtworkUrl}
                  formatFrequency={formatFrequency}
                  formatDuration={formatDuration}
                  formatText={formatText}
                  formatCount={formatCount}
                  formatDate={formatDate}
                  formatDurationFromSeconds={formatDurationFromSeconds}
                  formatBitrate={formatBitrate}
                  formatQuality={formatQuality}
                  formatFileSize={formatFileSize}
                />
              ) : null}
            </div>
          )}
        </section>
      ) : (
        <section className="card" ref={(element) => { cardScrollRef.current = element; }}>
          <SettingsView
            t={t}
            themeMode={themeMode}
            panelCoverQuality={panelCoverQuality}
            language={language}
            playlistCoverMode={playlistCoverMode}
            savingPlaylistCoverMode={asyncState.savingPlaylistCoverMode}
            spectrogramAnalysisScope={spectrogramAnalysisScope}
            analysisAutoApplyFrequencyMax={analysisAutoApplyFrequencyMax}
            downloadEmbedCover={downloadEmbedCover}
            downloadRenameWithSoundcloudTitle={downloadRenameWithSoundcloudTitle}
            hypedditDownloadConversionFormat={hypedditDownloadConversionFormat}
            hypedditDownloadStartTimeoutSeconds={hypedditDownloadStartTimeoutSeconds}
            hypedditDownloadHeadless={hypedditDownloadHeadless}
            hypedditDownloadComment={hypedditDownloadComment}
            setHypedditDownloadComment={setHypedditDownloadComment}
            hypedditDownloadName={hypedditDownloadName}
            setHypedditDownloadName={setHypedditDownloadName}
            hypedditDownloadEmail={hypedditDownloadEmail}
            setHypedditDownloadEmail={setHypedditDownloadEmail}
            connecting={asyncState.connecting}
            connectingPlaywrightSoundcloud={asyncState.connectingPlaywrightSoundcloud}
            connectingPlaywrightSpotify={asyncState.connectingPlaywrightSpotify}
            configStatus={configStatus}
            debugSettings={debugSettings}
            onThemeChange={onThemeChange}
            onPanelCoverQualityChange={onPanelCoverQualityChange}
            onLanguageChange={onLanguageChange}
            onSavePlaylistCoverMode={(mode) => {
              savePlaylistCoverMode(mode).catch((error) => {
                setStatus(`${t("statusPlaylistCoverModeError")}: ${String(error)}`);
              });
            }}
            onSpectrogramAnalysisScopeChange={onSpectrogramAnalysisScopeChange}
            onSaveAnalysisAutoApplyFrequencyMax={(enabled) => {
              saveAnalysisAutoApplyFrequencyMax(enabled).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveDownloadEmbedCover={(enabled) => {
              saveDownloadEmbedCover(enabled).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveDownloadRenameWithSoundcloudTitle={(enabled) => {
              saveDownloadRenameWithSoundcloudTitle(enabled).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveHypedditDownloadConversionFormat={(format) => {
              saveHypedditDownloadConversionFormat(format).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            setHypedditDownloadStartTimeoutSeconds={setHypedditDownloadStartTimeoutSeconds}
            onSaveHypedditDownloadStartTimeoutSeconds={() => {
              saveHypedditDownloadStartTimeoutSeconds(hypedditDownloadStartTimeoutSeconds).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveHypedditDownloadHeadless={(enabled) => {
              saveHypedditDownloadHeadless(enabled).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveHypedditDownloadComment={() => {
              saveHypedditDownloadComment(hypedditDownloadComment).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveHypedditDownloadName={() => {
              saveHypedditDownloadName(hypedditDownloadName).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onSaveHypedditDownloadEmail={() => {
              saveHypedditDownloadEmail(hypedditDownloadEmail).catch((error) => {
                setStatus(`${t("statusDownloadSettingsError")}: ${String(error)}`);
              });
            }}
            onToggleSoundCloud={() => {
              toggleSoundCloudConnection().catch((error) => {
                setStatus(`${t("statusAuthError")}: ${String(error)}`);
              });
            }}
            onConnectPlaywrightSoundcloud={() => {
              connectPlaywrightProfileSession("soundcloud").catch((error) => {
                setStatus(`${t("statusPlaywrightSessionError")}: ${String(error)}`);
              });
            }}
            onConnectPlaywrightSpotify={() => {
              connectPlaywrightProfileSession("spotify").catch((error) => {
                setStatus(`${t("statusPlaywrightSessionError")}: ${String(error)}`);
              });
            }}
            onSaveFallbackHeadless={(enabled) => {
              saveFallbackHeadless(enabled).catch((error) => {
                setStatus(`${t("statusDebugSaveError")}: ${String(error)}`);
              });
            }}
            onSaveLogsEnabled={(enabled) => {
              saveLogsEnabled(enabled).catch((error) => {
                setStatus(`${t("statusDebugSaveError")}: ${String(error)}`);
              });
            }}
          />
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
