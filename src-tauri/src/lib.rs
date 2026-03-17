mod config;
mod db;
mod local_files;
mod models;
mod soundcloud;
mod spotify;

use std::path::{Path, PathBuf};
use std::process::Command;

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

#[derive(Serialize)]
struct MiscSettings {
    playlist_cover_mode: String,
    download_embed_cover: bool,
    download_rename_with_soundcloud_title: bool,
    hypeddit_download_headless: bool,
    hypeddit_download_comment: String,
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
    folder_available: bool,
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

#[derive(Serialize)]
struct MovePlaylistTrackResult {
    moved_local_link: bool,
    moved_local_file_path: Option<String>,
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
    let use_random_track_cover = db::get_playlist_cover_mode(&state.db_path)? == "random";
    let playlists = soundcloud::fetch_user_playlists(&access_token, use_random_track_cover)?;
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
    let folder_available = folder_path
        .as_deref()
        .map(|path| Path::new(path).exists())
        .unwrap_or(true);

    Ok(PlaylistLocalFolderAssociation {
        playlist_id,
        folder_path,
        folder_available,
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
fn move_track_between_playlists(
    state: State<AppState>,
    source_playlist_id: i64,
    target_playlist_id: i64,
    track_id: i64,
    track_permalink_url: Option<String>,
    local_file_path: Option<String>,
    _local_file_name: Option<String>,
) -> Result<MovePlaylistTrackResult, String> {
    let track_url = track_permalink_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
    let local_file_path = local_file_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());

    let source_folder = db::get_playlist_folder_link(&state.db_path, source_playlist_id)?;
    let target_folder = db::get_playlist_folder_link(&state.db_path, target_playlist_id)?;
    let source_has_folder = source_folder.is_some();
    let target_has_folder = target_folder.is_some();
    if source_has_folder != target_has_folder {
        return Err(
            "Deplacement refuse: la playlist cible doit avoir le meme statut de dossier local (associe/non associe)."
                .to_string(),
        );
    }

    let mut relocated_file_path: Option<String> = None;
    let mut relocated_file_name: Option<String> = None;
    let mut moved_local_link_by_url = false;
    let mut rollback_source_path: Option<PathBuf> = None;
    let mut rollback_destination_path: Option<PathBuf> = None;

    if source_has_folder && target_has_folder {
        let source_folder_path = source_folder
            .as_deref()
            .ok_or_else(|| "Dossier local source introuvable.".to_string())?;
        let target_folder_path = target_folder
            .as_deref()
            .ok_or_else(|| "Dossier local cible introuvable.".to_string())?;

        if Path::new(source_folder_path) == Path::new(target_folder_path) {
            return Err(
                "Deplacement local refuse: la playlist cible pointe vers le meme dossier local que la source."
                    .to_string(),
            );
        }

        let local_link_info = if let Some(track_url) = track_url.as_deref() {
            if let Some(info) = db::get_playlist_track_local_file_link_info(
                &state.db_path,
                source_playlist_id,
                track_url,
            )? {
                moved_local_link_by_url = true;
                Some(info)
            } else {
                None
            }
        } else {
            None
        };

        let (existing_file_path, existing_file_name) = match local_link_info {
            Some(info) => info,
            None => {
                let fallback_source_path = local_file_path
                    .as_deref()
                    .ok_or_else(|| "Aucun fichier local associe a cette track dans la playlist source.".to_string())?;
                db::get_playlist_track_local_file_link_info_by_file_path(
                    &state.db_path,
                    source_playlist_id,
                    fallback_source_path,
                )?
                .ok_or_else(|| "Aucun fichier local associe a cette track dans la playlist source.".to_string())?
            }
        };

        let source_path = PathBuf::from(existing_file_path);
        if !source_path.exists() {
            return Err("Fichier local introuvable pour la track a deplacer.".to_string());
        }

        let target_dir = PathBuf::from(target_folder_path);
        std::fs::create_dir_all(&target_dir).map_err(|error| error.to_string())?;

        let source_parent_canonical = source_path
            .parent()
            .ok_or_else(|| "Impossible de determiner le dossier source du fichier local.".to_string())?
            .canonicalize()
            .map_err(|error| format!("Impossible de resoudre le dossier source: {error}"))?;
        let target_dir_canonical = target_dir
            .canonicalize()
            .map_err(|error| format!("Impossible de resoudre le dossier cible: {error}"))?;

        if source_parent_canonical == target_dir_canonical {
            return Err(
                "Deplacement local annule: le fichier source est deja dans le dossier cible reel."
                    .to_string(),
            );
        }

        let mut destination_path = target_dir.join(&existing_file_name);
        if destination_path.exists() {
            let source_stem = Path::new(&existing_file_name)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("audio")
                .to_string();
            let extension = Path::new(&existing_file_name)
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| format!(".{value}"))
                .unwrap_or_default();

            let mut suffix = 1usize;
            loop {
                let candidate = target_dir.join(format!("{source_stem} ({suffix}){extension}"));
                if !candidate.exists() {
                    destination_path = candidate;
                    break;
                }
                suffix += 1;
            }
        }

        match std::fs::rename(&source_path, &destination_path) {
            Ok(()) => {}
            Err(_) => {
                std::fs::copy(&source_path, &destination_path)
                    .map_err(|error| format!("Impossible de deplacer le fichier local: {error}"))?;
                std::fs::remove_file(&source_path)
                    .map_err(|error| format!("Impossible de nettoyer l'ancien fichier local: {error}"))?;
            }
        }

        if !destination_path.exists() {
            return Err("Le fichier local n'a pas ete trouve apres le deplacement.".to_string());
        }

        relocated_file_path = Some(destination_path.to_string_lossy().to_string());
        relocated_file_name = destination_path
            .file_name()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string());
        rollback_source_path = Some(source_path);
        rollback_destination_path = Some(destination_path);
    }

    let access_token = db::get_access_token(&state.db_path)?
        .ok_or_else(|| "Aucun token SoundCloud trouvé. Connecte-toi d'abord.".to_string())?;

    if let Err(soundcloud_error) = soundcloud::move_track_between_playlists(
        &access_token,
        source_playlist_id,
        target_playlist_id,
        track_id,
    ) {
        if let (Some(source_path), Some(destination_path)) = (
            rollback_source_path.as_ref(),
            rollback_destination_path.as_ref(),
        ) {
            if destination_path.exists() {
                let rollback_result = std::fs::rename(destination_path, source_path).or_else(|_| {
                    std::fs::copy(destination_path, source_path)?;
                    std::fs::remove_file(destination_path)
                });

                if let Err(rollback_error) = rollback_result {
                    return Err(format!(
                        "Echec move SoundCloud ({soundcloud_error}) + rollback local impossible ({rollback_error})."
                    ));
                }
            }
        }

        return Err(soundcloud_error);
    }

    let moved_local_link = if moved_local_link_by_url {
        db::move_playlist_track_local_file_link(
            &state.db_path,
            source_playlist_id,
            target_playlist_id,
            track_url
                .as_deref()
                .ok_or_else(|| "URL SoundCloud manquante pour mise a jour locale.".to_string())?,
            relocated_file_path.as_deref(),
            relocated_file_name.as_deref(),
        )?
    } else if let Some(source_path) = local_file_path.as_deref() {
        db::move_playlist_track_local_file_link_by_file_path(
            &state.db_path,
            source_playlist_id,
            target_playlist_id,
            source_path,
            relocated_file_path.as_deref(),
            relocated_file_name.as_deref(),
        )?
    } else {
        false
    };

    Ok(MovePlaylistTrackResult {
        moved_local_link,
        moved_local_file_path: relocated_file_path,
    })
}

#[tauri::command]
fn embed_local_mp3_cover(file_path: String, artwork_url: String) -> Result<(), String> {
    local_files::embed_cover_into_mp3(file_path.trim(), artwork_url.trim())
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
fn reveal_local_file_in_explorer(file_path: String) -> Result<(), String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Err("Chemin de fichier local vide.".to_string());
    }

    let target_path = PathBuf::from(trimmed_path);
    if !target_path.exists() {
        return Err("Fichier local introuvable.".to_string());
    }

    #[cfg(target_os = "macos")]
    {
        let status = Command::new("open")
            .arg("-R")
            .arg(&target_path)
            .status()
            .map_err(|error| format!("Impossible d'ouvrir Finder: {error}"))?;

        if !status.success() {
            return Err("Impossible de révéler le fichier dans Finder.".to_string());
        }
    }

    #[cfg(target_os = "windows")]
    {
        let status = Command::new("explorer")
            .arg(format!("/select,{}", target_path.to_string_lossy()))
            .status()
            .map_err(|error| format!("Impossible d'ouvrir Explorer: {error}"))?;

        if !status.success() {
            return Err("Impossible de révéler le fichier dans Explorer.".to_string());
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let folder_path = target_path
            .parent()
            .ok_or_else(|| "Impossible de déterminer le dossier parent du fichier.".to_string())?;
        let status = Command::new("xdg-open")
            .arg(folder_path)
            .status()
            .map_err(|error| format!("Impossible d'ouvrir le gestionnaire de fichiers: {error}"))?;

        if !status.success() {
            return Err("Impossible d'ouvrir le gestionnaire de fichiers.".to_string());
        }
    }

    Ok(())
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

#[tauri::command]
fn get_misc_settings(state: State<AppState>) -> Result<MiscSettings, String> {
    Ok(MiscSettings {
        playlist_cover_mode: db::get_playlist_cover_mode(&state.db_path)?,
        download_embed_cover: db::get_download_embed_cover(&state.db_path)?,
        download_rename_with_soundcloud_title: db::get_download_rename_with_soundcloud_title(
            &state.db_path,
        )?,
        hypeddit_download_headless: db::get_hypeddit_download_headless(&state.db_path)?,
        hypeddit_download_comment: db::get_hypeddit_download_comment(&state.db_path)?,
    })
}

#[tauri::command]
fn set_playlist_cover_mode(state: State<AppState>, mode: String) -> Result<(), String> {
    db::set_playlist_cover_mode(&state.db_path, mode.trim())
}

#[tauri::command]
fn set_download_embed_cover(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_download_embed_cover(&state.db_path, enabled)
}

#[tauri::command]
fn set_download_rename_with_soundcloud_title(
    state: State<AppState>,
    enabled: bool,
) -> Result<(), String> {
    db::set_download_rename_with_soundcloud_title(&state.db_path, enabled)
}

#[tauri::command]
fn set_hypeddit_download_headless(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_hypeddit_download_headless(&state.db_path, enabled)
}

#[tauri::command]
fn set_hypeddit_download_comment(state: State<AppState>, comment: String) -> Result<(), String> {
    db::set_hypeddit_download_comment(&state.db_path, comment.as_str())
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
            move_track_between_playlists,
            embed_local_mp3_cover,
            export_local_spectrogram_jpg,
            generate_local_spectrogram_preview,
            delete_local_spectrogram_preview,
            save_playlist_track_cutoff_analysis,
            analyze_playlist_local_audio_quality,
            reveal_local_file_in_explorer,
            get_debug_settings,
            set_soundcloud_fallback_headless,
            set_logs_enabled,
            get_misc_settings,
            set_playlist_cover_mode,
            set_download_embed_cover,
            set_download_rename_with_soundcloud_title,
            set_hypeddit_download_headless,
            set_hypeddit_download_comment
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
