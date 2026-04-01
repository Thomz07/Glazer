mod config;
mod db;
mod local_files;
mod models;
mod soundcloud;
mod spotify;

use std::path::{Path, PathBuf};
use std::io::{BufRead, BufReader};
use std::process::{Command, Stdio};

use models::{LocalAudioFileInfo, Playlist, PlaylistDetails, PlaylistTrack};
use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, State};

struct AppState {
    db_path: PathBuf,
}

#[derive(Serialize)]
struct SoundCloudConfigStatus {
    configured: bool,
    connected: bool,
    connected_account_name: Option<String>,
    redirect_uri: String,
}

#[derive(Serialize)]
struct SpotifyConfigStatus {
    configured: bool,
    connected: bool,
    connected_account_name: Option<String>,
    redirect_uri: String,
}

#[derive(Serialize)]
struct DebugSettings {
    soundcloud_fallback_headless: bool,
    logs_enabled: bool,
    hypeddit_click_delay_ms: i64,
    hypeddit_preload_app_sessions: bool,
}

#[derive(Serialize)]
struct MiscSettings {
    playlist_cover_mode: String,
    download_embed_cover: bool,
    download_rename_with_soundcloud_title: bool,
    hypeddit_download_conversion_format: String,
    analysis_auto_apply_frequency_max: bool,
    hypeddit_download_headless: bool,
    hypeddit_download_comment: String,
    hypeddit_download_name: String,
    hypeddit_download_email: String,
    hypeddit_download_start_timeout_seconds: i64,
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

#[derive(Deserialize)]
struct HypedditScriptResult {
    file_path: String,
    file_name: String,
    overwrote_existing: bool,
}

#[derive(Deserialize)]
struct PlaywrightSessionLoginResult {
    provider: String,
    connected: bool,
}

#[derive(Deserialize)]
struct PlaywrightSessionStatusResult {
    provider: String,
    connected: bool,
}

#[derive(Serialize)]
struct HypedditDownloadResult {
    file_path: String,
    file_name: String,
    overwrote_existing: bool,
}

#[derive(Serialize)]
struct CoverDownloadResult {
    output_path: String,
}

#[derive(Serialize, Clone)]
struct HypedditDownloadProgressPayload {
    phase: String,
}

fn sanitize_file_stem(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return "track".to_string();
    }

    let mut output = String::with_capacity(trimmed.len());
    let mut last_was_space = false;
    for character in trimmed.chars() {
        let disallowed = matches!(character, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*');
        let sanitized = if disallowed || character.is_control() {
            '_'
        } else {
            character
        };

        if sanitized.is_whitespace() {
            if !last_was_space {
                output.push(' ');
            }
            last_was_space = true;
        } else {
            output.push(sanitized);
            last_was_space = false;
        }
    }

    let collapsed = output.trim();
    if collapsed.is_empty() {
        "track".to_string()
    } else {
        collapsed.to_string()
    }
}

#[tauri::command]
fn get_connection_status(state: State<AppState>) -> Result<SoundCloudConfigStatus, String> {
    let configured = config::load_soundcloud_secrets().is_ok();
    let token = db::get_access_token(&state.db_path)?;
    let connected = token.is_some();
    let connected_account_name = token
        .as_deref()
        .and_then(|value| soundcloud::fetch_connected_account_name(value).ok().flatten());

    Ok(SoundCloudConfigStatus {
        configured,
        connected,
        connected_account_name,
        redirect_uri: config::SOUNDCLOUD_REDIRECT_URI.to_string(),
    })
}

#[tauri::command]
fn get_spotify_connection_status(state: State<AppState>) -> Result<SpotifyConfigStatus, String> {
    let configured = config::load_spotify_secrets().is_ok();
    let token = db::get_spotify_access_token(&state.db_path)?;
    let connected = token.is_some();
    let connected_account_name = token
        .as_deref()
        .and_then(|value| spotify::fetch_connected_account_name(value).ok().flatten());

    Ok(SpotifyConfigStatus {
        configured,
        connected,
        connected_account_name,
        redirect_uri: config::SPOTIFY_REDIRECT_URI.to_string(),
    })
}

#[tauri::command]
fn disconnect_soundcloud(state: State<AppState>) -> Result<(), String> {
    db::clear_soundcloud_tokens(&state.db_path)
}

#[tauri::command]
fn disconnect_spotify(state: State<AppState>) -> Result<(), String> {
    db::clear_spotify_tokens(&state.db_path)
}

#[derive(Serialize)]
struct AuthStartPayload {
    state: String,
    auth_url: String,
    code_verifier: Option<String>,
}

#[tauri::command]
fn start_soundcloud_auth() -> Result<AuthStartPayload, String> {
    let secrets = config::load_soundcloud_secrets()?;
    let start = soundcloud::create_auth_start(&secrets);
    Ok(AuthStartPayload {
        state: start.state,
        auth_url: start.auth_url,
        code_verifier: None,
    })
}

#[tauri::command]
fn start_spotify_auth() -> Result<AuthStartPayload, String> {
    let secrets = config::load_spotify_secrets()?;
    let start = spotify::create_auth_start(&secrets);
    Ok(AuthStartPayload {
        state: start.state,
        auth_url: start.auth_url,
        code_verifier: Some(start.code_verifier),
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
fn complete_spotify_auth(
    state: State<AppState>,
    expected_state: String,
    code_verifier: String,
) -> Result<(), String> {
    let secrets = config::load_spotify_secrets()?;
    let completion = spotify::complete_auth(&secrets, expected_state.trim(), code_verifier.trim())?;

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
fn get_playlist_track_local_file_info(
    state: State<AppState>,
    playlist_id: i64,
    track_permalink_url: String,
) -> Result<Option<LocalAudioFileInfo>, String> {
    let permalink = track_permalink_url.trim();
    if permalink.is_empty() {
        return Ok(None);
    }

    let mut track = PlaylistTrack {
        id: 0,
        title: String::new(),
        duration_ms: None,
        artist: None,
        permalink_url: Some(permalink.to_string()),
        associated_url: None,
        artwork_url: None,
        genre: None,
        bpm: None,
        key_signature: None,
        playback_count: None,
        likes_count: None,
        reposts_count: None,
        comment_count: None,
        created_at: None,
        release_date: None,
        tag_list: None,
        label_name: None,
        local_file: None,
    };

    db::attach_local_file_infos(&state.db_path, playlist_id, std::slice::from_mut(&mut track))?;
    Ok(track.local_file)
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
fn download_track_cover(artwork_url: String, output_path: String) -> Result<CoverDownloadResult, String> {
    let saved_path = local_files::download_cover_as_jpeg(artwork_url.trim(), output_path.trim())?;
    Ok(CoverDownloadResult {
        output_path: saved_path,
    })
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
fn download_hypeddit_track_to_local_folder(
    app: tauri::AppHandle,
    state: State<AppState>,
    playlist_id: i64,
    track_permalink_url: String,
    track_title: String,
    hypeddit_url: String,
    artwork_url: Option<String>,
    overwrite_existing: bool,
    existing_file_path: Option<String>,
) -> Result<HypedditDownloadResult, String> {
    let folder_path = db::get_playlist_folder_link(&state.db_path, playlist_id)?
        .ok_or_else(|| "Aucun dossier local associé à cette playlist.".to_string())?;
    let folder = PathBuf::from(folder_path.trim());

    if !folder.exists() || !folder.is_dir() {
        return Err("Le dossier local associé est introuvable.".to_string());
    }

    let hypeddit_url_trimmed = hypeddit_url.trim();
    if hypeddit_url_trimmed.is_empty() {
        return Err("Lien Hypeddit introuvable pour cette track.".to_string());
    }
    if !hypeddit_url_trimmed.to_lowercase().contains("hypeddit") {
        return Err("Le lien associé n'est pas un lien Hypeddit.".to_string());
    }

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Impossible de localiser la racine du projet".to_string())?
        .to_path_buf();
    let script_path = project_root.join("scripts").join("hypeddit-download.mjs");

    if !script_path.exists() {
        return Err(format!(
            "Script Hypeddit introuvable: {}",
            script_path.display()
        ));
    }

    let existing_file_path_trimmed = existing_file_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string())
        .unwrap_or_default();
    let hypeddit_headless = db::get_hypeddit_download_headless(&state.db_path)?;
    let hypeddit_comment = db::get_hypeddit_download_comment(&state.db_path)?;
    let hypeddit_name = db::get_hypeddit_download_name(&state.db_path)?;
    let hypeddit_email = db::get_hypeddit_download_email(&state.db_path)?;
    let hypeddit_download_start_timeout_seconds =
        db::get_hypeddit_download_start_timeout_seconds(&state.db_path)?;
    let hypeddit_click_delay_ms = db::get_hypeddit_click_delay_ms(&state.db_path)?;
    let hypeddit_preload_app_sessions = db::get_hypeddit_preload_app_sessions(&state.db_path)?;
    let browser_profile_dir = state
        .db_path
        .parent()
        .map(|path| path.join("playwright-hypeddit-profile"))
        .ok_or_else(|| "Impossible de localiser le dossier app data pour le profil navigateur.".to_string())?;
    std::fs::create_dir_all(&browser_profile_dir)
        .map_err(|error| format!("Impossible de préparer le profil navigateur Hypeddit: {error}"))?;

    let mut child = Command::new("node")
        .arg(script_path)
        .arg(hypeddit_url_trimmed)
        .arg(folder.to_string_lossy().to_string())
        .arg(if overwrite_existing { "true" } else { "false" })
        .arg(existing_file_path_trimmed)
        .arg(if hypeddit_headless { "true" } else { "false" })
        .arg(hypeddit_comment)
        .arg(hypeddit_name)
        .arg(hypeddit_email)
        .arg(if hypeddit_preload_app_sessions {
            "true"
        } else {
            "false"
        })
        .arg(if hypeddit_preload_app_sessions {
            "true"
        } else {
            "false"
        })
        .arg(browser_profile_dir.to_string_lossy().to_string())
        .arg(hypeddit_download_start_timeout_seconds.to_string())
        .arg(hypeddit_click_delay_ms.to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .current_dir(project_root)
        .spawn()
        .map_err(|error| format!("Impossible de lancer le download Hypeddit: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossible de lire la sortie du download Hypeddit".to_string())?;
    let reader = BufReader::new(stdout);

    let mut result_payload: Option<String> = None;
    let mut script_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Lecture download Hypeddit impossible: {error}"))?;
        if let Some(value) = line.strip_prefix("__PROGRESS__:") {
            let _ = app.emit(
                "hypeddit-download-progress",
                HypedditDownloadProgressPayload {
                    phase: value.to_string(),
                },
            );
        }
        if let Some(value) = line.strip_prefix("__LOG__:") {
            println!("[hypeddit] {value}");
        }
        if let Some(value) = line.strip_prefix("__ERROR__:") {
            script_error = Some(value.to_string());
        }
        if let Some(value) = line.strip_prefix("__RESULT__:") {
            result_payload = Some(value.to_string());
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Attente download Hypeddit impossible: {error}"))?;

    if !status.success() {
        if let Some(script_error) = script_error {
            return Err(format!("Download Hypeddit en erreur: {script_error}"));
        }
        return Err("Download Hypeddit en erreur".to_string());
    }

    let json_payload = result_payload.ok_or_else(|| "Download Hypeddit sans résultat".to_string())?;
    let mut result: HypedditScriptResult = serde_json::from_str(json_payload.as_str())
        .map_err(|error| format!("Réponse download Hypeddit invalide: {error}"))?;

    let rename_with_soundcloud_title = db::get_download_rename_with_soundcloud_title(&state.db_path)?;
    if rename_with_soundcloud_title {
        let downloaded_path = PathBuf::from(result.file_path.as_str());
        let extension = downloaded_path
            .extension()
            .and_then(|value| value.to_str())
            .filter(|value| !value.trim().is_empty())
            .map(|value| format!(".{value}"))
            .unwrap_or_else(|| ".mp3".to_string());
        let renamed_file_name = format!("{}{}", sanitize_file_stem(track_title.as_str()), extension);
        let renamed_path = folder.join(renamed_file_name);

        if renamed_path != downloaded_path {
            if renamed_path.exists() {
                if overwrite_existing {
                    std::fs::remove_file(&renamed_path)
                        .map_err(|error| format!("Impossible d'écraser le fichier renommé existant: {error}"))?;
                } else {
                    return Err(format!(
                        "Un fichier existe déjà avec le nom SoundCloud cible: {}",
                        renamed_path.display()
                    ));
                }
            }

            std::fs::rename(&downloaded_path, &renamed_path).or_else(|_| {
                std::fs::copy(&downloaded_path, &renamed_path)?;
                std::fs::remove_file(&downloaded_path)
            })
            .map_err(|error| format!("Impossible de renommer le fichier téléchargé: {error}"))?;

            result.file_path = renamed_path.to_string_lossy().to_string();
            result.file_name = renamed_path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.to_string())
                .unwrap_or_else(|| result.file_name.clone());
        }
    }

    let conversion_format = db::get_hypeddit_download_conversion_format(&state.db_path)?;
    if let Some((converted_path, converted_name)) = local_files::convert_audio_file_with_ffmpeg(
        result.file_path.as_str(),
        conversion_format.as_str(),
        overwrite_existing,
    )? {
        result.file_path = converted_path;
        result.file_name = converted_name;
    }

    let embed_cover = db::get_download_embed_cover(&state.db_path)?;
    if embed_cover {
        if let Some(artwork_url) = artwork_url.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
            local_files::embed_cover_into_mp3(result.file_path.as_str(), artwork_url)?;
        }
    }

    db::upsert_playlist_track_file_link_manual(
        &state.db_path,
        playlist_id,
        track_permalink_url.trim(),
        result.file_path.as_str(),
    )?;

    Ok(HypedditDownloadResult {
        file_path: result.file_path,
        file_name: result.file_name,
        overwrote_existing: result.overwrote_existing,
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
        // Explorer does not reliably handle verbatim paths (\\?\...), normalize first.
        let canonical_target = target_path
            .canonicalize()
            .unwrap_or_else(|_| target_path.clone());
        let mut explorer_target = canonical_target.to_string_lossy().replace('/', "\\");
        if let Some(stripped) = explorer_target.strip_prefix("\\\\?\\UNC\\") {
            explorer_target = format!("\\\\{}", stripped);
        } else if let Some(stripped) = explorer_target.strip_prefix("\\\\?\\") {
            explorer_target = stripped.to_string();
        }

        Command::new("explorer.exe")
            .arg("/select,")
            .arg(explorer_target)
            .spawn()
            .map_err(|error| format!("Impossible d'ouvrir Explorer: {error}"))?;
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
fn check_local_file_exists(file_path: String) -> Result<bool, String> {
    let trimmed_path = file_path.trim();
    if trimmed_path.is_empty() {
        return Ok(false);
    }

    let target_path = Path::new(trimmed_path);
    Ok(target_path.exists() && target_path.is_file())
}

#[tauri::command]
fn connect_playwright_profile_session(
    state: State<AppState>,
    provider: String,
) -> Result<(), String> {
    let provider = provider.trim().to_lowercase();
    if provider != "soundcloud" && provider != "spotify" {
        return Err("Provider Playwright invalide (soundcloud ou spotify attendu).".to_string());
    }

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Impossible de localiser la racine du projet".to_string())?
        .to_path_buf();
    let script_path = project_root.join("scripts").join("playwright-session-login.mjs");

    if !script_path.exists() {
        return Err(format!(
            "Script Playwright de connexion introuvable: {}",
            script_path.display()
        ));
    }

    let browser_profile_dir = state
        .db_path
        .parent()
        .map(|path| path.join("playwright-hypeddit-profile"))
        .ok_or_else(|| "Impossible de localiser le dossier app data pour le profil navigateur.".to_string())?;
    std::fs::create_dir_all(&browser_profile_dir)
        .map_err(|error| format!("Impossible de préparer le profil navigateur Playwright: {error}"))?;

    let mut child = Command::new("node")
        .arg(script_path)
        .arg(provider.as_str())
        .arg(browser_profile_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .current_dir(project_root)
        .spawn()
        .map_err(|error| format!("Impossible de lancer la connexion Playwright: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossible de lire la sortie de la connexion Playwright".to_string())?;
    let reader = BufReader::new(stdout);

    let mut result_payload: Option<String> = None;
    let mut script_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Lecture connexion Playwright impossible: {error}"))?;
        if let Some(value) = line.strip_prefix("__LOG__:") {
            println!("[playwright-session] {value}");
        }
        if let Some(value) = line.strip_prefix("__ERROR__:") {
            script_error = Some(value.to_string());
        }
        if let Some(value) = line.strip_prefix("__RESULT__:") {
            result_payload = Some(value.to_string());
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Attente connexion Playwright impossible: {error}"))?;

    if !status.success() {
        if let Some(script_error) = script_error {
            return Err(format!("Connexion Playwright en erreur: {script_error}"));
        }
        return Err("Connexion Playwright en erreur".to_string());
    }

    let json_payload = result_payload.ok_or_else(|| "Connexion Playwright sans résultat".to_string())?;
    let result: PlaywrightSessionLoginResult = serde_json::from_str(json_payload.as_str())
        .map_err(|error| format!("Réponse connexion Playwright invalide: {error}"))?;

    if !result.connected {
        return Err(format!("Connexion Playwright {} incomplète.", result.provider));
    }

    Ok(())
}

#[tauri::command]
fn get_playwright_profile_session_status(
    state: State<AppState>,
    provider: String,
) -> Result<bool, String> {
    let provider = provider.trim().to_lowercase();
    if provider != "soundcloud" && provider != "spotify" {
        return Err("Provider Playwright invalide (soundcloud ou spotify attendu).".to_string());
    }

    let project_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Impossible de localiser la racine du projet".to_string())?
        .to_path_buf();
    let script_path = project_root.join("scripts").join("playwright-session-status.mjs");

    if !script_path.exists() {
        return Err(format!(
            "Script Playwright de status introuvable: {}",
            script_path.display()
        ));
    }

    let browser_profile_dir = state
        .db_path
        .parent()
        .map(|path| path.join("playwright-hypeddit-profile"))
        .ok_or_else(|| "Impossible de localiser le dossier app data pour le profil navigateur.".to_string())?;
    std::fs::create_dir_all(&browser_profile_dir)
        .map_err(|error| format!("Impossible de préparer le profil navigateur Playwright: {error}"))?;

    let mut child = Command::new("node")
        .arg(script_path)
        .arg(provider.as_str())
        .arg(browser_profile_dir.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .current_dir(project_root)
        .spawn()
        .map_err(|error| format!("Impossible de lancer la vérification Playwright: {error}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Impossible de lire la sortie de la vérification Playwright".to_string())?;
    let reader = BufReader::new(stdout);

    let mut result_payload: Option<String> = None;
    let mut script_error: Option<String> = None;

    for line in reader.lines() {
        let line = line.map_err(|error| format!("Lecture vérification Playwright impossible: {error}"))?;
        if let Some(value) = line.strip_prefix("__LOG__:") {
            println!("[playwright-session-status] {value}");
        }
        if let Some(value) = line.strip_prefix("__ERROR__:") {
            script_error = Some(value.to_string());
        }
        if let Some(value) = line.strip_prefix("__RESULT__:") {
            result_payload = Some(value.to_string());
        }
    }

    let status = child
        .wait()
        .map_err(|error| format!("Attente vérification Playwright impossible: {error}"))?;

    if !status.success() {
        if let Some(script_error) = script_error {
            return Err(format!("Vérification Playwright en erreur: {script_error}"));
        }
        return Err("Vérification Playwright en erreur".to_string());
    }

    let json_payload = result_payload.ok_or_else(|| "Vérification Playwright sans résultat".to_string())?;
    let result: PlaywrightSessionStatusResult = serde_json::from_str(json_payload.as_str())
        .map_err(|error| format!("Réponse vérification Playwright invalide: {error}"))?;

    if result.provider.trim().to_lowercase() != provider {
        return Err("Réponse Playwright incohérente sur le provider demandé".to_string());
    }

    Ok(result.connected)
}

#[tauri::command]
fn get_debug_settings(state: State<AppState>) -> Result<DebugSettings, String> {
    Ok(DebugSettings {
        soundcloud_fallback_headless: db::get_soundcloud_fallback_headless(&state.db_path)?,
        logs_enabled: db::get_logs_enabled(&state.db_path)?,
        hypeddit_click_delay_ms: db::get_hypeddit_click_delay_ms(&state.db_path)?,
        hypeddit_preload_app_sessions: db::get_hypeddit_preload_app_sessions(&state.db_path)?,
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
fn set_hypeddit_click_delay_ms(state: State<AppState>, milliseconds: i64) -> Result<(), String> {
    db::set_hypeddit_click_delay_ms(&state.db_path, milliseconds)
}

#[tauri::command]
fn set_hypeddit_preload_app_sessions(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_hypeddit_preload_app_sessions(&state.db_path, enabled)
}

#[tauri::command]
fn get_misc_settings(state: State<AppState>) -> Result<MiscSettings, String> {
    Ok(MiscSettings {
        playlist_cover_mode: db::get_playlist_cover_mode(&state.db_path)?,
        download_embed_cover: db::get_download_embed_cover(&state.db_path)?,
        download_rename_with_soundcloud_title: db::get_download_rename_with_soundcloud_title(
            &state.db_path,
        )?,
        hypeddit_download_conversion_format: db::get_hypeddit_download_conversion_format(&state.db_path)?,
        analysis_auto_apply_frequency_max: db::get_analysis_auto_apply_frequency_max(&state.db_path)?,
        hypeddit_download_headless: db::get_hypeddit_download_headless(&state.db_path)?,
        hypeddit_download_comment: db::get_hypeddit_download_comment(&state.db_path)?,
        hypeddit_download_name: db::get_hypeddit_download_name(&state.db_path)?,
        hypeddit_download_email: db::get_hypeddit_download_email(&state.db_path)?,
        hypeddit_download_start_timeout_seconds: db::get_hypeddit_download_start_timeout_seconds(&state.db_path)?,
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
fn set_hypeddit_download_conversion_format(state: State<AppState>, format: String) -> Result<(), String> {
    db::set_hypeddit_download_conversion_format(&state.db_path, format.as_str())
}

#[tauri::command]
fn set_analysis_auto_apply_frequency_max(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_analysis_auto_apply_frequency_max(&state.db_path, enabled)
}

#[tauri::command]
fn set_hypeddit_download_headless(state: State<AppState>, enabled: bool) -> Result<(), String> {
    db::set_hypeddit_download_headless(&state.db_path, enabled)
}

#[tauri::command]
fn set_hypeddit_download_comment(state: State<AppState>, comment: String) -> Result<(), String> {
    db::set_hypeddit_download_comment(&state.db_path, comment.as_str())
}

#[tauri::command]
fn set_hypeddit_download_name(state: State<AppState>, name: String) -> Result<(), String> {
    db::set_hypeddit_download_name(&state.db_path, name.as_str())
}

#[tauri::command]
fn set_hypeddit_download_email(state: State<AppState>, email: String) -> Result<(), String> {
    db::set_hypeddit_download_email(&state.db_path, email.as_str())
}

#[tauri::command]
fn set_hypeddit_download_start_timeout_seconds(state: State<AppState>, seconds: i64) -> Result<(), String> {
    db::set_hypeddit_download_start_timeout_seconds(&state.db_path, seconds)
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
            disconnect_soundcloud,
            disconnect_spotify,
            start_soundcloud_auth,
            start_spotify_auth,
            complete_soundcloud_auth,
            complete_spotify_auth,
            get_playlists,
            sync_soundcloud_playlists,
            get_playlist_details,
            get_playlist_details_with_fallback,
            get_playlist_track_local_file_info,
            get_playlist_local_folder_association,
            scan_playlist_local_files,
            dissociate_playlist_local_folder,
            associate_playlist_track_local_file,
            dissociate_playlist_track_local_file,
            move_track_between_playlists,
            embed_local_mp3_cover,
            download_track_cover,
            export_local_spectrogram_jpg,
            generate_local_spectrogram_preview,
            delete_local_spectrogram_preview,
            save_playlist_track_cutoff_analysis,
            analyze_playlist_local_audio_quality,
            download_hypeddit_track_to_local_folder,
            reveal_local_file_in_explorer,
            check_local_file_exists,
            connect_playwright_profile_session,
            get_playwright_profile_session_status,
            get_debug_settings,
            set_soundcloud_fallback_headless,
            set_logs_enabled,
            set_hypeddit_click_delay_ms,
            set_hypeddit_preload_app_sessions,
            get_misc_settings,
            set_playlist_cover_mode,
            set_download_embed_cover,
            set_download_rename_with_soundcloud_title,
            set_hypeddit_download_conversion_format,
            set_analysis_auto_apply_frequency_max,
            set_hypeddit_download_headless,
            set_hypeddit_download_comment,
            set_hypeddit_download_name,
            set_hypeddit_download_email,
            set_hypeddit_download_start_timeout_seconds
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
