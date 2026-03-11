use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: i64,
    pub title: String,
    pub track_count: i64,
    pub is_private: bool,
    pub artwork_url: Option<String>,
    pub has_local_link: bool,
    pub has_local_folder: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistTrack {
    pub id: i64,
    pub title: String,
    pub duration_ms: Option<i64>,
    pub artist: Option<String>,
    pub permalink_url: Option<String>,
    pub associated_url: Option<String>,
    pub artwork_url: Option<String>,
    pub genre: Option<String>,
    pub bpm: Option<f64>,
    pub key_signature: Option<String>,
    pub playback_count: Option<i64>,
    pub likes_count: Option<i64>,
    pub reposts_count: Option<i64>,
    pub comment_count: Option<i64>,
    pub created_at: Option<String>,
    pub release_date: Option<String>,
    pub tag_list: Option<String>,
    pub label_name: Option<String>,
    pub local_file: Option<LocalAudioFileInfo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalAudioFileInfo {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: Option<i64>,
    pub modified_at: Option<i64>,
    pub matched_soundcloud_url: String,
    pub local_cover_data_url: Option<String>,
    pub local_title: Option<String>,
    pub local_artist: Option<String>,
    pub local_duration_seconds: Option<i64>,
    pub local_format: Option<String>,
    pub local_bitrate_kbps: Option<i64>,
    pub local_bitrate_announced_kbps: Option<i64>,
    pub local_bitrate_real_kbps: Option<i64>,
    pub local_max_frequency_hz: Option<i64>,
    pub local_quality_label: Option<String>,
    pub local_sample_rate_hz: Option<i64>,
    pub local_channels: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlaylistDetails {
    pub id: i64,
    pub title: String,
    pub track_count: i64,
    pub is_private: bool,
    pub permalink_url: Option<String>,
    pub tracks: Vec<PlaylistTrack>,
}