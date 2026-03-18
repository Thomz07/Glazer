import type { RefObject } from "react";
import type { TranslationKey } from "../i18n";
import type {
  AudioQualityFilter,
  DownloadSourceFilter,
  LocalDownloadFilter,
  PlaylistDetails,
  PlaylistTrack,
  TrackSortOrder,
  TrackViewMode,
} from "../types";

type PlaylistDetailsProps = {
  t: (key: TranslationKey) => string;
  selectedPlaylistDetails: PlaylistDetails;
  filteredTracks: PlaylistTrack[];
  playlistFolderPath: string;
  playlistFolderAvailable: boolean;
  loadingPlaylistFolder: boolean;
  scanningLocalFiles: boolean;
  refreshingPlaylistDetails: boolean;
  runningGlobalAudioAnalysis: boolean;
  confirmGlobalAudioAnalysis: boolean;
  overwriteExistingGlobalAnalysis: boolean;
  hasAvailableLocalFolder: boolean;
  analyzableTracksCount: number;
  estimatedGlobalAnalysisMinSeconds: number;
  estimatedGlobalAnalysisMaxSeconds: number;
  activeFilterCount: number;
  hasActiveTrackFilters: boolean;
  isFilterMenuOpen: boolean;
  isActionsMenuOpen: boolean;
  trackSortOrder: TrackSortOrder;
  downloadSourceFilter: DownloadSourceFilter;
  localDownloadFilter: LocalDownloadFilter;
  audioQualityFilter: AudioQualityFilter;
  trackViewMode: TrackViewMode;
  sectionControlsRef: RefObject<HTMLDivElement | null>;
  onClosePlaylistDetails: () => void;
  onRefreshFolderAssociation: () => void;
  onToggleTrackViewMode: () => void;
  onToggleFilterMenu: () => void;
  onToggleActionsMenu: () => void;
  setTrackSortOrder: (value: TrackSortOrder) => void;
  setDownloadSourceFilter: (value: DownloadSourceFilter) => void;
  setLocalDownloadFilter: (value: LocalDownloadFilter) => void;
  setAudioQualityFilter: (value: AudioQualityFilter) => void;
  onClearTrackFilters: () => void;
  onRefreshSelectedPlaylistDetails: () => void;
  onStartConfirmGlobalAudioAnalysis: () => void;
  onSetOverwriteExistingGlobalAnalysis: (value: boolean) => void;
  onConfirmAndRunGlobalPlaylistAudioAnalysis: () => void;
  onCancelGlobalAudioAnalysis: () => void;
  onToggleFolderScan: () => void;
  onOpenTrackInfo: (track: PlaylistTrack) => void;
  formatCount: (value?: number | null) => string;
  formatEstimatedDuration: (seconds: number) => string;
};

export function PlaylistDetailsView({
  t,
  selectedPlaylistDetails,
  filteredTracks,
  playlistFolderPath,
  playlistFolderAvailable,
  loadingPlaylistFolder,
  scanningLocalFiles,
  refreshingPlaylistDetails,
  runningGlobalAudioAnalysis,
  confirmGlobalAudioAnalysis,
  overwriteExistingGlobalAnalysis,
  hasAvailableLocalFolder,
  analyzableTracksCount,
  estimatedGlobalAnalysisMinSeconds,
  estimatedGlobalAnalysisMaxSeconds,
  activeFilterCount,
  hasActiveTrackFilters,
  isFilterMenuOpen,
  isActionsMenuOpen,
  trackSortOrder,
  downloadSourceFilter,
  localDownloadFilter,
  audioQualityFilter,
  trackViewMode,
  sectionControlsRef,
  onClosePlaylistDetails,
  onRefreshFolderAssociation,
  onToggleTrackViewMode,
  onToggleFilterMenu,
  onToggleActionsMenu,
  setTrackSortOrder,
  setDownloadSourceFilter,
  setLocalDownloadFilter,
  setAudioQualityFilter,
  onClearTrackFilters,
  onRefreshSelectedPlaylistDetails,
  onStartConfirmGlobalAudioAnalysis,
  onSetOverwriteExistingGlobalAnalysis,
  onConfirmAndRunGlobalPlaylistAudioAnalysis,
  onCancelGlobalAudioAnalysis,
  onToggleFolderScan,
  onOpenTrackInfo,
  formatCount,
  formatEstimatedDuration,
}: PlaylistDetailsProps) {
  return (
    <section className="tracks-column">
      <div className="local-folder-association">
        <div className="local-folder-meta">
          <label>
            {playlistFolderPath ? t("localFolderLabel") : t("localNoFolderLabel")}
          </label>
          {playlistFolderPath ? <p className="local-folder-path">{playlistFolderPath}</p> : null}
          {playlistFolderPath && !playlistFolderAvailable ? (
            <div className="local-folder-warning-row">
              <p className="local-folder-warning">{t("localFolderUnavailable")}</p>
              <button
                type="button"
                onClick={onRefreshFolderAssociation}
                disabled={loadingPlaylistFolder}
              >
                {t("refresh")}
              </button>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClosePlaylistDetails}
        >
          {t("back")}
        </button>
      </div>

      <div className="section-head">
        <div className="section-head-main">
          <h2>{selectedPlaylistDetails.title}</h2>
          <p className="playlist-title-meta-inline">
            {filteredTracks.length}/{selectedPlaylistDetails.track_count} {t("tracksUnit")} • {selectedPlaylistDetails.is_private ? t("private") : t("public")}
          </p>
        </div>
        <div className="section-head-controls" ref={sectionControlsRef}>
          <button
            type="button"
            className="icon-toggle-btn"
            aria-label={trackViewMode === "list" ? t("viewModeIcons") : t("viewModeList")}
            title={trackViewMode === "list" ? t("viewModeIcons") : t("viewModeList")}
            onClick={onToggleTrackViewMode}
          >
            {trackViewMode === "list" ? (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="4" y="5" width="16" height="3" rx="1.5" />
                <rect x="4" y="10.5" width="16" height="3" rx="1.5" />
                <rect x="4" y="16" width="16" height="3" rx="1.5" />
              </svg>
            )}
          </button>
          <button
            type="button"
            onClick={onToggleFilterMenu}
          >
            {hasActiveTrackFilters ? `${t("filterButton")} (${activeFilterCount})` : t("filterButton")}
          </button>
          <button
            type="button"
            onClick={onToggleActionsMenu}
          >
            {t("actionsButton")}
          </button>

          {isFilterMenuOpen ? (
            <div className="filter-menu">
              <h4>{t("filtersTitle")}</h4>
              <label className="filter-option filter-option-select">
                <span>{t("sortOrderLabel")}</span>
                <select
                  value={trackSortOrder}
                  onChange={(event) => setTrackSortOrder(event.currentTarget.value as TrackSortOrder)}
                >
                  <option value="original">{t("sortOriginal")}</option>
                  <option value="alphabetical">{t("sortAlphabetical")}</option>
                  <option value="mostPlayed">{t("sortMostPlayed")}</option>
                </select>
              </label>

              <label className="filter-option filter-option-select">
                <span>{t("downloadFilterLabel")}</span>
                <select
                  value={downloadSourceFilter}
                  onChange={(event) => setDownloadSourceFilter(event.currentTarget.value as DownloadSourceFilter)}
                >
                  <option value="all">{t("downloadAll")}</option>
                  <option value="downloadable">{t("downloadAny")}</option>
                  <option value="hypeddit">{t("downloadHypeddit")}</option>
                  <option value="bandcamp">{t("downloadBandcamp")}</option>
                </select>
              </label>

              {playlistFolderPath ? (
                <label className="filter-option filter-option-select">
                  <span>{t("localDownloadFilterLabel")}</span>
                  <select
                    value={localDownloadFilter}
                    onChange={(event) => setLocalDownloadFilter(event.currentTarget.value as LocalDownloadFilter)}
                  >
                    <option value="all">{t("localDownloadAll")}</option>
                    <option value="downloaded">{t("localDownloadOnly")}</option>
                    <option value="notDownloaded">{t("localNotDownloadedOnly")}</option>
                  </select>
                </label>
              ) : null}

              {playlistFolderPath ? (
                <label className="filter-option filter-option-select">
                  <span>{t("audioQualityFilterLabel")}</span>
                  <select
                    value={audioQualityFilter}
                    onChange={(event) => setAudioQualityFilter(event.currentTarget.value as AudioQualityFilter)}
                  >
                    <option value="all">{t("audioQualityFilterAll")}</option>
                    <option value="high">{t("localQualityHigh")}</option>
                    <option value="good">{t("localQualityGood")}</option>
                    <option value="medium">{t("localQualityMedium")}</option>
                    <option value="low">{t("localQualityLow")}</option>
                    <option value="unknown">{t("audioQualityFilterUnknown")}</option>
                  </select>
                </label>
              ) : null}
              <button type="button" className="filter-reset" onClick={onClearTrackFilters}>
                {t("clearFilters")}
              </button>
            </div>
          ) : null}

          {isActionsMenuOpen ? (
            <div className="actions-menu">
              <h4>{t("actionsTitle")}</h4>
              <button
                type="button"
                className="filter-reset"
                onClick={onRefreshSelectedPlaylistDetails}
                disabled={refreshingPlaylistDetails || runningGlobalAudioAnalysis}
              >
                {refreshingPlaylistDetails ? t("playlistRefreshRunning") : t("playlistRefreshAction")}
              </button>
              {hasAvailableLocalFolder && !confirmGlobalAudioAnalysis ? (
                <button
                  type="button"
                  className="filter-reset"
                  onClick={onStartConfirmGlobalAudioAnalysis}
                  disabled={runningGlobalAudioAnalysis}
                >
                  {runningGlobalAudioAnalysis ? t("globalAudioAnalysisRunning") : t("globalAudioAnalysisAction")}
                </button>
              ) : null}
              {hasAvailableLocalFolder && confirmGlobalAudioAnalysis ? (
                <>
                  <p className="actions-disclaimer">{t("globalAudioAnalysisDisclaimer")}</p>
                  <p className="actions-disclaimer">
                    {t("globalAudioAnalysisEstimatePrefix")} {formatCount(analyzableTracksCount)} {t("tracksUnit")} : {formatEstimatedDuration(estimatedGlobalAnalysisMinSeconds)} - {formatEstimatedDuration(estimatedGlobalAnalysisMaxSeconds)}
                  </p>
                  <label className="setting-toggle actions-option">
                    <input
                      type="checkbox"
                      checked={overwriteExistingGlobalAnalysis}
                      onChange={(event) => onSetOverwriteExistingGlobalAnalysis(event.currentTarget.checked)}
                      disabled={runningGlobalAudioAnalysis}
                    />
                    <span>{t("globalAudioAnalysisOverwrite")}</span>
                  </label>
                  <div className="actions">
                    <button
                      type="button"
                      className="filter-reset"
                      onClick={onConfirmAndRunGlobalPlaylistAudioAnalysis}
                      disabled={runningGlobalAudioAnalysis}
                    >
                      {runningGlobalAudioAnalysis ? t("globalAudioAnalysisRunning") : t("globalAudioAnalysisConfirm")}
                    </button>
                    <button
                      type="button"
                      onClick={onCancelGlobalAudioAnalysis}
                      disabled={runningGlobalAudioAnalysis}
                    >
                      {t("globalAudioAnalysisCancel")}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : null}

          <button
            type="button"
            onClick={onToggleFolderScan}
            disabled={loadingPlaylistFolder || scanningLocalFiles}
          >
            {scanningLocalFiles
              ? t("localScanRunning")
              : playlistFolderPath
                ? t("localUnlinkButton")
                : t("localScanButton")}
          </button>
        </div>
      </div>

      {selectedPlaylistDetails.tracks.length === 0 ? <p>{t("noTrackInPlaylist")}</p> : null}

      {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length === 0 ? <p>{t("noTrackAfterFilter")}</p> : null}

      {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length > 0 && trackViewMode === "list" ? (
        <ul className="track-list">
          {filteredTracks.map((track) => (
            <li
              key={track.id}
              className="track-item"
              onClick={() => onOpenTrackInfo(track)}
              role="button"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpenTrackInfo(track);
                }
              }}
            >
              {track.artwork_url ? (
                <img src={track.artwork_url} alt={track.title} className="track-cover" />
              ) : (
                <div className="track-cover placeholder">SC</div>
              )}
              <div className="track-main">
                <strong>{track.title}</strong>
                <p>{track.artist ?? t("unknownArtist")}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {selectedPlaylistDetails.tracks.length > 0 && filteredTracks.length > 0 && trackViewMode === "icons" ? (
        <ul className="track-icon-grid">
          {filteredTracks.map((track) => (
            <li key={track.id} className="track-icon-item">
              <button
                type="button"
                className="track-icon-btn"
                onClick={() => onOpenTrackInfo(track)}
                title={track.title}
                aria-label={track.title}
              >
                {track.artwork_url ? (
                  <img src={track.artwork_url} alt={track.title} className="track-icon-cover" />
                ) : (
                  <div className="track-icon-cover placeholder">SC</div>
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
