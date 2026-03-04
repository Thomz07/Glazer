mod config;
mod db;
mod local_files;
mod models;
mod soundcloud;
mod spotify;

use std::path::PathBuf;

use models::{Playlist, PlaylistDetails};
use serde::Serialize;
use tauri::{Emitter, Manager, State};

struct AppState {
    db_path: PathBuf,
}

#[derive(Serialize)]
struct SoundCloudConfigStatus {
    configured: bool,
    connected: bool,
    redirect_uri: String,
}

#[derive(Serialize)]
struct SpotifyConfigStatus {
    configured: bool,
    connected: bool,
    redirect_uri: String,
}

#[derive(Serialize)]
struct DebugSettings {
    soundcloud_fallback_headless: bool,
    logs_enabled: bool,
}

#[derive(Serialize, Clone)]
struct FallbackProgress {
    playlist_id: i64,
    loaded: usize,
}

#[derive(Serialize)]
struct PlaylistLocalFolderAssociation {
    playlist_id: i64,
    folder_path: Option<String>,
}

#[derive(Serialize)]
struct PlaylistLocalScanResult {
    playlist_id: i64,
    folder_path: String,
    scanned_files: usize,
    matched_files: usize,
}

#[derive(Serialize)]
struct SpectrogramExportResult {
    output_path: String,
    estimated_cutoff_hz: Option<i64>,
}

#[derive(Serialize)]
struct SpectrogramPreviewResult {
    temp_path: String,
    image_data_url: String,
    estimated_cutoff_hz: Option<i64>,
}

#[derive(Serialize)]
struct LocalAnalysisUpdateResult {
    local_max_frequency_hz: Option<i64>,
    local_quality_label: Option<String>,
}

#[derive(Serialize)]
struct PlaylistGlobalAudioAnalysisResult {
    analyzed_tracks: usize,
    updated_tracks: usize,
    skipped_tracks: usize,
    failed_tracks: usize,
}

#[tauri::command]
fn get_connection_status(state: State<AppState>) -> Result<SoundCloudConfigStatus, String> {
    let configured = config::load_soundcloud_secrets().is_ok();
    let connected = db::has_access_token(&state.db_path)?;

    Ok(SoundCloudConfigStatus {
        configured,
        connected,
        redirect_uri: config::SOUNDCLOUD_REDIRECT_URI.to_string(),
    })
}

#[tauri::command]
fn get_spotify_connection_status(state: State<AppState>) -> Result<SpotifyConfigStatus, String> {
    let configured = config::load_spotify_secrets().is_ok();
    let connected = db::has_spotify_access_token(&state.db_path)?;

    Ok(SpotifyConfigStatus {
        configured,
        connected,
        redirect_uri: config::SPOTIFY_REDIRECT_URI.to_string(),
    })
}

#[derive(Serialize)]
struct AuthStartPayload {
    state: String,
    auth_url: String,
}

#[tauri::command]
fn start_soundcloud_auth() -> Result<AuthStartPayload, String> {
    let secrets = config::load_soundcloud_secrets()?;
    let start = soundcloud::create_auth_start(&secrets);
    Ok(AuthStartPayload {
        state: start.state,
        auth_url: start.auth_url,
    })
}

#[tauri::command]
fn start_spotify_auth() -> Result<AuthStartPayload, String> {
    let secrets = config::load_spotify_secrets()?;
    let start = spotify::create_auth_start(&secrets);
    Ok(AuthStartPayload {
        state: start.state,
        auth_url: start.auth_url,
    })
}

#[tauri::command]
fn complete_soundcloud_auth(
    state: State<AppState>,
    expected_state: String,
) -> Result<Vec<Playlist>, String> {
    let secrets = config::load_soundcloud_secrets()?;
    let completion = soundcloud::complete_auth(&secrets, expected_state.trim())?;

    db::save_soundcloud_tokens(
        &state.db_path,
        completion.access_token.as_str(),
        completion
            .refresh_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        completion.expires_at,
    )?;

    sync_soundcloud_playlists(state)
}

#[tauri::command]
fn complete_spotify_auth(state: State<AppState>, expected_state: String) -> Result<(), String> {
    let secrets = config::load_spotify_secrets()?;
    let completion = spotify::complete_auth(&secrets, expected_state.trim())?;

    db::save_spotify_tokens(
        &state.db_path,
        completion.access_token.as_str(),
        completion
            .refresh_token
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty()),
        completion.expires_at,
    )?;

    Ok(())
}

#[tauri::command]
fn get_playlists(state: State<AppState>) -> Result<Vec<Playlist>, String> {
    db::list_playlists(&state.db_path)
}

#[tauri::command]
fn sync_soundcloud_playlists(state: State<AppState>) -> Result<Vec<Playlist>, String> {
    let access_token = db::get_access_token(&state.db_path)?
        .ok_or_else(|| "Aucun token SoundCloud trouvé. Connecte-toi d'abord.".to_string())?;
    let playlists = soundcloud::fetch_user_playlists(&access_token)?;
    db::replace_playlists(&state.db_path, &playlists)?;
    db::list_playlists(&state.db_path)
}

#[tauri::command]
fn get_playlist_details(state: State<AppState>, playlist_id: i64) -> Result<PlaylistDetails, String> {
    let access_token = db::get_access_token(&state.db_path)?
        .ok_or_else(|| "Aucun token SoundCloud trouvé. Connecte-toi d'abord.".to_string())?;
    let mut details = soundcloud::fetch_playlist_details(&access_token, playlist_id, false, true, None)?;
    db::attach_local_file_infos(&state.db_path, playlist_id, &mut details.tracks)?;
    Ok(details)
}

#[tauri::command]
fn get_playlist_details_with_fallback(
    app: tauri::AppHandle,
    state: State<AppState>,
    playlist_id: i64,
    headless: bool,
) -> Result<PlaylistDetails, String> {
    let access_token = db::get_access_token(&state.db_path)?
        .ok_or_else(|| "Aucun token SoundCloud trouvé. Connecte-toi d'abord.".to_string())?;
    let mut progress_callback = |loaded: usize| {
        let _ = app.emit(
            "soundcloud-fallback-progress",
            FallbackProgress { playlist_id, loaded },
        );
    };

    let mut details = soundcloud::fetch_playlist_details(
        &access_token,
        playlist_id,
        true,
        headless,
        Some(&mut progress_callback),
    )?;

    db::attach_local_file_infos(&state.db_path, playlist_id, &mut details.tracks)?;
    Ok(details)
}

#[tauri::command]
fn get_playlist_local_folder_association(
    state: State<AppState>,
    playlist_id: i64,
) -> Result<PlaylistLocalFolderAssociation, String> {
    let folder_path = db::get_playlist_folder_link(&state.db_path, playlist_id)?;
    Ok(PlaylistLocalFolderAssociation {
        playlist_id,
        folder_path,
    })
}

#[tauri::command]
fn scan_playlist_local_files(
    state: State<AppState>,
    playlist_id: i64,
    folder_path: Option<String>,
) -> Result<PlaylistLocalScanResult, String> {
    let selected_folder = match folder_path {
        Some(path) if !path.trim().is_empty() => {
            let normalized = path.trim().to_string();
            db::save_playlist_folder_link(&state.db_path, playlist_id, &normalized)?;
            normalized
        }
        _ => db::get_playlist_folder_link(&state.db_path, playlist_id)?
            .ok_or_else(|| "Aucun dossier associé à cette playlist.".to_string())?,
    };

    let scanned_files = local_files::scan_audio_files(&selected_folder)?;
    let matched_files = db::replace_playlist_track_file_links(&state.db_path, playlist_id, &scanned_files)?;

    Ok(PlaylistLocalScanResult {
        playlist_id,
        folder_path: selected_folder,
        scanned_files: scanned_files.len(),
        matched_files,
    })
}

#[tauri::command]
fn dissociate_playlist_local_folder(state: State<AppState>, playlist_id: i64) -> Result<(), String> {
    db::dissociate_playlist_folder_link(&state.db_path, playlist_id)
}

#[tauri::command]
fn associate_playlist_track_local_file(
    state: State<AppState>,
    playlist_id: i64,
    track_permalink_url: String,
    file_path: String,
) -> Result<(), String> {
    db::upsert_playlist_track_file_link_manual(
        &state.db_path,
        playlist_id,
        track_permalink_url.trim(),
        file_path.trim(),
    )
}

#[tauri::command]
fn dissociate_playlist_track_local_file(
    state: State<AppState>,
    playlist_id: i64,
    track_permalink_url: String,
) -> Result<(), String> {
    db::dissociate_playlist_track_local_file(
        &state.db_path,
        playlist_id,
        track_permalink_url.trim(),
    )
}

#[tauri::command]
fn export_local_spectrogram_jpg(
    file_path: String,
    output_path: String,
    analysis_scope: Option<String>,
) -> Result<SpectrogramExportResult, String> {
    let summary = local_files::export_spectrogram_jpg_native(
        file_path.trim(),
        output_path.trim(),
        analysis_scope.as_deref().unwrap_or("half"),
    )?;
    Ok(SpectrogramExportResult {
        output_path: summary.output_path,
        estimated_cutoff_hz: summary.estimated_cutoff_hz,
    })
}

#[tauri::command]
fn generate_local_spectrogram_preview(
    file_path: String,
    analysis_scope: Option<String>,
) -> Result<SpectrogramPreviewResult, String> {
    let summary = local_files::export_spectrogram_preview_temp(
        file_path.trim(),
        analysis_scope.as_deref().unwrap_or("half"),
    )?;

    Ok(SpectrogramPreviewResult {
        temp_path: summary.temp_path,
        image_data_url: summary.image_data_url,
        estimated_cutoff_hz: summary.estimated_cutoff_hz,
    })
}

#[tauri::command]
fn delete_local_spectrogram_preview(temp_path: String) -> Result<(), String> {
    local_files::delete_temporary_spectrogram(temp_path.trim())
}

#[tauri::command]
fn save_playlist_track_cutoff_analysis(
    state: State<AppState>,
    playlist_id: i64,
    track_permalink_url: String,
    cutoff_hz: Option<i64>,
) -> Result<LocalAnalysisUpdateResult, String> {
    let (local_max_frequency_hz, local_quality_label) = db::update_playlist_track_cutoff_analysis(
        &state.db_path,
        playlist_id,
        track_permalink_url.trim(),
        cutoff_hz,
    )?;

    Ok(LocalAnalysisUpdateResult {
        local_max_frequency_hz,
        local_quality_label,
    })
}

#[tauri::command]
fn analyze_playlist_local_audio_quality(
    state: State<AppState>,
    playlist_id: i64,
    analysis_scope: Option<String>,
    overwrite_existing: Option<bool>,
) -> Result<PlaylistGlobalAudioAnalysisResult, String> {
    let stats = db::analyze_playlist_local_audio_quality(
        &state.db_path,
        playlist_id,
        analysis_scope.as_deref().unwrap_or("half"),
        overwrite_existing.unwrap_or(false),
    )?;

    Ok(PlaylistGlobalAudioAnalysisResult {
        analyzed_tracks: stats.analyzed_tracks,
        updated_tracks: stats.updated_tracks,
        skipped_tracks: stats.skipped_tracks,
        failed_tracks: stats.failed_tracks,
    })
}

#[tauri::command]
fn get_debug_settings(state: State<AppState>) -> Result<DebugSettings, String> {
    Ok(DebugSettings {
        soundcloud_fallback_headless: db::get_soundcloud_fallback_headless(&state.db_path)?,
        logs_enabled: db::get_logs_enabled(&state.db_path)?,
    })
}

#[tauri::command]
fn set_soundcloud_fallback_headless(state: State<AppState>, headless: bool) -> Result<(), String> {
    db::set_soundcloud_fallback_headless(&state.db_path, headless)
}

#[tauri::command]
fn set_logs_enabled(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_logs_enabled(&state.db_path, enabled)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    config::load_dotenv();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .map_err(|error| format!("Impossible de récupérer le dossier app data: {error}"))?;
            let db_path = db::database_path(app_data_dir);
            db::init_database(&db_path)?;

            app.manage(AppState { db_path });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_connection_status,
            get_spotify_connection_status,
            start_soundcloud_auth,
            start_spotify_auth,
            complete_soundcloud_auth,
            complete_spotify_auth,
            get_playlists,
            sync_soundcloud_playlists,
            get_playlist_details,
            get_playlist_details_with_fallback,
            get_playlist_local_folder_association,
            scan_playlist_local_files,
            dissociate_playlist_local_folder,
            associate_playlist_track_local_file,
            dissociate_playlist_track_local_file,
            export_local_spectrogram_jpg,
            generate_local_spectrogram_preview,
            delete_local_spectrogram_preview,
            save_playlist_track_cutoff_analysis,
            analyze_playlist_local_audio_quality,
            get_debug_settings,
            set_soundcloud_fallback_headless,
            set_logs_enabled
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
