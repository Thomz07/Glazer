use std::path::{Path, PathBuf};
use std::collections::HashSet;

use rusqlite::{params, Connection};

use crate::local_files::{analyze_file_cutoff_hz, extract_local_metadata_fast, is_supported_audio_file, normalize_soundcloud_url, quality_label_from_max_frequency, ScannedAudioFile};
use crate::models::{LocalAudioFileInfo, Playlist, PlaylistTrack};

pub struct PlaylistGlobalAudioAnalysisStats {
    pub analyzed_tracks: usize,
    pub updated_tracks: usize,
    pub skipped_tracks: usize,
    pub failed_tracks: usize,
}

fn open_connection(db_path: &Path) -> Result<Connection, String> {
    Connection::open(db_path).map_err(|error| error.to_string())
}

pub fn init_database(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }

    let connection = open_connection(db_path)?;
    connection
        .execute_batch(
            "
            CREATE TABLE IF NOT EXISTS soundcloud_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                client_id TEXT NOT NULL,
                redirect_uri TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS soundcloud_tokens (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS spotify_tokens (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at INTEGER,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlists (
                id INTEGER PRIMARY KEY,
                title TEXT NOT NULL,
                track_count INTEGER NOT NULL,
                is_private INTEGER NOT NULL DEFAULT 0,
                artwork_url TEXT
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_folder_links (
                playlist_id INTEGER PRIMARY KEY,
                folder_path TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS playlist_track_file_links (
                playlist_id INTEGER NOT NULL,
                soundcloud_url TEXT NOT NULL,
                file_path TEXT NOT NULL,
                file_name TEXT NOT NULL,
                file_size_bytes INTEGER,
                modified_at INTEGER,
                local_cover_data_url TEXT,
                local_title TEXT,
                local_artist TEXT,
                local_duration_seconds INTEGER,
                local_format TEXT,
                local_bitrate_kbps INTEGER,
                local_bitrate_announced_kbps INTEGER,
                local_bitrate_real_kbps INTEGER,
                local_max_frequency_hz INTEGER,
                local_quality_label TEXT,
                local_sample_rate_hz INTEGER,
                local_channels INTEGER,
                scanned_at INTEGER NOT NULL,
                PRIMARY KEY (playlist_id, soundcloud_url)
            );
            ",
        )
        .map_err(|error| error.to_string())?;

    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_cover_data_url",
        "TEXT",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_title",
        "TEXT",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_artist",
        "TEXT",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_duration_seconds",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_format",
        "TEXT",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_bitrate_kbps",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_bitrate_announced_kbps",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_bitrate_real_kbps",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_max_frequency_hz",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_quality_label",
        "TEXT",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_sample_rate_hz",
        "INTEGER",
    )?;
    ensure_table_column(
        &connection,
        "playlist_track_file_links",
        "local_channels",
        "INTEGER",
    )?;

    Ok(())
}

fn ensure_table_column(
    connection: &Connection,
    table_name: &str,
    column_name: &str,
    column_definition: &str,
) -> Result<(), String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA table_info({table_name})"))
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;

    let mut has_column = false;
    for row in rows {
        let existing = row.map_err(|error| error.to_string())?;
        if existing == column_name {
            has_column = true;
            break;
        }
    }

    if !has_column {
        connection
            .execute(
                &format!(
                    "ALTER TABLE {table_name} ADD COLUMN {column_name} {column_definition}"
                ),
                [],
            )
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub fn save_soundcloud_tokens(
    db_path: &Path,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at: Option<i64>,
) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    connection
        .execute(
            "
            INSERT INTO soundcloud_tokens (id, access_token, refresh_token, expires_at, updated_at)
            VALUES (1, ?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at
            ",
            params![access_token, refresh_token, expires_at, updated_at],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_access_token(db_path: &Path) -> Result<Option<String>, String> {
    let connection = open_connection(db_path)?;
    let token = connection
        .query_row(
            "SELECT access_token FROM soundcloud_tokens WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(token)
}

pub fn save_spotify_tokens(
    db_path: &Path,
    access_token: &str,
    refresh_token: Option<&str>,
    expires_at: Option<i64>,
) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    connection
        .execute(
            "
            INSERT INTO spotify_tokens (id, access_token, refresh_token, expires_at, updated_at)
            VALUES (1, ?1, ?2, ?3, ?4)
            ON CONFLICT(id) DO UPDATE SET
                access_token = excluded.access_token,
                refresh_token = excluded.refresh_token,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at
            ",
            params![access_token, refresh_token, expires_at, updated_at],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_spotify_access_token(db_path: &Path) -> Result<Option<String>, String> {
    let connection = open_connection(db_path)?;
    let token = connection
        .query_row(
            "SELECT access_token FROM spotify_tokens WHERE id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();
    Ok(token)
}

pub fn has_spotify_access_token(db_path: &Path) -> Result<bool, String> {
    Ok(get_spotify_access_token(db_path)?.is_some())
}

pub fn has_access_token(db_path: &Path) -> Result<bool, String> {
    Ok(get_access_token(db_path)?.is_some())
}

pub fn clear_soundcloud_tokens(db_path: &Path) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute("DELETE FROM soundcloud_tokens WHERE id = 1", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn clear_spotify_tokens(db_path: &Path) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute("DELETE FROM spotify_tokens WHERE id = 1", [])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn replace_playlists(db_path: &Path, playlists: &[Playlist]) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    transaction
        .execute("DELETE FROM playlists", [])
        .map_err(|error| error.to_string())?;

    for playlist in playlists {
        transaction
            .execute(
                "
                INSERT INTO playlists (id, title, track_count, is_private, artwork_url)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ",
                params![
                    playlist.id,
                    playlist.title,
                    playlist.track_count,
                    if playlist.is_private { 1 } else { 0 },
                    playlist.artwork_url
                ],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn list_playlists(db_path: &Path) -> Result<Vec<Playlist>, String> {
    let connection = open_connection(db_path)?;
    let mut statement = connection
        .prepare(
            "
            SELECT
                p.id,
                p.title,
                p.track_count,
                p.is_private,
                p.artwork_url,
                EXISTS(
                    SELECT 1
                    FROM playlist_folder_links pfl
                    WHERE pfl.playlist_id = p.id
                ) AS has_local_folder,
                (
                    EXISTS(
                        SELECT 1
                        FROM playlist_folder_links pfl
                        WHERE pfl.playlist_id = p.id
                    ) OR EXISTS(
                        SELECT 1
                        FROM playlist_track_file_links ptfl
                        WHERE ptfl.playlist_id = p.id
                    )
                ) AS has_local_link
            FROM playlists p
            ORDER BY title COLLATE NOCASE ASC
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map([], |row| {
            Ok(Playlist {
                id: row.get(0)?,
                title: row.get(1)?,
                track_count: row.get(2)?,
                is_private: row.get::<_, i64>(3)? == 1,
                artwork_url: row.get(4)?,
                has_local_folder: row.get::<_, i64>(5)? == 1,
                has_local_link: row.get::<_, i64>(6)? == 1,
            })
        })
        .map_err(|error| error.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}
pub fn database_path(app_data_dir: PathBuf) -> PathBuf {
    app_data_dir.join("glazer.sqlite")
}

pub fn get_soundcloud_fallback_headless(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'soundcloud_fallback_headless'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(true))
}

pub fn get_logs_enabled(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'logs_enabled'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(true))
}

pub fn set_soundcloud_fallback_headless(db_path: &Path, headless: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('soundcloud_fallback_headless', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if headless { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn set_logs_enabled(db_path: &Path, enabled: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('logs_enabled', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if enabled { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_playlist_cover_mode(db_path: &Path) -> Result<String, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'playlist_cover_mode'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(match value.as_deref() {
        Some("random") => "random".to_string(),
        _ => "first".to_string(),
    })
}

pub fn set_playlist_cover_mode(db_path: &Path, mode: &str) -> Result<(), String> {
    let normalized_mode = match mode {
        "random" => "random",
        _ => "first",
    };

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('playlist_cover_mode', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![normalized_mode],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_download_embed_cover(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'download_embed_cover'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(false))
}

pub fn set_download_embed_cover(db_path: &Path, enabled: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('download_embed_cover', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if enabled { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_download_rename_with_soundcloud_title(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'download_rename_with_soundcloud_title'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(false))
}

pub fn set_download_rename_with_soundcloud_title(db_path: &Path, enabled: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('download_rename_with_soundcloud_title', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if enabled { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_analysis_auto_apply_frequency_max(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'analysis_auto_apply_frequency_max'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(true))
}

pub fn set_analysis_auto_apply_frequency_max(db_path: &Path, enabled: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('analysis_auto_apply_frequency_max', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if enabled { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_hypeddit_download_headless(db_path: &Path) -> Result<bool, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'hypeddit_download_headless'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(value
        .map(|item| item.eq_ignore_ascii_case("true") || item == "1")
        .unwrap_or(true))
}

pub fn set_hypeddit_download_headless(db_path: &Path, enabled: bool) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('hypeddit_download_headless', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![if enabled { "true" } else { "false" }],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_hypeddit_download_comment(db_path: &Path) -> Result<String, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'hypeddit_download_comment'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let normalized = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "Nice tune!".to_string());

    Ok(normalized)
}

pub fn set_hypeddit_download_comment(db_path: &Path, comment: &str) -> Result<(), String> {
    let normalized = if comment.trim().is_empty() {
        "Nice tune!".to_string()
    } else {
        comment.trim().to_string()
    };

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('hypeddit_download_comment', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![normalized],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_hypeddit_download_name(db_path: &Path) -> Result<String, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'hypeddit_download_name'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let normalized = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "Jojo".to_string());

    Ok(normalized)
}

pub fn set_hypeddit_download_name(db_path: &Path, name: &str) -> Result<(), String> {
    let normalized = if name.trim().is_empty() {
        "Jojo".to_string()
    } else {
        name.trim().to_string()
    };

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('hypeddit_download_name', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![normalized],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_hypeddit_download_email(db_path: &Path) -> Result<String, String> {
    let connection = open_connection(db_path)?;
    let value = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = 'hypeddit_download_email'",
            [],
            |row| row.get::<_, String>(0),
        )
        .ok();

    let normalized = value
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .unwrap_or_else(|| "jouch@hippo.com".to_string());

    Ok(normalized)
}

pub fn set_hypeddit_download_email(db_path: &Path, email: &str) -> Result<(), String> {
    let normalized = if email.trim().is_empty() {
        "jouch@hippo.com".to_string()
    } else {
        email.trim().to_string()
    };

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO app_settings (key, value)
            VALUES ('hypeddit_download_email', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            ",
            params![normalized],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn save_playlist_folder_link(db_path: &Path, playlist_id: i64, folder_path: &str) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    let updated_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    connection
        .execute(
            "
            INSERT INTO playlist_folder_links (playlist_id, folder_path, updated_at)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(playlist_id) DO UPDATE SET
                folder_path = excluded.folder_path,
                updated_at = excluded.updated_at
            ",
            params![playlist_id, folder_path, updated_at],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_playlist_folder_link(db_path: &Path, playlist_id: i64) -> Result<Option<String>, String> {
    let connection = open_connection(db_path)?;
    let folder = connection
        .query_row(
            "SELECT folder_path FROM playlist_folder_links WHERE playlist_id = ?1",
            params![playlist_id],
            |row| row.get::<_, String>(0),
        )
        .ok();

    Ok(folder)
}

pub fn dissociate_playlist_folder_link(db_path: &Path, playlist_id: i64) -> Result<(), String> {
    let connection = open_connection(db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "DELETE FROM playlist_folder_links WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "DELETE FROM playlist_track_file_links WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| error.to_string())?;

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(())
}

pub fn replace_playlist_track_file_links(
    db_path: &Path,
    playlist_id: i64,
    files: &[ScannedAudioFile],
) -> Result<usize, String> {
    let connection = open_connection(db_path)?;
    let scanned_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    transaction
        .execute(
            "DELETE FROM playlist_track_file_links WHERE playlist_id = ?1",
            params![playlist_id],
        )
        .map_err(|error| error.to_string())?;

    let mut inserted = 0usize;
    let mut seen_soundcloud_urls: HashSet<String> = HashSet::new();
    for file in files {
        let Some(soundcloud_url) = file.matched_soundcloud_url.as_deref() else {
            continue;
        };

        if !seen_soundcloud_urls.insert(soundcloud_url.to_string()) {
            continue;
        }

        transaction
            .execute(
                "
                INSERT INTO playlist_track_file_links (
                    playlist_id,
                    soundcloud_url,
                    file_path,
                    file_name,
                    file_size_bytes,
                    modified_at,
                    local_cover_data_url,
                    local_title,
                    local_artist,
                    local_duration_seconds,
                    local_format,
                    local_bitrate_kbps,
                    local_bitrate_announced_kbps,
                    local_bitrate_real_kbps,
                    local_max_frequency_hz,
                    local_quality_label,
                    local_sample_rate_hz,
                    local_channels,
                    scanned_at
                )
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
                ",
                params![
                    playlist_id,
                    soundcloud_url,
                    &file.file_path,
                    &file.file_name,
                    file.file_size_bytes,
                    file.modified_at,
                    &file.local_cover_data_url,
                    &file.local_title,
                    &file.local_artist,
                    file.local_duration_seconds,
                    &file.local_format,
                    file.local_bitrate_kbps,
                    file.local_bitrate_announced_kbps,
                    file.local_bitrate_real_kbps,
                    file.local_max_frequency_hz,
                    &file.local_quality_label,
                    file.local_sample_rate_hz,
                    file.local_channels,
                    scanned_at
                ],
            )
            .map_err(|error| error.to_string())?;

        inserted += 1;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(inserted)
}

pub fn upsert_playlist_track_file_link_manual(
    db_path: &Path,
    playlist_id: i64,
    track_permalink_url: &str,
    file_path: &str,
) -> Result<(), String> {
    let trimmed_file_path = file_path.trim();
    if trimmed_file_path.is_empty() {
        return Err("Chemin du fichier local invalide.".to_string());
    }

    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud de la track invalide.".to_string())?;

    let linked_folder = get_playlist_folder_link(db_path, playlist_id)?
        .ok_or_else(|| "Aucun dossier local associe a cette playlist.".to_string())?;
    let linked_folder_trimmed = linked_folder.trim();
    if linked_folder_trimmed.is_empty() {
        return Err("Dossier local associe invalide.".to_string());
    }

    let linked_folder_path = Path::new(linked_folder_trimmed);
    if !linked_folder_path.exists() || !linked_folder_path.is_dir() {
        return Err("Dossier local associe introuvable.".to_string());
    }

    let file_path_obj = Path::new(trimmed_file_path);
    if !file_path_obj.exists() || !file_path_obj.is_file() {
        return Err("Fichier local introuvable.".to_string());
    }
    if !is_supported_audio_file(file_path_obj) {
        return Err("Association refusee: seuls les fichiers audio sont autorises.".to_string());
    }

    let canonical_folder = linked_folder_path
        .canonicalize()
        .map_err(|error| format!("Impossible de lire le dossier local associe: {error}"))?;
    let canonical_file = file_path_obj
        .canonicalize()
        .map_err(|error| format!("Impossible de lire le fichier local: {error}"))?;

    if !canonical_file.starts_with(&canonical_folder) {
        return Err(
            "Association refusee: le fichier doit se trouver dans le dossier local associe a la playlist."
                .to_string(),
        );
    }

    let metadata = std::fs::metadata(file_path_obj).map_err(|error| error.to_string())?;
    let file_size_bytes = Some(metadata.len() as i64);
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|timestamp| timestamp.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_secs() as i64);
    let file_name = file_path_obj
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| trimmed_file_path.to_string());

    let extracted = extract_local_metadata_fast(trimmed_file_path, Some(&file_name), file_size_bytes);
    let scanned_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs() as i64;

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            INSERT INTO playlist_track_file_links (
                playlist_id,
                soundcloud_url,
                file_path,
                file_name,
                file_size_bytes,
                modified_at,
                local_cover_data_url,
                local_title,
                local_artist,
                local_duration_seconds,
                local_format,
                local_bitrate_kbps,
                local_bitrate_announced_kbps,
                local_bitrate_real_kbps,
                local_max_frequency_hz,
                local_quality_label,
                local_sample_rate_hz,
                local_channels,
                scanned_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
            ON CONFLICT(playlist_id, soundcloud_url) DO UPDATE SET
                file_path = excluded.file_path,
                file_name = excluded.file_name,
                file_size_bytes = excluded.file_size_bytes,
                modified_at = excluded.modified_at,
                local_cover_data_url = excluded.local_cover_data_url,
                local_title = excluded.local_title,
                local_artist = excluded.local_artist,
                local_duration_seconds = excluded.local_duration_seconds,
                local_format = excluded.local_format,
                local_bitrate_kbps = excluded.local_bitrate_kbps,
                local_bitrate_announced_kbps = excluded.local_bitrate_announced_kbps,
                local_bitrate_real_kbps = excluded.local_bitrate_real_kbps,
                local_max_frequency_hz = excluded.local_max_frequency_hz,
                local_quality_label = excluded.local_quality_label,
                local_sample_rate_hz = excluded.local_sample_rate_hz,
                local_channels = excluded.local_channels,
                scanned_at = excluded.scanned_at
            ",
            params![
                playlist_id,
                normalized_url,
                trimmed_file_path,
                file_name,
                file_size_bytes,
                modified_at,
                extracted.local_cover_data_url,
                extracted.local_title,
                extracted.local_artist,
                extracted.local_duration_seconds,
                extracted.local_format,
                extracted.local_bitrate_kbps,
                extracted.local_bitrate_announced_kbps,
                extracted.local_bitrate_real_kbps,
                extracted.local_max_frequency_hz,
                extracted.local_quality_label,
                extracted.local_sample_rate_hz,
                extracted.local_channels,
                scanned_at
            ],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn dissociate_playlist_track_local_file(
    db_path: &Path,
    playlist_id: i64,
    track_permalink_url: &str,
) -> Result<(), String> {
    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud de la track invalide.".to_string())?;

    let connection = open_connection(db_path)?;
    connection
        .execute(
            "
            DELETE FROM playlist_track_file_links
            WHERE playlist_id = ?1 AND soundcloud_url = ?2
            ",
            params![playlist_id, normalized_url],
        )
        .map_err(|error| error.to_string())?;

    Ok(())
}

pub fn get_playlist_track_local_file_link_info(
    db_path: &Path,
    playlist_id: i64,
    track_permalink_url: &str,
) -> Result<Option<(String, String)>, String> {
    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud de la track invalide.".to_string())?;

    let connection = open_connection(db_path)?;
    let result = connection
        .query_row(
            "
            SELECT file_path, file_name
            FROM playlist_track_file_links
            WHERE playlist_id = ?1 AND soundcloud_url = ?2
            LIMIT 1
            ",
            params![playlist_id, normalized_url],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    Ok(result)
}

pub fn get_playlist_track_local_file_link_info_by_file_path(
    db_path: &Path,
    playlist_id: i64,
    file_path: &str,
) -> Result<Option<(String, String)>, String> {
    let normalized_file_path = file_path.trim();
    if normalized_file_path.is_empty() {
        return Ok(None);
    }

    let connection = open_connection(db_path)?;
    let result = connection
        .query_row(
            "
            SELECT file_path, file_name
            FROM playlist_track_file_links
            WHERE playlist_id = ?1 AND file_path = ?2
            LIMIT 1
            ",
            params![playlist_id, normalized_file_path],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .ok();

    Ok(result)
}

pub fn move_playlist_track_local_file_link(
    db_path: &Path,
    source_playlist_id: i64,
    target_playlist_id: i64,
    track_permalink_url: &str,
    new_file_path: Option<&str>,
    new_file_name: Option<&str>,
) -> Result<bool, String> {
    if source_playlist_id == target_playlist_id {
        return Ok(false);
    }

    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud de la track invalide.".to_string())?;

    let connection = open_connection(db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    let moved = transaction
        .execute(
            "
            INSERT INTO playlist_track_file_links (
                playlist_id,
                soundcloud_url,
                file_path,
                file_name,
                file_size_bytes,
                modified_at,
                local_cover_data_url,
                local_title,
                local_artist,
                local_duration_seconds,
                local_format,
                local_bitrate_kbps,
                local_bitrate_announced_kbps,
                local_bitrate_real_kbps,
                local_max_frequency_hz,
                local_quality_label,
                local_sample_rate_hz,
                local_channels,
                scanned_at
            )
            SELECT
                ?3,
                soundcloud_url,
                COALESCE(?4, file_path),
                COALESCE(?5, file_name),
                file_size_bytes,
                modified_at,
                local_cover_data_url,
                local_title,
                local_artist,
                local_duration_seconds,
                local_format,
                local_bitrate_kbps,
                local_bitrate_announced_kbps,
                local_bitrate_real_kbps,
                local_max_frequency_hz,
                local_quality_label,
                local_sample_rate_hz,
                local_channels,
                scanned_at
            FROM playlist_track_file_links
            WHERE playlist_id = ?1 AND soundcloud_url = ?2
            ON CONFLICT(playlist_id, soundcloud_url) DO UPDATE SET
                file_path = excluded.file_path,
                file_name = excluded.file_name,
                file_size_bytes = excluded.file_size_bytes,
                modified_at = excluded.modified_at,
                local_cover_data_url = excluded.local_cover_data_url,
                local_title = excluded.local_title,
                local_artist = excluded.local_artist,
                local_duration_seconds = excluded.local_duration_seconds,
                local_format = excluded.local_format,
                local_bitrate_kbps = excluded.local_bitrate_kbps,
                local_bitrate_announced_kbps = excluded.local_bitrate_announced_kbps,
                local_bitrate_real_kbps = excluded.local_bitrate_real_kbps,
                local_max_frequency_hz = excluded.local_max_frequency_hz,
                local_quality_label = excluded.local_quality_label,
                local_sample_rate_hz = excluded.local_sample_rate_hz,
                local_channels = excluded.local_channels,
                scanned_at = excluded.scanned_at
            ",
            params![
                source_playlist_id,
                normalized_url,
                target_playlist_id,
                new_file_path,
                new_file_name,
            ],
        )
        .map_err(|error| error.to_string())?;

    if moved > 0 {
        transaction
            .execute(
                "
                DELETE FROM playlist_track_file_links
                WHERE playlist_id = ?1 AND soundcloud_url = ?2
                ",
                params![source_playlist_id, normalized_url],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(moved > 0)
}

pub fn move_playlist_track_local_file_link_by_file_path(
    db_path: &Path,
    source_playlist_id: i64,
    target_playlist_id: i64,
    source_file_path: &str,
    new_file_path: Option<&str>,
    new_file_name: Option<&str>,
) -> Result<bool, String> {
    if source_playlist_id == target_playlist_id {
        return Ok(false);
    }

    let normalized_source_file_path = source_file_path.trim();
    if normalized_source_file_path.is_empty() {
        return Ok(false);
    }

    let connection = open_connection(db_path)?;
    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    let moved = transaction
        .execute(
            "
            INSERT INTO playlist_track_file_links (
                playlist_id,
                soundcloud_url,
                file_path,
                file_name,
                file_size_bytes,
                modified_at,
                local_cover_data_url,
                local_title,
                local_artist,
                local_duration_seconds,
                local_format,
                local_bitrate_kbps,
                local_bitrate_announced_kbps,
                local_bitrate_real_kbps,
                local_max_frequency_hz,
                local_quality_label,
                local_sample_rate_hz,
                local_channels,
                scanned_at
            )
            SELECT
                ?3,
                soundcloud_url,
                COALESCE(?4, file_path),
                COALESCE(?5, file_name),
                file_size_bytes,
                modified_at,
                local_cover_data_url,
                local_title,
                local_artist,
                local_duration_seconds,
                local_format,
                local_bitrate_kbps,
                local_bitrate_announced_kbps,
                local_bitrate_real_kbps,
                local_max_frequency_hz,
                local_quality_label,
                local_sample_rate_hz,
                local_channels,
                scanned_at
            FROM playlist_track_file_links
            WHERE playlist_id = ?1 AND file_path = ?2
            ON CONFLICT(playlist_id, soundcloud_url) DO UPDATE SET
                file_path = excluded.file_path,
                file_name = excluded.file_name,
                file_size_bytes = excluded.file_size_bytes,
                modified_at = excluded.modified_at,
                local_cover_data_url = excluded.local_cover_data_url,
                local_title = excluded.local_title,
                local_artist = excluded.local_artist,
                local_duration_seconds = excluded.local_duration_seconds,
                local_format = excluded.local_format,
                local_bitrate_kbps = excluded.local_bitrate_kbps,
                local_bitrate_announced_kbps = excluded.local_bitrate_announced_kbps,
                local_bitrate_real_kbps = excluded.local_bitrate_real_kbps,
                local_max_frequency_hz = excluded.local_max_frequency_hz,
                local_quality_label = excluded.local_quality_label,
                local_sample_rate_hz = excluded.local_sample_rate_hz,
                local_channels = excluded.local_channels,
                scanned_at = excluded.scanned_at
            ",
            params![
                source_playlist_id,
                normalized_source_file_path,
                target_playlist_id,
                new_file_path,
                new_file_name,
            ],
        )
        .map_err(|error| error.to_string())?;

    if moved > 0 {
        transaction
            .execute(
                "
                DELETE FROM playlist_track_file_links
                WHERE playlist_id = ?1 AND file_path = ?2
                ",
                params![source_playlist_id, normalized_source_file_path],
            )
            .map_err(|error| error.to_string())?;
    }

    transaction.commit().map_err(|error| error.to_string())?;
    Ok(moved > 0)
}

pub fn update_playlist_track_cutoff_analysis(
    db_path: &Path,
    playlist_id: i64,
    track_permalink_url: &str,
    cutoff_hz: Option<i64>,
) -> Result<(Option<i64>, Option<String>), String> {
    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud de la track invalide.".to_string())?;

    let normalized_cutoff_hz = cutoff_hz
        .filter(|value| *value > 0)
        .map(|value| ((value / 100) * 100).max(100));
    let quality_label = quality_label_from_max_frequency(normalized_cutoff_hz);

    let connection = open_connection(db_path)?;
    let rows = connection
        .execute(
            "
            UPDATE playlist_track_file_links
            SET
                local_max_frequency_hz = ?3,
                local_quality_label = ?4
            WHERE playlist_id = ?1 AND soundcloud_url = ?2
            ",
            params![
                playlist_id,
                normalized_url,
                normalized_cutoff_hz,
                quality_label.clone(),
            ],
        )
        .map_err(|error| error.to_string())?;

    if rows == 0 {
        return Err("Aucun fichier local associé à cette track.".to_string());
    }

    Ok((normalized_cutoff_hz, quality_label))
}

pub fn analyze_playlist_local_audio_quality(
    db_path: &Path,
    playlist_id: i64,
    analysis_scope: &str,
    overwrite_existing: bool,
) -> Result<PlaylistGlobalAudioAnalysisStats, String> {
    let connection = open_connection(db_path)?;

    let mut statement = connection
        .prepare(
            "
            SELECT soundcloud_url, file_path, local_max_frequency_hz
            FROM playlist_track_file_links
            WHERE playlist_id = ?1
            ",
        )
        .map_err(|error| error.to_string())?;

    let rows = statement
        .query_map(params![playlist_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<i64>>(2)?,
            ))
        })
        .map_err(|error| error.to_string())?;

    let entries = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;

    let transaction = connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;

    let mut analyzed_tracks = 0usize;
    let mut updated_tracks = 0usize;
    let mut skipped_tracks = 0usize;
    let mut failed_tracks = 0usize;

    for (soundcloud_url, file_path, existing_max_frequency_hz) in entries {
        if file_path.trim().is_empty() || !Path::new(&file_path).exists() {
            skipped_tracks += 1;
            continue;
        }

        if !overwrite_existing && existing_max_frequency_hz.unwrap_or(0) > 0 {
            skipped_tracks += 1;
            continue;
        }

        analyzed_tracks += 1;
        let cutoff_hz = match analyze_file_cutoff_hz(&file_path, analysis_scope) {
            Ok(value) => value,
            Err(_) => {
                failed_tracks += 1;
                continue;
            }
        };

        let normalized_cutoff_hz = cutoff_hz
            .filter(|value| *value > 0)
            .map(|value| ((value / 100) * 100).max(100));
        let quality_label = quality_label_from_max_frequency(normalized_cutoff_hz);

        let updated = transaction
            .execute(
                "
                UPDATE playlist_track_file_links
                SET
                    local_max_frequency_hz = ?3,
                    local_quality_label = ?4
                WHERE playlist_id = ?1 AND soundcloud_url = ?2
                ",
                params![
                    playlist_id,
                    soundcloud_url,
                    normalized_cutoff_hz,
                    quality_label,
                ],
            )
            .map_err(|error| error.to_string())?;

        if updated > 0 {
            updated_tracks += 1;
        }
    }

    transaction.commit().map_err(|error| error.to_string())?;

    Ok(PlaylistGlobalAudioAnalysisStats {
        analyzed_tracks,
        updated_tracks,
        skipped_tracks,
        failed_tracks,
    })
}

pub fn attach_local_file_infos(
    db_path: &Path,
    playlist_id: i64,
    tracks: &mut [PlaylistTrack],
) -> Result<(), String> {
    let connection = open_connection(db_path)?;

    for track in tracks.iter_mut() {
        let Some(permalink_url) = normalize_soundcloud_url(track.permalink_url.as_deref()) else {
            continue;
        };

        let file = connection
            .query_row(
                "
                SELECT
                    file_path,
                    file_name,
                    file_size_bytes,
                    modified_at,
                    soundcloud_url,
                    local_cover_data_url,
                    local_title,
                    local_artist,
                    local_duration_seconds,
                    local_format,
                    local_bitrate_kbps,
                    local_bitrate_announced_kbps,
                    local_bitrate_real_kbps,
                    local_max_frequency_hz,
                    local_quality_label,
                    local_sample_rate_hz,
                    local_channels
                FROM playlist_track_file_links
                WHERE playlist_id = ?1 AND soundcloud_url = ?2
                LIMIT 1
                ",
                params![playlist_id, permalink_url],
                |row| {
                    Ok(LocalAudioFileInfo {
                        file_path: row.get(0)?,
                        file_name: row.get(1)?,
                        file_size_bytes: row.get(2)?,
                        modified_at: row.get(3)?,
                        matched_soundcloud_url: row.get(4)?,
                        local_cover_data_url: row.get(5)?,
                        local_title: row.get(6)?,
                        local_artist: row.get(7)?,
                        local_duration_seconds: row.get(8)?,
                        local_format: row.get(9)?,
                        local_bitrate_kbps: row.get(10)?,
                        local_bitrate_announced_kbps: row.get(11)?,
                        local_bitrate_real_kbps: row.get(12)?,
                        local_max_frequency_hz: row.get(13)?,
                        local_quality_label: row.get(14)?,
                        local_sample_rate_hz: row.get(15)?,
                        local_channels: row.get(16)?,
                    })
                },
            )
            .ok();

        let file = file.map(|mut value| {
            if value.local_bitrate_real_kbps.is_none() {
                value.local_bitrate_real_kbps = value.local_bitrate_kbps;
            }

            let has_legacy_format = matches!(
                value.local_format.as_deref(),
                Some("MPEG") | Some("MP4")
            );
            let has_legacy_announced_bitrate = value.local_bitrate_announced_kbps.is_some()
                && value.local_bitrate_announced_kbps == value.local_bitrate_real_kbps;

            if has_legacy_format {
                value.local_format = None;
            }

            if value.local_title.is_none()
                || value.local_artist.is_none()
                || value.local_duration_seconds.is_none()
                || value.local_format.is_none()
                || value.local_max_frequency_hz.is_none()
                || value.local_quality_label.is_none()
                || value.local_bitrate_real_kbps.is_none()
                || value.local_cover_data_url.is_none()
                || has_legacy_announced_bitrate
            {
                let refreshed = extract_local_metadata_fast(&value.file_path, Some(&value.file_name), value.file_size_bytes);

                if value.local_cover_data_url.is_none() {
                    value.local_cover_data_url = refreshed.local_cover_data_url;
                }
                if value.local_title.is_none() {
                    value.local_title = refreshed.local_title;
                }
                if value.local_artist.is_none() {
                    value.local_artist = refreshed.local_artist;
                }
                if value.local_duration_seconds.is_none() {
                    value.local_duration_seconds = refreshed.local_duration_seconds;
                }
                if value.local_format.is_none() {
                    value.local_format = refreshed.local_format;
                }
                if value.local_bitrate_kbps.is_none() {
                    value.local_bitrate_kbps = refreshed.local_bitrate_kbps;
                }
                value.local_bitrate_announced_kbps = refreshed.local_bitrate_announced_kbps;
                if value.local_bitrate_real_kbps.is_none() {
                    value.local_bitrate_real_kbps = refreshed.local_bitrate_real_kbps;
                }
                if value.local_max_frequency_hz.is_none() {
                    value.local_max_frequency_hz = refreshed.local_max_frequency_hz;
                }
                if value.local_quality_label.is_none() {
                    value.local_quality_label = refreshed.local_quality_label;
                }
                if value.local_sample_rate_hz.is_none() {
                    value.local_sample_rate_hz = refreshed.local_sample_rate_hz;
                }
                if value.local_channels.is_none() {
                    value.local_channels = refreshed.local_channels;
                }

                let _ = connection.execute(
                    "
                    UPDATE playlist_track_file_links
                    SET
                        local_cover_data_url = ?3,
                        local_title = ?4,
                        local_artist = ?5,
                        local_duration_seconds = ?6,
                        local_format = ?7,
                        local_bitrate_kbps = ?8,
                        local_bitrate_announced_kbps = ?9,
                        local_bitrate_real_kbps = ?10,
                        local_max_frequency_hz = ?11,
                        local_quality_label = ?12,
                        local_sample_rate_hz = ?13,
                        local_channels = ?14
                    WHERE playlist_id = ?1 AND soundcloud_url = ?2
                    ",
                    params![
                        playlist_id,
                        permalink_url,
                        value.local_cover_data_url,
                        value.local_title,
                        value.local_artist,
                        value.local_duration_seconds,
                        value.local_format,
                        value.local_bitrate_kbps,
                        value.local_bitrate_announced_kbps,
                        value.local_bitrate_real_kbps,
                        value.local_max_frequency_hz,
                        value.local_quality_label,
                        value.local_sample_rate_hz,
                        value.local_channels
                    ],
                );
            }

            value
        });

        track.local_file = file;
    }

    Ok(())
}