# Glazer — SoundCloud Playlist Manager (Tauri)

Application desktop pour gérer des playlists SoundCloud, associer des fichiers audio locaux, et analyser leur qualité audio.

## Stack

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2
- Backend: Rust
- Base locale: SQLite (`rusqlite`)
- Analyse audio: `symphonia`, `rustfft`, `image`

## Fonctionnalités actuelles

- Auth SoundCloud + synchronisation des playlists.
- Auth Spotify (connexion disponible dans Réglages).
- Association d'un dossier local à une playlist SoundCloud.
- Association/dissociation manuelle d'un fichier local par track.
- Métadonnées locales: format, bitrate, sample rate, canaux, taille, etc.
- Analyse spectrogramme locale (native Rust) avec:
	- aperçu à la demande,
	- export JPG,
	- estimation de coupure fréquentielle,
	- override manuel de la valeur de coupure.
- Persistance de la coupure dans `Fréquence max` + recalcul `Qualité audio`.
- Actions playlist globales:
	- analyse globale des tracks locales (cutoff uniquement, sans génération d'image),
	- confirmation en 2 clics avec disclaimer,
	- option pour remplacer les analyses existantes.
- Filtres: téléchargement, local, qualité audio, tri, vue liste/icônes.

## Important (analyse fréquentielle)

- Les valeurs de coupure sont des estimations.
- Toujours valider visuellement avec le spectrogramme quand une décision est importante.

## Configuration OAuth (local)

1. Copier le template:

```bash
cp src-tauri/.env.example src-tauri/.env
```

2. Renseigner `src-tauri/.env`:

```dotenv
SOUNDCLOUD_CLIENT_ID=...
SOUNDCLOUD_CLIENT_SECRET=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

3. Redirect URIs (fixes):

- SoundCloud: `http://127.0.0.1:4567/callback`
- Spotify: `http://127.0.0.1:4568/callback`

`src-tauri/.env` est ignoré par git.

## Prérequis

- Node.js 20+
- Rust (`rustup`)
- Prérequis Tauri: https://tauri.app/start/prerequisites/

## Lancer en dev

```bash
npm install
npx playwright install chromium
npm run tauri dev
```

## Build

```bash
npm run build
npm run tauri build
```

## Notes

- Les ports OAuth doivent être libres: `4567` (SoundCloud), `4568` (Spotify).
- Les actions/analyses locales nécessitent un dossier local associé à la playlist.
