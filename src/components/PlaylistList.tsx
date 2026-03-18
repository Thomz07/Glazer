import type { Playlist } from "../types";
import type { TranslationKey } from "../i18n";

type PlaylistListProps = {
  playlists: Playlist[];
  loadingPlaylists: boolean;
  onSyncPlaylists: () => void;
  onOpenPlaylistDetails: (playlistId: number) => void;
  t: (key: TranslationKey) => string;
};

export function PlaylistList({
  playlists,
  loadingPlaylists,
  onSyncPlaylists,
  onOpenPlaylistDetails,
  t,
}: PlaylistListProps) {
  return (
    <>
      <div className="section-head">
        <h2>{t("myPlaylists")}</h2>
        <div className="actions">
          <button type="button" onClick={onSyncPlaylists}>
            {t("refresh")}
          </button>
        </div>
      </div>

      {loadingPlaylists ? <p>{t("loading")}</p> : null}

      {!loadingPlaylists && playlists.length === 0 ? <p>{t("noPlaylistFound")}</p> : null}

      <ul className="playlist-list">
        {playlists.map((playlist) => (
          <li
            key={playlist.id}
            className="playlist-item"
            onClick={() => onOpenPlaylistDetails(playlist.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onOpenPlaylistDetails(playlist.id);
              }
            }}
          >
            <div className="playlist-main">
              {playlist.artwork_url ? (
                <img src={playlist.artwork_url} alt={playlist.title} className="playlist-cover" />
              ) : (
                <div className="playlist-cover placeholder">SC</div>
              )}
              <div className="playlist-text">
                <div className="playlist-title-row">
                  <strong>{playlist.title}</strong>
                </div>
                <p className="playlist-meta">{playlist.track_count} {t("tracksUnit")}</p>
              </div>
            </div>
            <div className="playlist-badges">
              <span className={playlist.is_private ? "badge private" : "badge public"}>
                {playlist.is_private ? t("private") : t("public")}
              </span>
              {playlist.has_local_link ? (
                <span className="badge local" title={t("playlistLocalLinked")}>
                  {t("localBadgeShort")}
                </span>
              ) : null}
            </div>
            <span className="playlist-action" aria-label={t("openPlaylist")}>
              <span className="playlist-arrow">›</span>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
