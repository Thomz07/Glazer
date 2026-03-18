# Glazer

Gestionnaire desktop de playlists SoundCloud, avec liaison de fichiers locaux et analyse audio.

Glazer est une app Tauri (frontend React + backend Rust) pensée pour un usage DJ/curation: organiser des playlists, suivre les téléchargements locaux, et vérifier rapidement la qualite audio des tracks.

## A quoi sert Glazer

- Synchroniser tes playlists SoundCloud dans une app locale.
- Lier une playlist a un dossier sur ton disque.
- Associer ou dissocier un fichier local a une track.
- Lancer des analyses spectrogramme pour estimer la coupure frequentielle.
- Automatiser les telechargements Hypeddit (avec options de renommage, cover, commentaire).

## Fonctionnalites principales

- Connexion SoundCloud et synchronisation des playlists.
- Connexion Spotify (dans les Reglages).
- Filtres par telechargement, statut local, qualite audio, tri, mode liste/icones.
- Metadonnees locales: format, bitrate, sample rate, canaux, taille.
- Analyse locale du spectrogramme:
  - apercu a la demande,
  - export JPG,
  - estimation automatique de coupure,
  - valeur manuelle (override).
- Analyse globale d'une playlist locale (estimation de coupure, sans generation d'image).

## Demarrage rapide (dev)

### 1. Prerequis

- Node.js 20+
- npm
- Rust (`rustup`, `cargo`)
- Prerequis systeme Tauri: https://tauri.app/start/prerequisites/

### 2. Installer les dependances

```bash
npm install
npx playwright install chromium
```

### 3. Configurer OAuth en local

Copie le template d'environnement:

```bash
cp src-tauri/.env.example src-tauri/.env
```

Renseigne ensuite `src-tauri/.env`:

```dotenv
SOUNDCLOUD_CLIENT_ID=...
SOUNDCLOUD_CLIENT_SECRET=...
SPOTIFY_CLIENT_ID=...
```

Spotify utilise PKCE, donc `SPOTIFY_CLIENT_SECRET` n'est pas necessaire.

Redirect URIs a configurer cote providers:

- SoundCloud: `http://127.0.0.1:4567/callback`
- Spotify: `http://127.0.0.1:4568/callback`

Note: `src-tauri/.env` est ignore par git.

### 4. Lancer l'application

```bash
npm run tauri dev
```

Si la fenetre ne s'ouvre pas:

- Verifie les prerequis Tauri et Rust.
- Lance `npm run dev`, puis `npm run tauri dev`.
- Verifie que `http://localhost:1420` est accessible.

## Build production

```bash
npm run build
npm run tauri build
```

## Workflow recommande

1. Connecte SoundCloud dans les Reglages.
2. Synchronise les playlists.
3. Associe un dossier local a la playlist que tu geres.
4. Lance un scan local pour faire correspondre les tracks automatiquement.
5. Complete manuellement les associations manquantes si besoin.
6. Analyse la qualite audio track par track ou globalement.

## Langues de l'interface

- Francais
- English
- Espanol
- Deutsch

## Important sur l'analyse frequentielle

- Les valeurs de coupure sont des estimations.
- Pour une decision sensible, valide toujours visuellement le spectrogramme.

## Depannage rapide

- OAuth bloque: verifie que les ports `4567` et `4568` sont libres.
- Aucune playlist visible: reconnecte SoundCloud puis relance la synchronisation.
- Fonctions locales grisees: associe d'abord un dossier local a la playlist.

## Stack technique

- Frontend: React + TypeScript + Vite
- Desktop: Tauri v2
- Backend: Rust
- Base locale: SQLite (`rusqlite`)
- Analyse audio: `symphonia`, `rustfft`, `image`

## Etat du projet

Projet en evolution active. Le README est volontairement simple et sera enrichi progressivement (screenshots, FAQ plus detaillee, guide utilisateur complet).
