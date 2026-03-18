import type { TranslationKey } from "../i18n";
import type {
  Playlist,
  PlaylistTrack,
  SpectrogramPreviewResult,
} from "../types";

type TrackPanelProps = {
  t: (key: TranslationKey) => string;
  selectedTrackInfo: PlaylistTrack;
  hasAvailableLocalFolder: boolean;
  canDownloadSelectedTrackFromHypeddit: boolean;
  showHypedditDownloadMenu: boolean;
  setShowHypedditDownloadMenu: (updater: (current: boolean) => boolean) => void;
  overwriteExistingHypedditDownload: boolean;
  setOverwriteExistingHypedditDownload: (value: boolean) => void;
  hypedditDownloadPhase: string;
  availableMoveTargetPlaylists: Playlist[];
  targetPlaylistIdForMove: number | "";
  setTargetPlaylistIdForMove: (value: number) => void;
  movingTrackBetweenPlaylists: boolean;
  embeddingLocalCover: boolean;
  exportingSpectrogram: boolean;
  dissociatingLocalFile: boolean;
  associatingLocalFile: boolean;
  downloadingFromHypeddit: boolean;
  loadingSpectrogramPreview: boolean;
  savingManualCutoff: boolean;
  manualCutoffInputHz: string;
  setManualCutoffInputHz: (value: string) => void;
  spectrogramPreview: SpectrogramPreviewResult | null;
  onOpenSoundcloud: () => void;
  onOpenAssociatedUrl: () => void;
  onRevealLocalFile: () => void;
  onEmbedLocalCover: () => void;
  onExportSpectrogram: () => void;
  onDissociateLocalFile: () => void;
  onAssociateLocalFile: () => void;
  onDownloadFromHypeddit: () => void;
  onMoveTrack: () => void;
  onGenerateSpectrogramPreview: () => void;
  onSaveManualCutoff: () => void;
  getAssociatedButtonLabel: (url?: string | null) => string;
  getHypedditProgressLabel: (phase: string) => string;
  resolvePanelArtworkUrl: (url?: string | null) => string | null;
  formatFrequency: (value?: number | null) => string;
  formatDuration: (value?: number | null) => string;
  formatText: (value?: string | null) => string;
  formatCount: (value?: number | null) => string;
  formatDate: (value?: string | null) => string;
  formatDurationFromSeconds: (value?: number | null) => string;
  formatBitrate: (value?: number | null) => string;
  formatQuality: (value?: string | null) => string;
  formatFileSize: (value?: number | null) => string;
};

export function TrackPanel({
  t,
  selectedTrackInfo,
  hasAvailableLocalFolder,
  canDownloadSelectedTrackFromHypeddit,
  showHypedditDownloadMenu,
  setShowHypedditDownloadMenu,
  overwriteExistingHypedditDownload,
  setOverwriteExistingHypedditDownload,
  hypedditDownloadPhase,
  availableMoveTargetPlaylists,
  targetPlaylistIdForMove,
  setTargetPlaylistIdForMove,
  movingTrackBetweenPlaylists,
  embeddingLocalCover,
  exportingSpectrogram,
  dissociatingLocalFile,
  associatingLocalFile,
  downloadingFromHypeddit,
  loadingSpectrogramPreview,
  savingManualCutoff,
  manualCutoffInputHz,
  setManualCutoffInputHz,
  spectrogramPreview,
  onOpenSoundcloud,
  onOpenAssociatedUrl,
  onRevealLocalFile,
  onEmbedLocalCover,
  onExportSpectrogram,
  onDissociateLocalFile,
  onAssociateLocalFile,
  onDownloadFromHypeddit,
  onMoveTrack,
  onGenerateSpectrogramPreview,
  onSaveManualCutoff,
  getAssociatedButtonLabel,
  getHypedditProgressLabel,
  resolvePanelArtworkUrl,
  formatFrequency,
  formatDuration,
  formatText,
  formatCount,
  formatDate,
  formatDurationFromSeconds,
  formatBitrate,
  formatQuality,
  formatFileSize,
}: TrackPanelProps) {
  return (
    <aside className="track-panel open">
      <div className="track-panel-content">
        <section className="track-panel-actions-card">
          <h3>{t("utilitiesTitle")}</h3>
          <div className="panel-actions">
            <button
              type="button"
              disabled={!selectedTrackInfo.permalink_url}
              onClick={onOpenSoundcloud}
            >
              {t("openOnSoundcloud")}
            </button>

            {selectedTrackInfo.associated_url ? (
              <button
                type="button"
                onClick={onOpenAssociatedUrl}
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
                onClick={onRevealLocalFile}
              >
                {t("localRevealFileButton")}
              </button>
            ) : null}

            {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
              <button
                type="button"
                onClick={onEmbedLocalCover}
                disabled={embeddingLocalCover}
              >
                {embeddingLocalCover ? t("localEmbedCoverRunning") : t("localEmbedCoverButton")}
              </button>
            ) : null}

            {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
              <button
                type="button"
                onClick={onExportSpectrogram}
                disabled={exportingSpectrogram}
              >
                {exportingSpectrogram ? t("localSpectrogramExportRunning") : t("localSpectrogramExportButton")}
              </button>
            ) : null}

            {hasAvailableLocalFolder && selectedTrackInfo.local_file ? (
              <button
                type="button"
                onClick={onDissociateLocalFile}
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
                onClick={onDownloadFromHypeddit}
                disabled={!canDownloadSelectedTrackFromHypeddit || downloadingFromHypeddit}
              >
                {downloadingFromHypeddit ? t("hypedditDownloadRunning") : t("hypedditDownloadConfirm")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowHypedditDownloadMenu(() => false);
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
                onClick={onMoveTrack}
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
                onClick={onGenerateSpectrogramPreview}
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
                onClick={onSaveManualCutoff}
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
                    onClick={onAssociateLocalFile}
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
  );
}
