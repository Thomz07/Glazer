import type { Language, TranslationKey } from "../i18n";
import type {
  CoverQuality,
  DebugSettings,
  HypedditConversionFormat,
  PlaylistCoverMode,
  SoundCloudConfigStatus,
  SpectrogramAnalysisScope,
  ThemeMode,
} from "../types";

type SettingsViewProps = {
  t: (key: TranslationKey) => string;
  themeMode: ThemeMode;
  panelCoverQuality: CoverQuality;
  language: Language;
  playlistCoverMode: PlaylistCoverMode;
  savingPlaylistCoverMode: boolean;
  spectrogramAnalysisScope: SpectrogramAnalysisScope;
  analysisAutoApplyFrequencyMax: boolean;
  downloadEmbedCover: boolean;
  downloadRenameWithSoundcloudTitle: boolean;
  hypedditDownloadConversionFormat: HypedditConversionFormat;
  hypedditDownloadStartTimeoutSeconds: number;
  hypedditDownloadHeadless: boolean;
  hypedditDownloadComment: string;
  setHypedditDownloadComment: (value: string) => void;
  hypedditDownloadName: string;
  setHypedditDownloadName: (value: string) => void;
  hypedditDownloadEmail: string;
  setHypedditDownloadEmail: (value: string) => void;
  connecting: boolean;
  connectingPlaywrightSoundcloud: boolean;
  connectingPlaywrightSpotify: boolean;
  configStatus: SoundCloudConfigStatus | null;
  debugSettings: DebugSettings;
  onThemeChange: (mode: ThemeMode) => void;
  onPanelCoverQualityChange: (quality: CoverQuality) => void;
  onLanguageChange: (language: Language) => void;
  onSavePlaylistCoverMode: (mode: PlaylistCoverMode) => void;
  onSpectrogramAnalysisScopeChange: (scope: SpectrogramAnalysisScope) => void;
  onSaveAnalysisAutoApplyFrequencyMax: (enabled: boolean) => void;
  onSaveDownloadEmbedCover: (enabled: boolean) => void;
  onSaveDownloadRenameWithSoundcloudTitle: (enabled: boolean) => void;
  onSaveHypedditDownloadConversionFormat: (format: HypedditConversionFormat) => void;
  setHypedditDownloadStartTimeoutSeconds: (value: number) => void;
  onSaveHypedditDownloadStartTimeoutSeconds: () => void;
  onSaveHypedditDownloadHeadless: (enabled: boolean) => void;
  onSaveHypedditDownloadComment: () => void;
  onSaveHypedditDownloadName: () => void;
  onSaveHypedditDownloadEmail: () => void;
  onToggleSoundCloud: () => void;
  onConnectPlaywrightSoundcloud: () => void;
  onConnectPlaywrightSpotify: () => void;
  onSaveFallbackHeadless: (enabled: boolean) => void;
  onSaveLogsEnabled: (enabled: boolean) => void;
};

export function SettingsView({
  t,
  themeMode,
  panelCoverQuality,
  language,
  playlistCoverMode,
  savingPlaylistCoverMode,
  spectrogramAnalysisScope,
  analysisAutoApplyFrequencyMax,
  downloadEmbedCover,
  downloadRenameWithSoundcloudTitle,
  hypedditDownloadConversionFormat,
  hypedditDownloadStartTimeoutSeconds,
  hypedditDownloadHeadless,
  hypedditDownloadComment,
  setHypedditDownloadComment,
  hypedditDownloadName,
  setHypedditDownloadName,
  hypedditDownloadEmail,
  setHypedditDownloadEmail,
  connecting,
  connectingPlaywrightSoundcloud,
  connectingPlaywrightSpotify,
  configStatus,
  debugSettings,
  onThemeChange,
  onPanelCoverQualityChange,
  onLanguageChange,
  onSavePlaylistCoverMode,
  onSpectrogramAnalysisScopeChange,
  onSaveAnalysisAutoApplyFrequencyMax,
  onSaveDownloadEmbedCover,
  onSaveDownloadRenameWithSoundcloudTitle,
  onSaveHypedditDownloadConversionFormat,
  setHypedditDownloadStartTimeoutSeconds,
  onSaveHypedditDownloadStartTimeoutSeconds,
  onSaveHypedditDownloadHeadless,
  onSaveHypedditDownloadComment,
  onSaveHypedditDownloadName,
  onSaveHypedditDownloadEmail,
  onToggleSoundCloud,
  onConnectPlaywrightSoundcloud,
  onConnectPlaywrightSpotify,
  onSaveFallbackHeadless,
  onSaveLogsEnabled,
}: SettingsViewProps) {
  const soundCloudConnectedAccountName = configStatus?.connected_account_name?.trim();

  return (
    <>
      <h2>{t("settingsTitle")}</h2>

      <div className="settings-cards-grid">
        <section className="settings-card">
          <h3>{t("interfaceTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={themeMode === "dark"}
              onChange={(event) => onThemeChange(event.currentTarget.checked ? "dark" : "light")}
            />
            <span>{t("darkModeEnabled")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("languageLabel")}</span>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.currentTarget.value as Language)}
            >
              <option value="fr">{t("languageFrench")}</option>
              <option value="en">{t("languageEnglish")}</option>
              <option value="es">{t("languageSpanish")}</option>
              <option value="de">{t("languageGerman")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("coverQualityLabel")}</span>
            <select
              value={panelCoverQuality}
              onChange={(event) => onPanelCoverQualityChange(event.currentTarget.value as CoverQuality)}
            >
              <option value="large">{t("qualityStandard")}</option>
              <option value="t300x300">{t("quality300")}</option>
              <option value="t500x500">{t("quality500")}</option>
              <option value="original">{t("qualityOriginal")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("playlistCoverModeLabel")}</span>
            <select
              value={playlistCoverMode}
              onChange={(event) => onSavePlaylistCoverMode(event.currentTarget.value as PlaylistCoverMode)}
              disabled={savingPlaylistCoverMode}
            >
              <option value="first">{t("playlistCoverModeFirst")}</option>
              <option value="random">{t("playlistCoverModeRandom")}</option>
            </select>
          </label>
        </section>

        <section className="settings-card">
          <h3>{t("analysisSettingsTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <span>{t("spectrogramScopeLabel")}</span>
            <select
              value={spectrogramAnalysisScope}
              onChange={(event) => onSpectrogramAnalysisScopeChange(event.currentTarget.value as SpectrogramAnalysisScope)}
            >
              <option value="quarter">{t("spectrogramScopeQuarter")}</option>
              <option value="half">{t("spectrogramScopeHalf")}</option>
              <option value="full">{t("spectrogramScopeFull")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={analysisAutoApplyFrequencyMax}
              onChange={(event) => onSaveAnalysisAutoApplyFrequencyMax(event.currentTarget.checked)}
            />
            <span>{t("analysisAutoApplyFrequencyMaxSetting")}</span>
          </label>
        </section>

        <section className="settings-card">
          <h3>{t("downloadSettingsTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={downloadEmbedCover}
              onChange={(event) => onSaveDownloadEmbedCover(event.currentTarget.checked)}
            />
            <span>{t("downloadEmbedCoverSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={downloadRenameWithSoundcloudTitle}
              onChange={(event) => onSaveDownloadRenameWithSoundcloudTitle(event.currentTarget.checked)}
            />
            <span>{t("downloadRenameSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadConversionFormatLabel")}</span>
            <select
              value={hypedditDownloadConversionFormat}
              onChange={(event) => onSaveHypedditDownloadConversionFormat(event.currentTarget.value as HypedditConversionFormat)}
            >
              <option value="original">{t("downloadConversionFormatOriginal")}</option>
              <option value="mp3_320">{t("downloadConversionFormatMp3320")}</option>
              <option value="mp3_256">{t("downloadConversionFormatMp3256")}</option>
              <option value="mp3_192">{t("downloadConversionFormatMp3192")}</option>
              <option value="aac_320">{t("downloadConversionFormatAac320")}</option>
              <option value="aac_256">{t("downloadConversionFormatAac256")}</option>
              <option value="wav">{t("downloadConversionFormatWav")}</option>
              <option value="flac">{t("downloadConversionFormatFlac")}</option>
            </select>
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadStartTimeoutSecondsLabel")}</span>
            <input
              type="number"
              min={5}
              max={300}
              step={1}
              value={hypedditDownloadStartTimeoutSeconds}
              onChange={(event) => {
                const parsed = Number.parseInt(event.currentTarget.value, 10);
                if (Number.isNaN(parsed)) {
                  return;
                }
                setHypedditDownloadStartTimeoutSeconds(parsed);
              }}
              onBlur={onSaveHypedditDownloadStartTimeoutSeconds}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveHypedditDownloadStartTimeoutSeconds();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditCommentLabel")}</span>
            <input
              type="text"
              value={hypedditDownloadComment}
              placeholder={t("downloadHypedditCommentPlaceholder")}
              onChange={(event) => setHypedditDownloadComment(event.currentTarget.value)}
              onBlur={onSaveHypedditDownloadComment}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveHypedditDownloadComment();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditNameLabel")}</span>
            <input
              type="text"
              value={hypedditDownloadName}
              placeholder={t("downloadHypedditNamePlaceholder")}
              onChange={(event) => setHypedditDownloadName(event.currentTarget.value)}
              onBlur={onSaveHypedditDownloadName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveHypedditDownloadName();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>

          <label className="setting-toggle auth-actions">
            <span>{t("downloadHypedditEmailLabel")}</span>
            <input
              type="email"
              value={hypedditDownloadEmail}
              placeholder={t("downloadHypedditEmailPlaceholder")}
              onChange={(event) => setHypedditDownloadEmail(event.currentTarget.value)}
              onBlur={onSaveHypedditDownloadEmail}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  onSaveHypedditDownloadEmail();
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </section>

        <section className="settings-card settings-card-connections">
          <h3>{t("connectionsTitle")}</h3>

          <h4 className="connection-subtitle">{t("connectionsApiTitle")}</h4>
          <p className="spectrogram-preview-meta">{t("connectionsApiHint")}</p>

          <div className="actions auth-actions connection-actions">
            <button
              type="button"
              className="connect-btn connect-btn-soundcloud"
              onClick={onToggleSoundCloud}
              disabled={connecting}
              aria-label={
                connecting
                  ? t("connectingSoundcloud")
                  : configStatus?.connected
                    ? t("disconnectSoundcloud")
                    : t("connectSoundcloud")
              }
            >
              <img
                src={configStatus?.connected ? "/brand/soundcloud-disconnect-official.png" : "/brand/soundcloud-connect-official.png"}
                className="connect-btn-official-soundcloud"
                alt={
                  connecting
                    ? t("connectingSoundcloud")
                    : configStatus?.connected
                      ? t("disconnectSoundcloud")
                      : t("connectSoundcloud")
                }
                draggable={false}
              />
            </button>
          </div>
          {configStatus?.connected ? (
            <p className="connection-account-label">
              {soundCloudConnectedAccountName ? `${t("connectedAs")} ${soundCloudConnectedAccountName}` : t("connected")}
            </p>
          ) : null}

          <h4 className="connection-subtitle">{t("connectionsPlaywrightTitle")}</h4>
          <p className="spectrogram-preview-meta">{t("connectionsPlaywrightHint")}</p>

          <div className="actions auth-actions connection-actions">
            <button
              type="button"
              className="connect-btn connect-btn-soundcloud"
              onClick={onConnectPlaywrightSoundcloud}
              disabled={connectingPlaywrightSoundcloud}
              aria-label={connectingPlaywrightSoundcloud ? t("playwrightSessionConnecting") : t("playwrightSessionConnectSoundcloud")}
            >
              <img
                src="/brand/soundcloud-connect-official.png"
                className="connect-btn-official-soundcloud"
                alt={connectingPlaywrightSoundcloud ? t("playwrightSessionConnecting") : t("playwrightSessionConnectSoundcloud")}
                draggable={false}
              />
            </button>

            <button
              type="button"
              className="connect-btn connect-btn-spotify"
              onClick={onConnectPlaywrightSpotify}
              disabled={connectingPlaywrightSpotify}
              aria-label={connectingPlaywrightSpotify ? t("playwrightSessionConnecting") : t("playwrightSessionConnectSpotify")}
            >
              <img
                src="/brand/spotify-connect-official.png"
                className="connect-btn-official-spotify"
                alt={connectingPlaywrightSpotify ? t("playwrightSessionConnecting") : t("playwrightSessionConnectSpotify")}
                draggable={false}
              />
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h3>{t("debugTitle")}</h3>
          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={hypedditDownloadHeadless}
              onChange={(event) => onSaveHypedditDownloadHeadless(event.currentTarget.checked)}
            />
            <span>{t("downloadHypedditHeadlessSetting")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={debugSettings.soundcloud_fallback_headless}
              onChange={(event) => onSaveFallbackHeadless(event.currentTarget.checked)}
            />
            <span>{t("headlessEnabled")}</span>
          </label>

          <label className="setting-toggle auth-actions">
            <input
              type="checkbox"
              checked={debugSettings.logs_enabled}
              onChange={(event) => onSaveLogsEnabled(event.currentTarget.checked)}
            />
            <span>{t("logsEnabled")}</span>
          </label>
        </section>
      </div>
    </>
  );
}
