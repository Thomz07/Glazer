export type View = "playlists" | "settings";

export type Playlist = {
  id: number;
  title: string;
  track_count: number;
  is_private: boolean;
  artwork_url?: string | null;
  has_local_link: boolean;
  has_local_folder: boolean;
};

export type LocalAudioFileInfo = {
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

export type PlaylistTrack = {
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

export type PlaylistDetails = {
  id: number;
  title: string;
  track_count: number;
  is_private: boolean;
  permalink_url?: string | null;
  tracks: PlaylistTrack[];
};

export type SoundCloudConfigStatus = {
  configured: boolean;
  connected: boolean;
  connected_account_name?: string | null;
  redirect_uri: string;
};

export type SpotifyConfigStatus = {
  configured: boolean;
  connected: boolean;
  connected_account_name?: string | null;
  redirect_uri: string;
};

export type AuthStartPayload = {
  state: string;
  auth_url: string;
  code_verifier?: string | null;
};

export type DebugSettings = {
  soundcloud_fallback_headless: boolean;
  logs_enabled: boolean;
  hypeddit_click_delay_ms: number;
  hypeddit_preload_app_sessions: boolean;
  show_ytdl_track_download_button: boolean;
  show_ytdl_playlist_download_button: boolean;
};

export type PlaylistCoverMode = "first" | "random";
export type HypedditConversionFormat =
  | "original"
  | "mp3_320"
  | "mp3_256"
  | "mp3_192"
  | "aac_320"
  | "aac_256"
  | "wav"
  | "flac";

export type YtDlDownloadFileType = "bestaudio" | "mp3" | "m4a" | "wav" | "flac";

export type MiscSettings = {
  playlist_cover_mode: PlaylistCoverMode;
  hypeddit_download_embed_cover?: boolean;
  hypeddit_download_rename_with_soundcloud_title?: boolean;
  ytdl_download_embed_cover?: boolean;
  ytdl_download_rename_with_soundcloud_title?: boolean;
  hypeddit_download_conversion_format?: HypedditConversionFormat;
  ytdl_download_file_type?: YtDlDownloadFileType;
  analysis_auto_apply_frequency_max?: boolean;
  hypeddit_download_headless?: boolean;
  hypeddit_download_comment?: string;
  hypeddit_download_name?: string;
  hypeddit_download_email?: string;
  hypeddit_soundcloud_manual_cookies_json?: string;
  hypeddit_download_start_timeout_seconds?: number;
};

export type PlaylistLocalFolderAssociation = {
  playlist_id: number;
  folder_path?: string | null;
  folder_available: boolean;
};

export type PlaylistDetailsCacheEntry = {
  details: PlaylistDetails;
  cached_at_ms: number;
};

export type PlaylistLocalScanResult = {
  playlist_id: number;
  folder_path: string;
  scanned_files: number;
  matched_files: number;
};

export type ThemeMode = "light" | "dark";
export type CoverQuality = "large" | "t300x300" | "t500x500" | "original";
export type TrackSortOrder = "original" | "alphabetical" | "mostPlayed";
export type DownloadSourceFilter = "all" | "downloadable" | "hypeddit" | "bandcamp";
export type LocalDownloadFilter = "all" | "downloaded" | "notDownloaded";
export type AudioQualityFilter = "all" | "high" | "good" | "medium" | "low" | "unknown";
export type TrackViewMode = "list" | "icons";
export type SpectrogramAnalysisScope = "quarter" | "half" | "full";

export type SpectrogramPreviewResult = {
  temp_path: string;
  image_data_url: string;
  estimated_cutoff_hz?: number | null;
};

export type LocalAnalysisUpdateResult = {
  local_max_frequency_hz?: number | null;
  local_quality_label?: string | null;
};

export type PlaylistGlobalAudioAnalysisResult = {
  analyzed_tracks: number;
  updated_tracks: number;
  skipped_tracks: number;
  failed_tracks: number;
};

export type MovePlaylistTrackResult = {
  moved_local_link: boolean;
  moved_local_file_path?: string | null;
};

export type FilenameAssociationBatchResult = {
  attempted: number;
  matched: number;
};

export type HypedditDownloadResult = {
  file_path: string;
  file_name: string;
  overwrote_existing: boolean;
};

export type HypedditDownloadProgressPayload = {
  phase: string;
};
