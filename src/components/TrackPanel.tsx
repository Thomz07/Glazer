import { useEffect, useState } from "react";
import type { TranslationKey } from "../i18n";
import type {
  Playlist,
  PlaylistTrack,
  SpectrogramPreviewResult,
} from "../types";
import { CenteredModal } from "./CenteredModal";

type TrackPanelProps = {
  t: (key: TranslationKey) => string;
  selectedTrackInfo: PlaylistTrack;
  hasAvailableLocalFolder: boolean;
  canDownloadSelectedTrackFromHypeddit: boolean;
  canRunYtDlDownload: boolean;
  overwriteExistingHypedditDownload: boolean;
  setOverwriteExistingHypedditDownload: (value: boolean) => void;
  hypedditDownloadEmbedCover: boolean;
  hypedditDownloadRenameWithSoundcloudTitle: boolean;
  ytdlDownloadEmbedCover: boolean;
  ytdlDownloadRenameWithSoundcloudTitle: boolean;
  onSaveHypedditDownloadEmbedCover: (enabled: boolean) => void;
  onSaveHypedditDownloadRenameWithSoundcloudTitle: (enabled: boolean) => void;
  onSaveYtDlDownloadEmbedCover: (enabled: boolean) => void;
  onSaveYtDlDownloadRenameWithSoundcloudTitle: (enabled: boolean) => void;
  hypedditDownloadPhase: string;
  availableMoveTargetPlaylists: Playlist[];
  targetPlaylistIdForMove: number | "";
  setTargetPlaylistIdForMove: (value: number) => void;
  movingTrackBetweenPlaylists: boolean;
  embeddingLocalCover: boolean;
  exportingSpectrogram: boolean;
  dissociatingLocalFile: boolean;
  associatingLocalFile: boolean;
  associatingLocalFileByName: boolean;
  downloadingFromHypeddit: boolean;
  downloadingFromYtDl: boolean;
  downloadingCover: boolean;
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
  onAssociateLocalFileByName: () => void;
  onPrepareHypedditDownloadModal: () => Promise<boolean>;
  onPrepareYtDlDownloadModal: () => Promise<boolean>;
  onDownloadFromHypeddit: () => void;
  onRunYtDlDownload: () => void;
  onDownloadCover: () => void;
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
  canRunYtDlDownload,
  overwriteExistingHypedditDownload,
  setOverwriteExistingHypedditDownload,
  hypedditDownloadEmbedCover,
  hypedditDownloadRenameWithSoundcloudTitle,
  ytdlDownloadEmbedCover,
  ytdlDownloadRenameWithSoundcloudTitle,
  onSaveHypedditDownloadEmbedCover,
  onSaveHypedditDownloadRenameWithSoundcloudTitle,
  onSaveYtDlDownloadEmbedCover,
  onSaveYtDlDownloadRenameWithSoundcloudTitle,
  hypedditDownloadPhase,
  availableMoveTargetPlaylists,
  targetPlaylistIdForMove,
  setTargetPlaylistIdForMove,
  movingTrackBetweenPlaylists,
  embeddingLocalCover,
  exportingSpectrogram,
  dissociatingLocalFile,
  associatingLocalFile,
  associatingLocalFileByName,
  downloadingFromHypeddit,
  downloadingFromYtDl,
  downloadingCover,
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
  onAssociateLocalFileByName,
  onPrepareHypedditDownloadModal,
  onPrepareYtDlDownloadModal,
  onDownloadFromHypeddit,
  onRunYtDlDownload,
  onDownloadCover,
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
  const [showHypedditDownloadModal, setShowHypedditDownloadModal] = useState(false);
  const [showHypedditOverwriteOption, setShowHypedditOverwriteOption] = useState(false);
  const [hypedditModalShouldAutoClose, setHypedditModalShouldAutoClose] = useState(false);
  const [hypedditDownloadStarted, setHypedditDownloadStarted] = useState(false);
  const [showYtDlDownloadModal, setShowYtDlDownloadModal] = useState(false);
  const [showYtDlOverwriteOption, setShowYtDlOverwriteOption] = useState(false);
  const [ytDlModalShouldAutoClose, setYtDlModalShouldAutoClose] = useState(false);
  const [ytDlDownloadStarted, setYtDlDownloadStarted] = useState(false);
  const [showMoveTrackModal, setShowMoveTrackModal] = useState(false);

  useEffect(() => {
    if (availableMoveTargetPlaylists.length === 0) {
      setShowMoveTrackModal(false);
    }
  }, [availableMoveTargetPlaylists.length]);

  useEffect(() => {
    if (!showHypedditDownloadModal || !hypedditModalShouldAutoClose) {
      return;
    }

    if (downloadingFromHypeddit) {
      if (!hypedditDownloadStarted) {
        setHypedditDownloadStarted(true);
      }
      return;
    }

    if (!hypedditDownloadStarted) {
      return;
    }

    setShowHypedditDownloadModal(false);
    setShowHypedditOverwriteOption(false);
    setOverwriteExistingHypedditDownload(false);
    setHypedditModalShouldAutoClose(false);
    setHypedditDownloadStarted(false);
  }, [
    showHypedditDownloadModal,
    hypedditModalShouldAutoClose,
    hypedditDownloadStarted,
    downloadingFromHypeddit,
    setOverwriteExistingHypedditDownload,
  ]);

  useEffect(() => {
    if (!showYtDlDownloadModal || !ytDlModalShouldAutoClose) {
      return;
    }

    if (downloadingFromYtDl) {
      if (!ytDlDownloadStarted) {
        setYtDlDownloadStarted(true);
      }
      return;
    }

    if (!ytDlDownloadStarted) {
      return;
    }

    setShowYtDlDownloadModal(false);
    setShowYtDlOverwriteOption(false);
    setOverwriteExistingHypedditDownload(false);
    setYtDlModalShouldAutoClose(false);
    setYtDlDownloadStarted(false);
  }, [
    showYtDlDownloadModal,
    ytDlModalShouldAutoClose,
    ytDlDownloadStarted,
    downloadingFromYtDl,
    setOverwriteExistingHypedditDownload,
  ]);

  function closeMoveTrackModal() {
    setShowMoveTrackModal(false);
  }

  function closeHypedditDownloadModal() {
    setShowHypedditDownloadModal(false);
    setShowHypedditOverwriteOption(false);
    setHypedditModalShouldAutoClose(false);
    setHypedditDownloadStarted(false);
    if (!downloadingFromHypeddit) {
      setOverwriteExistingHypedditDownload(false);
    }
  }

  async function openHypedditDownloadModal() {
    const shouldShowOverwrite = await onPrepareHypedditDownloadModal();
    setShowHypedditOverwriteOption(shouldShowOverwrite);
    setShowHypedditDownloadModal(true);
  }

  function closeYtDlDownloadModal() {
    setShowYtDlDownloadModal(false);
    setShowYtDlOverwriteOption(false);
    setYtDlModalShouldAutoClose(false);
    setYtDlDownloadStarted(false);
    if (!downloadingFromYtDl) {
      setOverwriteExistingHypedditDownload(false);
    }
  }

  async function openYtDlDownloadModal() {
    const shouldShowOverwrite = await onPrepareYtDlDownloadModal();
    setShowYtDlOverwriteOption(shouldShowOverwrite);
    setShowYtDlDownloadModal(true);
  }

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

            {selectedTrackInfo.artwork_url ? (
              <button
                type="button"
                onClick={onDownloadCover}
                disabled={downloadingCover}
              >
                {downloadingCover ? t("coverDownloadRunning") : t("coverDownloadButton")}
              </button>
            ) : null}

            {canDownloadSelectedTrackFromHypeddit ? (
              <button
                type="button"
                onClick={() => {
                  void openHypedditDownloadModal();
                }}
                disabled={downloadingFromHypeddit}
              >
                {downloadingFromHypeddit ? t("hypedditDownloadRunning") : t("hypedditDownloadButton")}
              </button>
            ) : null}

            {canRunYtDlDownload ? (
              <button
                type="button"
                onClick={() => {
                  void openYtDlDownloadModal();
                }}
                disabled={downloadingFromYtDl}
              >
                {downloadingFromYtDl ? t("ytdlUtilityRunning") : t("ytdlUtilityButton")}
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

            {availableMoveTargetPlaylists.length > 0 ? (
              <button
                type="button"
                onClick={() => setShowMoveTrackModal(true)}
                disabled={movingTrackBetweenPlaylists || targetPlaylistIdForMove === ""}
              >
                {movingTrackBetweenPlaylists ? t("moveTrackRunning") : t("moveTrackOpenModalButton")}
              </button>
            ) : null}
          </div>

          {availableMoveTargetPlaylists.length === 0 ? (
            <p className="spectrogram-preview-meta">{t("moveTrackNoCompatibleTarget")}</p>
          ) : null}
        </section>

        <CenteredModal
          open={showHypedditDownloadModal}
          title={t("hypedditDownloadModalTitle")}
          closeLabel={t("close")}
          onClose={closeHypedditDownloadModal}
          showCloseButton={false}
          actions={(
            <>
              <button
                type="button"
                onClick={closeHypedditDownloadModal}
                disabled={downloadingFromHypeddit}
              >
                {t("globalAudioAnalysisCancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setHypedditModalShouldAutoClose(true);
                  onDownloadFromHypeddit();
                }}
                disabled={!canDownloadSelectedTrackFromHypeddit || downloadingFromHypeddit}
              >
                {downloadingFromHypeddit ? t("hypedditDownloadRunning") : t("hypedditDownloadConfirm")}
              </button>
            </>
          )}
        >
          <label className="setting-toggle actions-option">
            <input
              type="checkbox"
              checked={hypedditDownloadRenameWithSoundcloudTitle}
              onChange={(event) => onSaveHypedditDownloadRenameWithSoundcloudTitle(event.currentTarget.checked)}
              disabled={downloadingFromHypeddit}
            />
            <span>{t("downloadRenameSetting")}</span>
          </label>

          <label className="setting-toggle actions-option">
            <input
              type="checkbox"
              checked={hypedditDownloadEmbedCover}
              onChange={(event) => onSaveHypedditDownloadEmbedCover(event.currentTarget.checked)}
              disabled={downloadingFromHypeddit}
            />
            <span>{t("downloadEmbedCoverSetting")}</span>
          </label>

          {showHypedditOverwriteOption ? (
            <>
              <p className="centered-modal-warning">{t("hypedditDownloadModalExistingFileWarning")}</p>
              <label className="setting-toggle actions-option">
                <input
                  type="checkbox"
                  checked={overwriteExistingHypedditDownload}
                  onChange={(event) => setOverwriteExistingHypedditDownload(event.currentTarget.checked)}
                  disabled={downloadingFromHypeddit}
                />
                <span>{t("hypedditDownloadOverwriteLabel")}</span>
              </label>
            </>
          ) : null}

          {downloadingFromHypeddit ? <p className="status">{getHypedditProgressLabel(hypedditDownloadPhase)}</p> : null}
        </CenteredModal>

        <CenteredModal
          open={showYtDlDownloadModal}
          title={t("ytdlDownloadModalTitle")}
          closeLabel={t("close")}
          onClose={closeYtDlDownloadModal}
          showCloseButton={false}
          actions={(
            <>
              <button
                type="button"
                onClick={closeYtDlDownloadModal}
                disabled={downloadingFromYtDl}
              >
                {t("globalAudioAnalysisCancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setYtDlModalShouldAutoClose(true);
                  onRunYtDlDownload();
                }}
                disabled={!canRunYtDlDownload || downloadingFromYtDl}
              >
                {downloadingFromYtDl ? t("ytdlUtilityRunning") : t("hypedditDownloadConfirm")}
              </button>
            </>
          )}
        >
          <p className="centered-modal-note">{t("ytdlDownloadModalDescription")}</p>

          <label className="setting-toggle actions-option">
            <input
              type="checkbox"
              checked={ytdlDownloadRenameWithSoundcloudTitle}
              onChange={(event) => onSaveYtDlDownloadRenameWithSoundcloudTitle(event.currentTarget.checked)}
              disabled={downloadingFromYtDl}
            />
            <span>{t("downloadRenameSetting")}</span>
          </label>

          <label className="setting-toggle actions-option">
            <input
              type="checkbox"
              checked={ytdlDownloadEmbedCover}
              onChange={(event) => onSaveYtDlDownloadEmbedCover(event.currentTarget.checked)}
              disabled={downloadingFromYtDl}
            />
            <span>{t("downloadEmbedCoverSetting")}</span>
          </label>

          {showYtDlOverwriteOption ? (
            <>
              <p className="centered-modal-warning">{t("ytdlDownloadModalExistingFileWarning")}</p>
              <label className="setting-toggle actions-option">
                <input
                  type="checkbox"
                  checked={overwriteExistingHypedditDownload}
                  onChange={(event) => setOverwriteExistingHypedditDownload(event.currentTarget.checked)}
                  disabled={downloadingFromYtDl}
                />
                <span>{t("hypedditDownloadOverwriteLabel")}</span>
              </label>
            </>
          ) : null}

          {downloadingFromYtDl ? <p className="status">{t("ytdlUtilityRunning")}</p> : null}
        </CenteredModal>

        <CenteredModal
          open={showMoveTrackModal}
          title={t("moveTrackModalTitle")}
          closeLabel={t("close")}
          onClose={closeMoveTrackModal}
          showCloseButton={false}
          actions={(
            <>
              <button
                type="button"
                onClick={closeMoveTrackModal}
                disabled={movingTrackBetweenPlaylists}
              >
                {t("globalAudioAnalysisCancel")}
              </button>
              <button
                type="button"
                onClick={() => {
                  onMoveTrack();
                  closeMoveTrackModal();
                }}
                disabled={movingTrackBetweenPlaylists || targetPlaylistIdForMove === ""}
              >
                {movingTrackBetweenPlaylists ? t("moveTrackRunning") : t("moveTrackModalConfirm")}
              </button>
            </>
          )}
        >
          <p className="centered-modal-note">{t("moveTrackModalDescription")}</p>
          <label className="centered-modal-field" htmlFor="move-track-target-playlist">
            <span>{t("moveTrackToPlaylistLabel")}</span>
            <select
              id="move-track-target-playlist"
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
          </label>
          <p className="centered-modal-warning">{t("moveTrackModalWarningLocalAndSc")}</p>
          <p className="centered-modal-warning">{t("moveTrackModalWarningRekordbox")}</p>
        </CenteredModal>

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
                  <button
                    type="button"
                    onClick={onAssociateLocalFileByName}
                    disabled={associatingLocalFileByName}
                  >
                    {associatingLocalFileByName ? t("localAssociateByNameRunning") : t("localAssociateByNameButton")}
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
