# Glazer — SoundCloud + Spotify Auth (Tauri)

Base de projet desktop avec:

- Frontend: React + TypeScript
- Backend natif: Rust (Tauri v2)
- Stockage local: SQLite (`rusqlite`)

Le socle inclut:

- Une vue `Playlists`
- Une vue `Réglages`
- Configuration secrète SoundCloud via `src-tauri/.env` (hors git)
- Configuration secrète Spotify via `src-tauri/.env` (hors git)
- Authentification OAuth SoundCloud complète (browser + callback local)
- Authentification OAuth Spotify complète (browser + callback local)
- Stockage local du token OAuth en SQLite
- Synchronisation des playlists réelles du compte SoundCloud
- Fenêtre en plein écran au démarrage

## Configuration OAuth (secrets locaux)

1. Copier le template:

```bash
cp src-tauri/.env.example src-tauri/.env
```

2. Remplir `src-tauri/.env` avec tes valeurs:

```dotenv
SOUNDCLOUD_CLIENT_ID=...
SOUNDCLOUD_CLIENT_SECRET=...
SPOTIFY_CLIENT_ID=...
SPOTIFY_CLIENT_SECRET=...
```

3. Redirect URI utilisées par l'app (fixes):

- SoundCloud: `http://127.0.0.1:4567/callback`
- Spotify: `http://127.0.0.1:4568/callback`

Le fichier `src-tauri/.env` est ignoré par git pour éviter de versionner les secrets.

## Prérequis (macOS)

- Node.js 20+
- Rust installé et disponible dans le PATH (`rustup`)
- Prérequis Tauri: https://tauri.app/start/prerequisites/

## Démarrage

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

## Déploiement sans manip secrets côté utilisateur

- Les secrets OAuth sont embarqués au build dans le binaire (via `src-tauri/build.rs`) si présents dans l'environnement de build ou dans `src-tauri/.env`.
- Conséquence: les utilisateurs finaux n'ont pas besoin de créer de fichier `.env` pour se connecter.
- Pour mettre à jour les secrets, il faut rebuild l'application.

⚠️ Sécurité: un secret embarqué dans une app desktop peut être extrait. Pour un niveau de sécurité production élevé, privilégier PKCE sans secret embarqué (si supporté) ou un backend OAuth dédié.

## Notes

- Si les ports locaux `127.0.0.1:4567` (SoundCloud) ou `127.0.0.1:4568` (Spotify) sont occupés, la connexion OAuth correspondante échouera tant que le port n'est pas libéré.
