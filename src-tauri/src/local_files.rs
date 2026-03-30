use std::path::Path;
use std::process::Command;

use audiotags::Tag;
use base64::Engine;
use id3::frame::{Comment, Picture, PictureType};
use id3::{TagLike, Version};
use image::{DynamicImage, ImageBuffer, Rgb};
use lofty::prelude::{Accessor, AudioFile, TaggedFileExt};
use lofty::probe::Probe;
use mp3_duration;
use regex::Regex;
use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use symphonia::core::audio::{AudioBufferRef, SampleBuffer};
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;
use symphonia::default::{get_codecs, get_probe};
use walkdir::WalkDir;

pub fn embed_cover_into_mp3(file_path: &str, artwork_url: &str) -> Result<(), String> {
    let source = Path::new(file_path);
    if !source.exists() || !source.is_file() {
        return Err(format!("Fichier audio introuvable: {file_path}"));
    }

    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let is_supported = extension == "mp3" || extension == "wav";

    if !is_supported {
        return Err("Cette action est disponible uniquement pour les fichiers MP3 et WAV".to_string());
    }

    let cover_url = artwork_url.trim();
    if cover_url.is_empty() {
        return Err("URL de cover manquante".to_string());
    }

    let response = reqwest::blocking::get(cover_url)
        .map_err(|error| format!("Téléchargement cover impossible: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Téléchargement cover impossible (HTTP {})", response.status()));
    }

    let image_bytes = response
        .bytes()
        .map_err(|error| format!("Lecture cover impossible: {error}"))?
        .to_vec();

    if image_bytes.is_empty() {
        return Err("Cover vide".to_string());
    }

    // Rekordbox is more reliable with JPEG front cover frames and ID3v2.3.
    let decoded_image: DynamicImage = image::load_from_memory(&image_bytes)
        .map_err(|error| format!("Décodage cover impossible: {error}"))?;

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    decoded_image
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg_bytes),
            image::ImageFormat::Jpeg,
        )
        .map_err(|error| format!("Conversion cover JPEG impossible: {error}"))?;

    if jpeg_bytes.is_empty() {
        return Err("Conversion cover JPEG vide".to_string());
    }

    let mut tag = id3::Tag::read_from_path(source).unwrap_or_default();
    tag.remove_all_pictures();
    tag.add_frame(Picture {
        mime_type: "image/jpeg".to_string(),
        picture_type: PictureType::CoverFront,
        description: String::new(),
        data: jpeg_bytes,
    });

    tag.write_to_path(source, Version::Id3v23)
        .map_err(|error| format!("Écriture tag MP3 impossible: {error}"))
}

pub fn write_soundcloud_url_comment_tag(file_path: &str, track_permalink_url: &str) -> Result<(), String> {
    let source = Path::new(file_path);
    if !source.exists() || !source.is_file() {
        return Err(format!("Fichier audio introuvable: {file_path}"));
    }

    let normalized_url = normalize_soundcloud_url(Some(track_permalink_url))
        .ok_or_else(|| "URL SoundCloud invalide pour le tag commentaire.".to_string())?;

    // Legacy compatibility target: the previous script reads COMM frames on MP3 files.
    let extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if extension != "mp3" && extension != "wav" {
        return Ok(());
    }

    let mut tag = id3::Tag::read_from_path(source).unwrap_or_default();
    let _ = tag.remove("COMM");
    tag.add_frame(Comment {
        lang: "eng".to_string(),
        description: "Comment".to_string(),
        text: normalized_url,
    });

    tag.write_to_path(source, Version::Id3v23)
        .map_err(|error| format!("Écriture du tag commentaire impossible: {error}"))
}

pub fn convert_audio_file_with_ffmpeg(
    file_path: &str,
    target_format: &str,
    overwrite_existing: bool,
) -> Result<Option<(String, String)>, String> {
    let source = Path::new(file_path);
    if !source.exists() || !source.is_file() {
        return Err(format!("Fichier audio introuvable: {file_path}"));
    }

    let target = target_format.trim().to_ascii_lowercase();
    if target.is_empty() || target == "original" {
        return Ok(None);
    }

    let supported = ["mp3", "wav", "flac"];
    if !supported.contains(&target.as_str()) {
        return Err(format!("Format de conversion non supporte: {target}"));
    }

    let current_extension = source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    if current_extension == target {
        return Ok(None);
    }

    let output_path = source.with_extension(&target);
    if output_path.exists() {
        if overwrite_existing {
            std::fs::remove_file(&output_path)
                .map_err(|error| format!("Impossible d'ecraser le fichier converti existant: {error}"))?;
        } else {
            return Err(format!(
                "Un fichier converti existe deja: {}",
                output_path.display()
            ));
        }
    }

    let status = Command::new("ffmpeg")
        .arg("-hide_banner")
        .arg("-loglevel")
        .arg("error")
        .arg("-i")
        .arg(source)
        .arg(&output_path)
        .status()
        .map_err(|error| format!("Impossible de lancer ffmpeg: {error}"))?;

    if !status.success() {
        return Err("Conversion audio impossible via ffmpeg.".to_string());
    }

    if !output_path.exists() {
        return Err("Le fichier converti est introuvable apres conversion.".to_string());
    }

    std::fs::remove_file(source)
        .map_err(|error| format!("Impossible de supprimer le fichier source apres conversion: {error}"))?;

    let converted_path = output_path.to_string_lossy().to_string();
    let converted_name = output_path
        .file_name()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| converted_path.clone());

    Ok(Some((converted_path, converted_name)))
}

pub fn download_cover_as_jpeg(artwork_url: &str, output_path: &str) -> Result<String, String> {
    let destination = Path::new(output_path);
    if output_path.trim().is_empty() {
        return Err("Chemin de destination vide".to_string());
    }

    let parent_dir = destination
        .parent()
        .ok_or_else(|| "Dossier de destination introuvable".to_string())?;
    if !parent_dir.exists() {
        return Err(format!("Dossier de destination introuvable: {}", parent_dir.display()));
    }

    let cover_url = artwork_url.trim();
    if cover_url.is_empty() {
        return Err("URL de cover manquante".to_string());
    }

    let response = reqwest::blocking::get(cover_url)
        .map_err(|error| format!("Téléchargement cover impossible: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Téléchargement cover impossible (HTTP {})", response.status()));
    }

    let image_bytes = response
        .bytes()
        .map_err(|error| format!("Lecture cover impossible: {error}"))?
        .to_vec();

    if image_bytes.is_empty() {
        return Err("Cover vide".to_string());
    }

    let decoded_image: DynamicImage = image::load_from_memory(&image_bytes)
        .map_err(|error| format!("Décodage cover impossible: {error}"))?;

    let mut jpeg_bytes: Vec<u8> = Vec::new();
    decoded_image
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg_bytes),
            image::ImageFormat::Jpeg,
        )
        .map_err(|error| format!("Conversion cover JPEG impossible: {error}"))?;

    if jpeg_bytes.is_empty() {
        return Err("Conversion cover JPEG vide".to_string());
    }

    std::fs::write(destination, jpeg_bytes)
        .map_err(|error| format!("Écriture du fichier cover impossible: {error}"))?;

    Ok(destination.to_string_lossy().to_string())
}

#[derive(Debug, Clone)]
pub struct ScannedAudioFile {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: Option<i64>,
    pub modified_at: Option<i64>,
    pub matched_soundcloud_url: Option<String>,
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

#[derive(Default)]
struct AudioMetadata {
    comment: Option<String>,
    local_cover_data_url: Option<String>,
    local_title: Option<String>,
    local_artist: Option<String>,
    local_duration_seconds: Option<i64>,
    local_format: Option<String>,
    local_bitrate_kbps: Option<i64>,
    local_bitrate_announced_kbps: Option<i64>,
    local_bitrate_real_kbps: Option<i64>,
    local_max_frequency_hz: Option<i64>,
    local_quality_label: Option<String>,
    local_sample_rate_hz: Option<i64>,
    local_channels: Option<i64>,
}

#[derive(Debug, Clone, Default)]
pub struct LocalMetadataSnapshot {
    pub comment: Option<String>,
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

const AUDIO_EXTENSIONS: [&str; 8] = ["mp3", "wav", "aif", "aiff", "flac", "m4a", "ogg", "aac"];

pub fn is_supported_audio_file(path: &Path) -> bool {
    path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| AUDIO_EXTENSIONS.contains(&value.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

pub struct SpectrogramExportSummary {
    pub output_path: String,
    pub estimated_cutoff_hz: Option<i64>,
}

pub struct SpectrogramPreviewSummary {
    pub temp_path: String,
    pub image_data_url: String,
    pub estimated_cutoff_hz: Option<i64>,
}

pub fn scan_audio_files(folder_path: &str) -> Result<Vec<ScannedAudioFile>, String> {
    let source = Path::new(folder_path);
    if !source.exists() {
        return Err(format!("Dossier introuvable: {folder_path}"));
    }
    if !source.is_dir() {
        return Err(format!("Le chemin n'est pas un dossier: {folder_path}"));
    }

    let url_regex = Regex::new(r#"https?://[^\s\]\[\)\("']+"#)
        .map_err(|error| format!("Regex URL invalide: {error}"))?;

    let mut files = Vec::new();

    for entry in WalkDir::new(source).follow_links(false) {
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let path = entry.path();
        if !is_audio_file(path) {
            continue;
        }

        let metadata = std::fs::metadata(path).ok();
        let file_path = path.to_string_lossy().to_string();
        let file_name = path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_else(|| file_path.clone());
        let file_size_bytes = metadata.as_ref().map(|value| value.len() as i64);
        let modified_at = metadata
            .and_then(|value| value.modified().ok())
            .and_then(|timestamp| {
                timestamp
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|value| value.as_secs() as i64)
            });

        let metadata = extract_local_metadata_fast(&file_path, Some(&file_name), file_size_bytes);

        let comment_text = metadata.comment.or_else(|| read_audio_comment(path));
        let matched_soundcloud_url = comment_text
            .as_deref()
            .and_then(|comment| extract_soundcloud_url(comment, &url_regex));

        files.push(ScannedAudioFile {
            file_path,
            file_name,
            file_size_bytes,
            modified_at,
            matched_soundcloud_url,
            local_cover_data_url: metadata.local_cover_data_url,
            local_title: metadata.local_title,
            local_artist: metadata.local_artist,
            local_duration_seconds: metadata.local_duration_seconds,
            local_format: metadata.local_format,
            local_bitrate_kbps: metadata.local_bitrate_kbps,
            local_bitrate_announced_kbps: metadata.local_bitrate_announced_kbps,
            local_bitrate_real_kbps: metadata.local_bitrate_real_kbps,
            local_max_frequency_hz: metadata.local_max_frequency_hz,
            local_quality_label: metadata.local_quality_label,
            local_sample_rate_hz: metadata.local_sample_rate_hz,
            local_channels: metadata.local_channels,
        });
    }

    Ok(files)
}

fn is_audio_file(path: &Path) -> bool {
    is_supported_audio_file(path)
}

fn read_audio_comment(path: &Path) -> Option<String> {
    let tag = Tag::new().read_from_path(path).ok()?;
    let comment = tag.comment()?;
    let trimmed = comment.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn read_audio_metadata(path: &Path) -> AudioMetadata {
    let mut metadata = AudioMetadata::default();
    metadata.local_format = guess_audio_format(path);

    if let Ok(tag) = Tag::new().read_from_path(path) {
        metadata.local_title = clean_tag_value(tag.title());
        metadata.local_artist = clean_tag_value(tag.artist());
        metadata.comment = clean_tag_value(tag.comment());
        metadata.local_duration_seconds = tag
            .duration()
            .map(|value| value.round() as i64)
            .filter(|value| *value > 0);

        if metadata.local_bitrate_announced_kbps.is_none() {
            metadata.local_bitrate_announced_kbps = tag
                .comment()
                .and_then(parse_bitrate_kbps_from_text);
        }

        if let Some(cover) = tag.album_cover() {
            let mime_type: String = cover.mime_type.into();
            let encoded = base64::engine::general_purpose::STANDARD.encode(cover.data);
            metadata.local_cover_data_url = Some(format!("data:{mime_type};base64,{encoded}"));
        }
    }

    let probe = match Probe::open(path) {
        Ok(probe) => probe,
        Err(_) => return metadata,
    };

    let tagged_file = match probe.read() {
        Ok(tagged_file) => tagged_file,
        Err(_) => return metadata,
    };

    let properties = tagged_file.properties();
    let duration_seconds = properties.duration().as_secs_f64().round() as i64;
    if duration_seconds > 0 && metadata.local_duration_seconds.is_none() {
        metadata.local_duration_seconds = Some(duration_seconds);
    }
    metadata.local_bitrate_announced_kbps = properties.audio_bitrate().map(|value| value as i64);
    metadata.local_bitrate_real_kbps = properties.overall_bitrate().map(|value| value as i64);
    metadata.local_bitrate_kbps = metadata
        .local_bitrate_real_kbps
        .or(metadata.local_bitrate_announced_kbps);
    metadata.local_sample_rate_hz = properties.sample_rate().map(|value| value as i64);
    metadata.local_channels = properties.channels().map(|value| value as i64);

    if let Some(tag) = tagged_file.primary_tag().or_else(|| tagged_file.first_tag()) {
        if metadata.local_title.is_none() {
            metadata.local_title = clean_tag_value(tag.title().as_deref());
        }
        if metadata.local_artist.is_none() {
            metadata.local_artist = clean_tag_value(tag.artist().as_deref());
        }
        if metadata.comment.is_none() {
            metadata.comment = clean_tag_value(tag.comment().as_deref());
        }

        if metadata.local_bitrate_announced_kbps.is_none() {
            for item in tag.items() {
                let item_key = format!("{:?}", item.key()).to_ascii_lowercase();
                let item_value = format!("{:?}", item.value());

                if (item_key.contains("bitrate")
                    || item_key.contains("encoder")
                    || item_key.contains("setting"))
                    && parse_bitrate_kbps_from_text(&item_value).is_some()
                {
                    metadata.local_bitrate_announced_kbps = parse_bitrate_kbps_from_text(&item_value);
                    break;
                }
            }
        }

        if metadata.local_cover_data_url.is_none() {
            if let Some(picture) = tag.pictures().first() {
            let encoded = base64::engine::general_purpose::STANDARD.encode(picture.data());
            metadata.local_cover_data_url = Some(format!("data:image/jpeg;base64,{encoded}"));
            }
        }
    }

    metadata
}

pub fn extract_local_metadata_fast(
    file_path: &str,
    file_name_hint: Option<&str>,
    file_size_bytes: Option<i64>,
) -> LocalMetadataSnapshot {
    extract_local_metadata_internal(file_path, file_name_hint, file_size_bytes, false)
}

fn extract_local_metadata_internal(
    file_path: &str,
    file_name_hint: Option<&str>,
    file_size_bytes: Option<i64>,
    include_frequency_analysis: bool,
) -> LocalMetadataSnapshot {
    let path = Path::new(file_path);
    let mut metadata = read_audio_metadata(path);

    let file_stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .or(file_name_hint)
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(stem) = file_stem.as_deref() {
        let (inferred_artist, inferred_title) = infer_artist_and_title_from_filename(stem);
        if metadata.local_artist.is_none() {
            metadata.local_artist = inferred_artist;
        }
        if metadata.local_title.is_none() {
            metadata.local_title = inferred_title.or_else(|| Some(stem.to_string()));
        }
    }

    if metadata.local_duration_seconds.is_none() {
        let is_mp3 = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("mp3"))
            .unwrap_or(false);

        if is_mp3 {
            metadata.local_duration_seconds = mp3_duration::from_path(path)
                .ok()
                .map(|value| value.as_secs_f64().round() as i64)
                .filter(|value| *value > 0);
        }
    }

    if metadata.local_bitrate_real_kbps.is_none() {
        if let (Some(size_bytes), Some(duration_seconds)) = (file_size_bytes, metadata.local_duration_seconds) {
            if duration_seconds > 0 {
                let estimate = ((size_bytes as f64 * 8.0) / 1000.0 / duration_seconds as f64).round() as i64;
                if estimate > 0 {
                    metadata.local_bitrate_real_kbps = Some(estimate);
                }
            }
        }
    }

    metadata.local_bitrate_kbps = metadata
        .local_bitrate_real_kbps
        .or(metadata.local_bitrate_announced_kbps);

    if include_frequency_analysis {
        let (estimated_max_frequency_hz, detected_sample_rate_hz) = estimate_max_frequency_hz(path);
        if metadata.local_sample_rate_hz.is_none() {
            metadata.local_sample_rate_hz = detected_sample_rate_hz;
        }

        if metadata.local_max_frequency_hz.is_none() {
            metadata.local_max_frequency_hz = estimated_max_frequency_hz.or_else(|| {
                metadata
                    .local_sample_rate_hz
                    .map(|value| ((value / 2) / 100) * 100)
                    .filter(|value| *value > 0)
            });
        }

        metadata.local_quality_label = quality_label_from_max_frequency(metadata.local_max_frequency_hz);
    }

    LocalMetadataSnapshot {
        comment: metadata.comment,
        local_cover_data_url: metadata.local_cover_data_url,
        local_title: metadata.local_title,
        local_artist: metadata.local_artist,
        local_duration_seconds: metadata.local_duration_seconds,
        local_format: metadata.local_format,
        local_bitrate_kbps: metadata.local_bitrate_kbps,
        local_bitrate_announced_kbps: metadata.local_bitrate_announced_kbps,
        local_bitrate_real_kbps: metadata.local_bitrate_real_kbps,
        local_max_frequency_hz: metadata.local_max_frequency_hz,
        local_quality_label: metadata.local_quality_label,
        local_sample_rate_hz: metadata.local_sample_rate_hz,
        local_channels: metadata.local_channels,
    }
}

fn estimate_max_frequency_hz(path: &Path) -> (Option<i64>, Option<i64>) {
    let (samples, sample_rate) = match decode_mono_samples(path, 280_000) {
        Some(values) => values,
        None => return (None, None),
    };

    let fft_size = 4096usize;
    let hop = 2048usize;
    if samples.len() <= fft_size {
        return (None, Some(sample_rate as i64));
    }

    let half = fft_size / 2;
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let window: Vec<f32> = (0..fft_size)
        .map(|index| {
            let ratio = index as f32 / (fft_size - 1) as f32;
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * ratio).cos()
        })
        .collect();

    let mut average_power_by_bin = vec![0.0f32; half];
    let mut frame_count = 0usize;

    let mut start = 0usize;
    while start + fft_size <= samples.len() {
        let frame = &samples[start..start + fft_size];
        let mut buffer: Vec<Complex<f32>> = frame
            .iter()
            .zip(window.iter())
            .map(|(sample, weight)| Complex::new(sample * weight, 0.0))
            .collect();
        fft.process(&mut buffer);

        for (index, value) in buffer[..half].iter().enumerate() {
            average_power_by_bin[index] += value.norm_sqr().max(1e-12);
        }

        frame_count += 1;
        start += hop;
    }

    if frame_count == 0 {
        return (None, Some(sample_rate as i64));
    }

    for value in &mut average_power_by_bin {
        *value /= frame_count as f32;
    }

    let mut smoothed = vec![0.0f32; average_power_by_bin.len()];
    for (index, target) in smoothed.iter_mut().enumerate() {
        let start = index.saturating_sub(2);
        let end = (index + 2).min(average_power_by_bin.len() - 1);
        let mut sum = 0.0f32;
        let mut count = 0usize;
        for value in &average_power_by_bin[start..=end] {
            sum += *value;
            count += 1;
        }
        *target = if count > 0 { sum / count as f32 } else { 0.0 };
    }

    let max_power = smoothed.iter().copied().fold(0.0f32, f32::max);
    if max_power <= 1e-12 {
        return (None, Some(sample_rate as i64));
    }

    let threshold = max_power * 0.015;
    let min_bin = ((1_000.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max(1.0) as usize;
    let mut cutoff_bin: Option<usize> = None;
    for (index, value) in smoothed.iter().enumerate().skip(min_bin) {
        if *value >= threshold {
            cutoff_bin = Some(index);
        }
    }

    let cutoff_hz = cutoff_bin
        .map(|value| (value as f32 * sample_rate as f32 / fft_size as f32).round() as i64)
        .map(|value| ((value / 100) * 100).max(100));

    (cutoff_hz, Some(sample_rate as i64))
}

pub fn quality_label_from_max_frequency(max_frequency_hz: Option<i64>) -> Option<String> {
    let value = max_frequency_hz?;
    let label = if value >= 19_000 {
        "high"
    } else if value >= 17_000 {
        "good"
    } else if value >= 15_000 {
        "medium"
    } else {
        "low"
    };

    Some(label.to_string())
}

fn spectrogram_temp_directory() -> std::path::PathBuf {
    std::env::temp_dir().join("glazer-spectrogram")
}

pub fn export_spectrogram_preview_temp(
    file_path: &str,
    analysis_scope: &str,
) -> Result<SpectrogramPreviewSummary, String> {
    let temp_dir = spectrogram_temp_directory();
    std::fs::create_dir_all(&temp_dir)
        .map_err(|error| format!("Impossible de créer le dossier temporaire: {error}"))?;

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    let temp_path = temp_dir.join(format!("spectrogram-{now}.jpg"));

    let summary = export_spectrogram_jpg_native(
        file_path,
        temp_path.to_string_lossy().as_ref(),
        analysis_scope,
    )?;

    let image_bytes = std::fs::read(&temp_path)
        .map_err(|error| format!("Impossible de lire le spectrogramme temporaire: {error}"))?;
    let image_data_url = format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(image_bytes)
    );

    Ok(SpectrogramPreviewSummary {
        temp_path: temp_path.to_string_lossy().to_string(),
        image_data_url,
        estimated_cutoff_hz: summary.estimated_cutoff_hz,
    })
}

pub fn delete_temporary_spectrogram(temp_path: &str) -> Result<(), String> {
    let candidate = Path::new(temp_path);
    if !candidate.exists() {
        return Ok(());
    }

    let base_dir = spectrogram_temp_directory();
    if !candidate.starts_with(&base_dir) {
        return Err("Chemin temporaire invalide".to_string());
    }

    std::fs::remove_file(candidate)
        .map_err(|error| format!("Impossible de supprimer le spectrogramme temporaire: {error}"))
}

fn decode_mono_samples(path: &Path, max_samples: usize) -> Option<(Vec<f32>, u32)> {
    let file = std::fs::File::open(path).ok()?;
    let source_stream = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(extension) = path.extension().and_then(|value| value.to_str()) {
        hint.with_extension(extension);
    }

    let mut probed = get_probe()
        .format(
            &hint,
            source_stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;

    let track = probed.format.default_track()?.clone();
    let mut decoder = get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .ok()?;
    let sample_rate = track.codec_params.sample_rate?;

    let mut mono_samples: Vec<f32> = Vec::with_capacity(max_samples);

    loop {
        let packet = match probed.format.next_packet() {
            Ok(packet) => packet,
            Err(_) => break,
        };

        if packet.track_id() != track.id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(decoded) => decoded,
            Err(_) => continue,
        };

        let channels = decoded.spec().channels.count();
        let mut sample_buffer = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        match decoded {
            AudioBufferRef::U8(_) 
            | AudioBufferRef::U16(_)
            | AudioBufferRef::U24(_)
            | AudioBufferRef::U32(_)
            | AudioBufferRef::S8(_)
            | AudioBufferRef::S16(_)
            | AudioBufferRef::S24(_)
            | AudioBufferRef::S32(_)
            | AudioBufferRef::F32(_)
            | AudioBufferRef::F64(_) => sample_buffer.copy_interleaved_ref(decoded),
        }

        let raw = sample_buffer.samples();
        for frame in raw.chunks(channels.max(1)) {
            let sum: f32 = frame.iter().copied().sum();
            mono_samples.push(sum / frame.len() as f32);
            if mono_samples.len() >= max_samples {
                return Some((mono_samples, sample_rate));
            }
        }
    }

    if mono_samples.is_empty() {
        return None;
    }

    Some((mono_samples, sample_rate))
}

fn infer_artist_and_title_from_filename(file_stem: &str) -> (Option<String>, Option<String>) {
    let separators = [" - ", " – ", " — "];
    for separator in separators {
        if let Some((artist, title)) = file_stem.split_once(separator) {
            let artist = artist.trim();
            let title = title.trim();
            if !artist.is_empty() && !title.is_empty() {
                return (Some(artist.to_string()), Some(title.to_string()));
            }
        }
    }

    (None, None)
}

fn parse_bitrate_kbps_from_text(text: &str) -> Option<i64> {
    let regex = Regex::new(r"(?i)(\\d{2,4})\\s*(kbps|kb/s|kbit/s|kbit|kb)").ok()?;
    let captures = regex.captures(text)?;
    let value = captures.get(1)?.as_str().parse::<i64>().ok()?;
    if value > 0 { Some(value) } else { None }
}

fn clean_tag_value(value: Option<&str>) -> Option<String> {
    let value = value?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    Some(trimmed.to_string())
}

fn guess_audio_format(path: &Path) -> Option<String> {
    path
        .extension()
        .and_then(|value| value.to_str())
    .map(|value| value.to_string())
}

fn extract_soundcloud_url(text: &str, regex: &Regex) -> Option<String> {
    for capture in regex.find_iter(text) {
        let normalized = normalize_soundcloud_url(Some(capture.as_str()));
        if normalized.is_some() {
            return normalized;
        }
    }

    None
}

pub fn normalize_soundcloud_url(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();
    if value.is_empty() {
        return None;
    }

    let absolute = if value.starts_with("http://") || value.starts_with("https://") {
        value.to_string()
    } else {
        return None;
    };

    let mut parsed = url::Url::parse(&absolute).ok()?;
    let host = parsed.host_str()?.to_ascii_lowercase();
    if !host.contains("soundcloud.com") {
        return None;
    }

    parsed.set_query(None);
    parsed.set_fragment(None);
    let mut cleaned = parsed.to_string();
    if cleaned.ends_with('/') {
        cleaned.pop();
    }

    Some(cleaned)
}

pub fn export_spectrogram_jpg_native(
    file_path: &str,
    output_path: &str,
    analysis_scope: &str,
) -> Result<SpectrogramExportSummary, String> {
    let source = Path::new(file_path);
    if !source.exists() || !source.is_file() {
        return Err(format!("Fichier audio introuvable: {file_path}"));
    }

    let target = Path::new(output_path);
    if let Some(parent) = target.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("Impossible de créer le dossier de sortie: {error}"))?;
    }

    render_spectrogram_jpg(source, target, analysis_scope)
}

pub fn analyze_file_cutoff_hz(file_path: &str, analysis_scope: &str) -> Result<Option<i64>, String> {
    let source = Path::new(file_path);
    if !source.exists() || !source.is_file() {
        return Err(format!("Fichier audio introuvable: {file_path}"));
    }

    let (samples, sample_rate) = decode_mono_samples(source, 6_000_000)
        .ok_or_else(|| "Décodage audio impossible pour analyse audio".to_string())?;

    let (segment_start, segment_len) = resolve_analysis_segment(samples.len(), analysis_scope)?;
    let analysis_samples = &samples[segment_start..segment_start + segment_len];

    let fft_size = 4096usize;
    if analysis_samples.len() <= fft_size {
        return Err("Audio trop court pour analyser la coupure fréquentielle".to_string());
    }

    let frames_target = 1100usize;
    let available = analysis_samples.len() - fft_size;
    let hop = (available / frames_target.max(1)).max(1);
    let half = fft_size / 2;

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let window: Vec<f32> = (0..fft_size)
        .map(|index| {
            let ratio = index as f32 / (fft_size - 1) as f32;
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * ratio).cos()
        })
        .collect();

    let mut average_power_by_bin = vec![0.0f32; half];
    let mut frame_count = 0usize;

    for x in 0..frames_target {
        let start = (x * hop).min(analysis_samples.len() - fft_size);
        let frame = &analysis_samples[start..start + fft_size];

        let mut buffer: Vec<Complex<f32>> = frame
            .iter()
            .zip(window.iter())
            .map(|(sample, weight)| Complex::new(sample * weight, 0.0))
            .collect();
        fft.process(&mut buffer);

        for (index, value) in buffer[..half].iter().enumerate() {
            average_power_by_bin[index] += value.norm_sqr().max(1e-12);
        }
        frame_count += 1;
    }

    if frame_count == 0 {
        return Ok(None);
    }

    for value in &mut average_power_by_bin {
        *value /= frame_count as f32;
    }

    Ok(estimate_average_cutoff_hz(&average_power_by_bin, sample_rate, fft_size))
}

fn resolve_analysis_segment(samples_len: usize, analysis_scope: &str) -> Result<(usize, usize), String> {
    if samples_len == 0 {
        return Err("Audio vide pour analyse".to_string());
    }

    let analysis_ratio = match analysis_scope.to_ascii_lowercase().as_str() {
        "quarter" => 0.25_f32,
        "full" => 1.0_f32,
        _ => 0.5_f32,
    };

    let min_segment_len = 8192usize.min(samples_len);
    let requested_len = ((samples_len as f32) * analysis_ratio).round() as usize;
    let segment_len = requested_len.clamp(min_segment_len, samples_len);
    let segment_start = (samples_len - segment_len) / 2;

    Ok((segment_start, segment_len))
}

fn render_spectrogram_jpg(source: &Path, target: &Path, analysis_scope: &str) -> Result<SpectrogramExportSummary, String> {
    let (samples, sample_rate) = decode_mono_samples(source, 6_000_000)
        .ok_or_else(|| "Décodage audio impossible pour spectrogramme natif".to_string())?;

    let (segment_start, segment_len) = resolve_analysis_segment(samples.len(), analysis_scope)?;
    let analysis_samples = &samples[segment_start..segment_start + segment_len];

    let fft_size = 4096usize;
    if analysis_samples.len() <= fft_size {
        return Err("Audio trop court pour générer un spectrogramme".to_string());
    }

    let plot_width = 1100usize;
    let plot_height = 560usize;
    let margin_left = 82usize;
    let margin_top = 28usize;
    let margin_bottom = 50usize;
    let margin_right = 116usize;
    let width = margin_left + plot_width + margin_right;
    let height = margin_top + plot_height + margin_bottom;

    let available = analysis_samples.len() - fft_size;
    let hop = (available / plot_width.max(1)).max(1);
    let half = fft_size / 2;

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    let window: Vec<f32> = (0..fft_size)
        .map(|index| {
            let ratio = index as f32 / (fft_size - 1) as f32;
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * ratio).cos()
        })
        .collect();

    let nyquist = sample_rate as f32 / 2.0;
    let min_hz = 20.0f32;
    let split_hz = 10_000.0_f32.min((nyquist - 50.0).max(min_hz * 1.5));
    let bin_for_row: Vec<usize> = (0..plot_height)
        .map(|row| {
            let t = 1.0 - (row as f32 / (plot_height - 1) as f32);
            let freq = plot_ratio_to_frequency(t, min_hz, split_hz, nyquist);
            let normalized = (freq / nyquist).clamp(0.0, 1.0);
            ((normalized * (half - 1) as f32).round() as usize).min(half - 1)
        })
        .collect();

    let mut spectrogram = vec![0.0f32; plot_width * plot_height];
    let mut average_power_by_bin = vec![0.0f32; half];
    let mut frame_count = 0usize;
    let mut db_min = f32::INFINITY;
    let mut db_max = f32::NEG_INFINITY;

    for x in 0..plot_width {
        let start = (x * hop).min(analysis_samples.len() - fft_size);
        let frame = &analysis_samples[start..start + fft_size];

        let mut buffer: Vec<Complex<f32>> = frame
            .iter()
            .zip(window.iter())
            .map(|(sample, weight)| Complex::new(sample * weight, 0.0))
            .collect();
        fft.process(&mut buffer);

        let power: Vec<f32> = buffer[..half]
            .iter()
            .map(|value| value.norm_sqr().max(1e-12))
            .collect();

        for (index, value) in power.iter().enumerate() {
            average_power_by_bin[index] += *value;
        }
        frame_count += 1;

        for y in 0..plot_height {
            let bin = bin_for_row[y];
            let db = 10.0 * power[bin].log10();
            let index = y * plot_width + x;
            spectrogram[index] = db;
            db_min = db_min.min(db);
            db_max = db_max.max(db);
        }
    }

    if !db_min.is_finite() || !db_max.is_finite() || (db_max - db_min).abs() < 1e-6 {
        return Err("Données spectrogramme invalides".to_string());
    }

    let estimated_cutoff_hz = if frame_count > 0 {
        for value in &mut average_power_by_bin {
            *value /= frame_count as f32;
        }
        estimate_average_cutoff_hz(&average_power_by_bin, sample_rate, fft_size)
    } else {
        None
    };

    let db_top = db_max;
    let db_bottom = (db_top - 80.0).max(db_min);
    let db_span = (db_top - db_bottom).max(1e-6);

    let mut image = ImageBuffer::<Rgb<u8>, Vec<u8>>::new(width as u32, height as u32);
    for pixel in image.pixels_mut() {
        *pixel = Rgb([16, 19, 27]);
    }

    for y in 0..plot_height {
        for x in 0..plot_width {
            let db = spectrogram[y * plot_width + x];
            let normalized = ((db - db_bottom) / db_span).clamp(0.0, 1.0);
            let color = spectrogram_color(normalized);
            image.put_pixel((margin_left + x) as u32, (margin_top + y) as u32, Rgb(color));
        }
    }

    let grid_color = Rgb([68, 74, 92]);
    let axis_color = Rgb([206, 214, 236]);
    let label_color = Rgb([225, 232, 248]);

    let mut freq_ticks = vec![20.0f32, 50.0, 100.0, 200.0, 500.0, 1_000.0, 2_000.0, 5_000.0, 8_000.0, 10_000.0];
    if nyquist > 10_000.0 {
        let upper_end = nyquist.min(20_000.0);
        let mut current = 11_000.0;
        while current <= upper_end + 1.0 {
            freq_ticks.push(current);
            current += 1_000.0;
        }
    }

    for freq in freq_ticks {
        if freq > nyquist {
            continue;
        }

        let y = frequency_to_y(freq, min_hz, split_hz, nyquist, margin_top, plot_height);
        draw_hline(
            &mut image,
            margin_left,
            margin_left + plot_width - 1,
            y,
            grid_color,
        );

        draw_text(
            &mut image,
            6,
            y.saturating_sub(8),
            &format_frequency_label(freq),
            label_color,
            2,
        );
    }

    let total_seconds = analysis_samples.len() as f32 / sample_rate as f32;
    for step in 0..=6usize {
        let ratio = step as f32 / 6.0;
        let x = margin_left + ((plot_width - 1) as f32 * ratio).round() as usize;
        draw_vline(
            &mut image,
            x,
            margin_top,
            margin_top + plot_height - 1,
            grid_color,
        );

        let seconds = total_seconds * ratio;
        draw_text(
            &mut image,
            x.saturating_sub(14),
            margin_top + plot_height + 8,
            &format_time_label(seconds),
            label_color,
            1,
        );
    }

    draw_rect(
        &mut image,
        margin_left,
        margin_top,
        plot_width,
        plot_height,
        axis_color,
    );

    let colorbar_x = margin_left + plot_width + 28;
    let colorbar_w = 24usize;
    for y in 0..plot_height {
        let normalized = 1.0 - (y as f32 / (plot_height - 1) as f32);
        let color = spectrogram_color(normalized);
        for x in 0..colorbar_w {
            image.put_pixel((colorbar_x + x) as u32, (margin_top + y) as u32, Rgb(color));
        }
    }
    draw_rect(
        &mut image,
        colorbar_x,
        margin_top,
        colorbar_w,
        plot_height,
        axis_color,
    );

    for step in 0..=4usize {
        let ratio = step as f32 / 4.0;
        let y = margin_top + ((plot_height - 1) as f32 * ratio).round() as usize;
        let db_value = db_top - ratio * db_span;
        draw_hline(
            &mut image,
            colorbar_x + colorbar_w + 2,
            colorbar_x + colorbar_w + 8,
            y,
            axis_color,
        );
        draw_text(
            &mut image,
            colorbar_x + colorbar_w + 12,
            y.saturating_sub(5),
            &format!("{}dB", db_value.round() as i32),
            label_color,
            1,
        );
    }

    draw_text(&mut image, margin_left + plot_width / 2 - 22, height - 20, "time", label_color, 1);
    draw_text(&mut image, 8, margin_top - 16, "freq", label_color, 2);
    draw_text(&mut image, colorbar_x + 4, margin_top - 16, "level", label_color, 1);

    let mut output_file = std::fs::File::create(target)
        .map_err(|error| format!("Impossible de créer l'image spectrogramme: {error}"))?;
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut output_file, 92);
    encoder
        .encode_image(&image)
        .map_err(|error| format!("Encodage JPG impossible: {error}"))?;

    Ok(SpectrogramExportSummary {
        output_path: target.to_string_lossy().to_string(),
        estimated_cutoff_hz,
    })
}

fn estimate_average_cutoff_hz(
    average_power_by_bin: &[f32],
    sample_rate: u32,
    fft_size: usize,
) -> Option<i64> {
    if average_power_by_bin.is_empty() {
        return None;
    }

    let mut smoothed = vec![0.0f32; average_power_by_bin.len()];
    for (index, target) in smoothed.iter_mut().enumerate() {
        let start = index.saturating_sub(4);
        let end = (index + 4).min(average_power_by_bin.len() - 1);
        let mut sum = 0.0f32;
        let mut count = 0usize;
        for value in &average_power_by_bin[start..=end] {
            sum += *value;
            count += 1;
        }
        *target = if count > 0 { sum / count as f32 } else { 0.0 };
    }

    let max_power = smoothed
        .iter()
        .copied()
        .fold(0.0f32, f32::max);
    if max_power <= 1e-12 {
        return None;
    }

    let bin_hz = sample_rate as f32 / fft_size as f32;
    let min_index = ((4_000.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max(1.0) as usize;
    let reference_start = ((1_000.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max(1.0) as usize;
    let reference_end = ((4_000.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max(reference_start as f32) as usize;

    let ref_slice_end = reference_end.min(smoothed.len().saturating_sub(1));
    if reference_start >= ref_slice_end {
        return None;
    }

    let signal_reference_power = smoothed[reference_start..=ref_slice_end]
        .iter()
        .copied()
        .fold(0.0f32, f32::max)
        .max(max_power * 0.08);

    let noise_start = ((18_000.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max((smoothed.len() as f32 * 0.8).floor()) as usize;
    let mut noise_values: Vec<f32> = smoothed
        .iter()
        .skip(noise_start.min(smoothed.len().saturating_sub(1)))
        .copied()
        .collect();
    if noise_values.is_empty() {
        noise_values.push(smoothed[smoothed.len() - 1]);
    }
    noise_values.sort_by(|left, right| left.partial_cmp(right).unwrap_or(std::cmp::Ordering::Equal));
    let noise_floor_power = noise_values[noise_values.len() / 2].max(1e-20);

    let dynamic_range_db = 10.0 * (signal_reference_power / noise_floor_power).log10();
    if dynamic_range_db < 8.0 {
        return None;
    }

    let threshold_db = (-(dynamic_range_db * 0.45)).clamp(-38.0, -16.0);
    let relative_db: Vec<f32> = smoothed
        .iter()
        .map(|value| 10.0 * (value.max(1e-20) / signal_reference_power).log10())
        .collect();

    let sustain_bins = ((700.0f32 * fft_size as f32) / sample_rate as f32)
        .round()
        .max(6.0) as usize;
    let drop_db_required = (dynamic_range_db * 0.25).clamp(4.0, 14.0);

    let mut cutoff_index: Option<usize> = None;
    if relative_db.len() > sustain_bins + 1 {
        for index in min_index..(relative_db.len() - sustain_bins) {
            if relative_db[index] < threshold_db {
                continue;
            }

            let tail = &relative_db[index + 1..=index + sustain_bins];
            let below_count = tail.iter().filter(|value| **value < threshold_db).count();
            let tail_avg = tail.iter().copied().sum::<f32>() / tail.len() as f32;
            if below_count * 5 >= sustain_bins * 4 && (relative_db[index] - tail_avg) >= drop_db_required {
                cutoff_index = Some(index);
            }
        }
    }

    if cutoff_index.is_none() {
        for index in min_index..relative_db.len() {
            if relative_db[index] >= threshold_db {
                cutoff_index = Some(index);
            }
        }
    }

    let index = cutoff_index?;
    let hz = (index as f32 * bin_hz).round() as i64;
    Some(((hz / 100) * 100).max(100))
}

fn spectrogram_color(normalized: f32) -> [u8; 3] {
    let t = normalized.clamp(0.0, 1.0).powf(0.72);
    if t < 0.35 {
        blend_color([20, 0, 0], [130, 0, 0], t / 0.35)
    } else if t < 0.7 {
        blend_color([130, 0, 0], [255, 70, 0], (t - 0.35) / 0.35)
    } else if t < 0.92 {
        blend_color([255, 70, 0], [255, 215, 0], (t - 0.7) / 0.22)
    } else {
        blend_color([255, 215, 0], [255, 250, 210], (t - 0.92) / 0.08)
    }
}

fn blend_color(from: [u8; 3], to: [u8; 3], t: f32) -> [u8; 3] {
    let ratio = t.clamp(0.0, 1.0);
    [
        ((from[0] as f32) + ((to[0] as f32) - (from[0] as f32)) * ratio).round() as u8,
        ((from[1] as f32) + ((to[1] as f32) - (from[1] as f32)) * ratio).round() as u8,
        ((from[2] as f32) + ((to[2] as f32) - (from[2] as f32)) * ratio).round() as u8,
    ]
}

fn frequency_to_y(freq: f32, min_hz: f32, split_hz: f32, nyquist: f32, top: usize, height: usize) -> usize {
    let clamped_freq = freq.clamp(min_hz, nyquist);
    let mapped_ratio = if split_hz <= min_hz || split_hz >= nyquist {
        ((clamped_freq / min_hz).ln() / (nyquist / min_hz).ln()).clamp(0.0, 1.0)
    } else if clamped_freq <= split_hz {
        let low = ((clamped_freq / min_hz).ln() / (split_hz / min_hz).ln()).clamp(0.0, 1.0);
        low * 0.5
    } else {
        let high = ((clamped_freq / split_hz).ln() / (nyquist / split_hz).ln()).clamp(0.0, 1.0);
        0.5 + high * 0.5
    };
    top + (height - 1) - ((height - 1) as f32 * mapped_ratio).round() as usize
}

fn plot_ratio_to_frequency(ratio: f32, min_hz: f32, split_hz: f32, nyquist: f32) -> f32 {
    let clamped_ratio = ratio.clamp(0.0, 1.0);
    if split_hz <= min_hz || split_hz >= nyquist {
        return min_hz * (nyquist / min_hz).powf(clamped_ratio);
    }

    if clamped_ratio <= 0.5 {
        let low = clamped_ratio / 0.5;
        min_hz * (split_hz / min_hz).powf(low)
    } else {
        let high = (clamped_ratio - 0.5) / 0.5;
        split_hz * (nyquist / split_hz).powf(high)
    }
}

fn format_frequency_label(freq: f32) -> String {
    if freq >= 1000.0 {
        if (freq % 1000.0).abs() < 0.1 {
            format!("{}kHz", (freq / 1000.0).round() as i32)
        } else {
            format!("{:.1}kHz", freq / 1000.0)
        }
    } else {
        format!("{}Hz", freq.round() as i32)
    }
}

fn format_time_label(seconds: f32) -> String {
    if seconds >= 60.0 {
        let total = seconds.round() as i32;
        let minutes = total / 60;
        let sec = total % 60;
        format!("{}:{:02}", minutes, sec)
    } else {
        format!("{}s", seconds.round() as i32)
    }
}

fn draw_rect(
    image: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    color: Rgb<u8>,
) {
    if width == 0 || height == 0 {
        return;
    }

    draw_hline(image, x, x + width - 1, y, color);
    draw_hline(image, x, x + width - 1, y + height - 1, color);
    draw_vline(image, x, y, y + height - 1, color);
    draw_vline(image, x + width - 1, y, y + height - 1, color);
}

fn draw_hline(
    image: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    mut x0: usize,
    mut x1: usize,
    y: usize,
    color: Rgb<u8>,
) {
    if y >= image.height() as usize {
        return;
    }
    if x0 > x1 {
        std::mem::swap(&mut x0, &mut x1);
    }
    let max_x = image.width() as usize - 1;
    for x in x0.min(max_x)..=x1.min(max_x) {
        image.put_pixel(x as u32, y as u32, color);
    }
}

fn draw_vline(
    image: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    x: usize,
    mut y0: usize,
    mut y1: usize,
    color: Rgb<u8>,
) {
    if x >= image.width() as usize {
        return;
    }
    if y0 > y1 {
        std::mem::swap(&mut y0, &mut y1);
    }
    let max_y = image.height() as usize - 1;
    for y in y0.min(max_y)..=y1.min(max_y) {
        image.put_pixel(x as u32, y as u32, color);
    }
}

fn draw_text(
    image: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    x: usize,
    y: usize,
    text: &str,
    color: Rgb<u8>,
    scale: usize,
) {
    let mut offset = 0usize;
    for ch in text.chars() {
        draw_char(image, x + offset, y, ch, color, scale);
        offset += 6 * scale;
    }
}

fn draw_char(
    image: &mut ImageBuffer<Rgb<u8>, Vec<u8>>,
    x: usize,
    y: usize,
    ch: char,
    color: Rgb<u8>,
    scale: usize,
) {
    let glyph = glyph_5x7(ch);
    for (row, bits) in glyph.iter().enumerate() {
        for col in 0..5usize {
            if (bits >> (4 - col)) & 1 == 1 {
                for sy in 0..scale {
                    for sx in 0..scale {
                        let px = x + col * scale + sx;
                        let py = y + row * scale + sy;
                        if px < image.width() as usize && py < image.height() as usize {
                            image.put_pixel(px as u32, py as u32, color);
                        }
                    }
                }
            }
        }
    }
}

fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch {
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b10000, 0b11110, 0b00001, 0b00001, 0b11110],
        '6' => [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b11100],
        'a' => [0b00000, 0b00000, 0b01110, 0b00001, 0b01111, 0b10001, 0b01111],
        'd' => [0b00001, 0b00001, 0b01111, 0b10001, 0b10001, 0b10011, 0b01101],
        'e' => [0b00000, 0b00000, 0b01110, 0b10001, 0b11111, 0b10000, 0b01111],
        'f' => [0b00110, 0b01001, 0b01000, 0b11100, 0b01000, 0b01000, 0b01000],
        'h' => [0b10000, 0b10000, 0b10110, 0b11001, 0b10001, 0b10001, 0b10001],
        'i' => [0b00100, 0b00000, 0b01100, 0b00100, 0b00100, 0b00100, 0b01110],
        'k' => [0b10000, 0b10000, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010],
        'l' => [0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        'm' => [0b00000, 0b00000, 0b11010, 0b10101, 0b10101, 0b10101, 0b10101],
        'q' => [0b00000, 0b00000, 0b01101, 0b10011, 0b10001, 0b01111, 0b00001],
        'r' => [0b00000, 0b00000, 0b10110, 0b11001, 0b10000, 0b10000, 0b10000],
        's' => [0b00000, 0b00000, 0b01111, 0b10000, 0b01110, 0b00001, 0b11110],
        't' => [0b01000, 0b01000, 0b11100, 0b01000, 0b01000, 0b01001, 0b00110],
        'u' => [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b10011, 0b01101],
        'v' => [0b00000, 0b00000, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'y' => [0b00000, 0b00000, 0b10001, 0b10001, 0b01111, 0b00001, 0b01110],
        'z' => [0b00000, 0b00000, 0b11111, 0b00010, 0b00100, 0b01000, 0b11111],
        'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        ':' => [0b00000, 0b00100, 0b00100, 0b00000, 0b00100, 0b00100, 0b00000],
        '-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        '.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
        ' ' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000],
        _ => [0b00000, 0b00000, 0b11111, 0b00100, 0b00100, 0b00000, 0b00100],
    }
}
