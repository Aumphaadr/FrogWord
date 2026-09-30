# FrogWord

FrogWord is an alpha desktop word game for Twitch streams. Viewers join from
chat, move across a letter board, collect word buffers and score points when
their route forms a valid word from the selected theme.

The project is intentionally built around a small pure game core, with Twitch,
storage and UI kept outside that core. That should make it possible to keep
iterating on stream-facing features without turning every gameplay change into
a rewrite.

## Current Status

FrogWord is playable in local development:

- viewers can join and move with chat commands;
- words are accepted automatically when a collected buffer matches the current
  theme;
- the host can run a round from the desktop UI, use fake chat for testing,
  import theme banks, moderate players and inspect the session audit log;
- a separate OBS-safe Game View window renders the public board without host
  controls;
- Twitch Device Code authorization works for a streamer reader account and a
  separate sender/bot account;
- Twitch chat reading supports reconnect/backoff and persisted OAuth sessions;
- round snapshots are persisted locally and the app asks whether to continue or
  start fresh on launch.
- a static GitHub Pages build can run an online anonymous-read chat mode without
  streamer OAuth.

This is still an alpha project. In particular, packaged builds and production
secret storage are not final yet.

## Gameplay Commands

Supported chat commands currently include Russian and English aliases:

```text
!играть / !play       join the current round
!п3 / !r3             move right 3 cells
!л2 / !l2             move left 2 cells
!в1 / !u1             move up 1 cell
!н4 / !d4             move down 4 cells
!слово / !word        manually submit the current buffer
!уйти / !quit         leave the round
!фрогворд / !frogword show help command intent
```

Movement commands can be combined in one message, for example:

```text
!п3 л2 в1
```

## Repository Layout

```text
apps/desktop/       Tauri 2 + React desktop app and host/game-view UI
packages/core/      Pure gameplay domain: board, commands, scoring, projections
packages/storage/   SQLite schema, migrations and repositories behind SqlDatabase
scripts/            Project maintenance and import-preview utilities
tools/              Guards and generators: npm run check, icons, frogs, licenses
third-party/        Generated list of Rust crates linked into the desktop app
docs/               Built web version for GitHub Pages (npm run build:pages)
spec/               Local design drafts, ignored by git
misc/               User-owned content scratch space, ignored by git
```

`misc/` is deliberately outside the app pipeline for now. Theme content can be
authored there or elsewhere, but importing into FrogWord should happen through
explicit JSON files and import tools, not by silently scanning that directory.

## Requirements

For the web renderer and tests:

- Node.js with npm;
- the dependencies from `package-lock.json`.

For the native Tauri app:

- Rust/Cargo;
- WebKitGTK and the other system packages from the
  [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/).

## Getting Started

Install dependencies:

```bash
npm install
```

Run the desktop renderer as a plain Vite web app:

```bash
npm run dev:desktop
```

Run the native Tauri desktop app:

```bash
npm run tauri:dev
```

Build the GitHub Pages online game into `docs/`:

```bash
npm run build:pages
```

Run checks:

```bash
npm run typecheck
npm test
npm run build
npm run check
```

`npm run check` runs the project guards: no external downloads (fonts and icons
are files in this repository, never CDN or GitHub links), icons and frogs match
their sources, license files sit next to third-party files, and every library
shipped to users has a license from the allow list. Details are in
[`CONTRIBUTING.md`](CONTRIBUTING.md) (in Russian).

## Twitch Setup

Create a Twitch developer app and use its Client ID in the FrogWord host UI.
The current flow uses Device Code authorization:

- `Chat reader` is the streamer account and reads that channel's chat;
- `Chat sender` is intended for a separate bot account and requests chat send
  permissions;
- FrogWord copies the activation link and code to the clipboard instead of
  opening a browser automatically, so the host can choose the correct browser
  profile/account;
- successful tokens are persisted locally and refreshed when possible.

Current alpha storage keeps Twitch tokens in the local SQLite app database.
Before production packaging, this should move to OS secret storage.

## Theme Banks

Theme banks use explicit JSON input. The parser validates pack/theme/word IDs,
language, word lengths, aliases and duplicate normalized forms.

Preview a theme bank without writing to the database:

```bash
npm run theme-bank:preview -- path/to/theme-bank.json
```

The desktop app also has an explicit import UI: choose a JSON file, preview it,
then import it into local SQLite storage. Imported themes appear in the host
theme picker alongside built-in starter themes.

The first web build uses a checked-in static copy at
`apps/desktop/public/theme-bank/main.json`, copied into `docs/theme-bank/` by
the pages build.

## Architecture Notes

The core package does not know about React, Tauri, Twitch or SQLite. It accepts
normalized commands and identities, returns new round state, emits domain events
and exposes public/admin projections.

Storage is kept behind a tiny SQL interface so migrations and read models can
evolve without coupling the game engine to a concrete database driver.

The desktop app owns orchestration: local round hydration, round persistence,
theme catalog loading, Twitch auth/session maintenance, Twitch IRC connection,
host controls and the public Game View bridge.

## Roadmap Pointers

The nearest desktop slice is Twitch chat sender responses: short, rate-limited
bot messages for joins, accepted words and rejected commands/words.

The project hosts its static online game from `docs/` at:

```text
https://aumphaadr.github.io/FrogWord/
```

## License

FrogWord is released under the [MIT License](LICENSE); an unofficial Russian
translation is in [`LICENSE_RU.md`](LICENSE_RU.md). Third-party parts keep their
own terms: the Cygre font (its author's EULA, next to the font files), the
mascot frog from Noto Emoji (Apache License 2.0), icons from Klaarheid Icons
(MIT-0) and the shipped libraries. See
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md) for the full list and
[`CHANGELOG.md`](CHANGELOG.md) for changes.
