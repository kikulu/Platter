# Platter

# AI Involvement ☕

Roast Level: Represents the degree of AI intervention in terms of "cups" of coffee.
More AI, less coffee. The more AI does, the less coffee humans need to drink.

<p align="center">
  <strong>English</strong> ·
  <a href="./README.ja.md">日本語</a> ·
  <a href="./README.md">繁體中文</a>
</p>

<p align="center">
  <strong>One window for all your AI accounts.</strong><br />
  A cross-platform desktop app for aggregating AI accounts — stay signed
  into Claude, ChatGPT, Gemini, and Grok at the same time, each fully
  isolated from the others.
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-informational" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-%5E31-47848F?logo=electron&logoColor=white" />
  <img alt="node" src="https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white" />
  <a href="./.github/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white" /></a>
  <img alt="license" src="https://img.shields.io/badge/license-Unlicensed-lightgrey" />
</p>

---

## Why this exists

Switching between Claude, ChatGPT, Gemini, and Grok all day means a pile
of browser tabs, accounts that keep signing each other out, and prompts
you can never find again. This app is built to fix exactly that:

- Every account is a fully isolated login session (not just switching
  accounts in the same browser tab) — no shared cookies between accounts
- One-click switching from the sidebar, instant, no re-login
- Manually export conversations you want to keep, as Markdown or JSON
- Keep your go-to prompts and skill templates in one place instead of
  retyping them

What it deliberately does **not** do is just as clear (see
[Design Principles](#design-principles)): no undocumented platform APIs,
no automation that evades anti-abuse detection, no login credentials ever
bundled into a backup file.

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Design Principles](#design-principles)
- [Architecture](#architecture)
- [Development](#development)
- [Packaging](#packaging)
- [Project Structure](#project-structure)
- [Config File Locations](#config-file-locations)
- [Documentation Index](#documentation-index)
- [Contributing](#contributing)
- [License](#license)

## Features

| Feature                             | Description                                                                                                                                                                                                                      |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🗂️ Multi-account aggregation        | Claude / ChatGPT / Gemini / Grok, each account fully isolated, instant switching                                                                                                                                                 |
| 🔐 Persistent login                 | No need to log in again after restarting the app                                                                                                                                                                                 |
| ⚡ Lazy loading                     | Only the last-active account loads on startup; others load on first click, so more accounts won't slow down startup                                                                                                              |
| 📐 Collapsible sidebar              | Collapses to an icon-only strip                                                                                                                                                                                                  |
| 🔍 Cross-module quick search        | `Ctrl/⌘+K` opens a command palette that searches the knowledge base, document library, conversation library, and projects (tasks/issues) at once, and jumps straight to the matching window and item                             |
| 📚 Knowledge base (separate window) | Ships with 25 built-in prompt templates across 5 domains (enterprise ops, medical software R&D, academic writing, research proposals, project development), full-text search, filterable by tags, exportable as Markdown or JSON |
| 🧩 Virtual Team console             | Organize accounts into a team chart by role, then create projects, split them into tasks, assign tasks to team accounts, track progress, and log hours in "Project Plans"                                                        |
| ⏰ Due-date reminders               | A sidebar badge shows how many tasks/issues are overdue or due today; a native notification fires when new items become due                                                                                                      |
| 🗃️ Document Library                 | Stores files exported from conversations plus any manually imported file; `.md` files can be previewed in place                                                                                                                  |
| ➕ Add account (separate window)    | Pick a platform, give it a custom name, and switch to it immediately                                                                                                                                                             |
| ⬇️ Conversation export              | Save what's currently visible on screen as Markdown or JSON; save to a custom location, optionally add it to the Knowledge Base too, or set it to auto-save without a dialog                                                     |
| ⚙️ Settings (separate window)       | Language switcher, config storage location, extensions, default export path, backup/restore, selector settings (with test-capture preview), an element picker tool, troubleshooting                                              |
| 🌐 Internationalization             | Traditional Chinese / English / Japanese, easy to extend                                                                                                                                                                         |
| 🧩 Extensions                       | Globally applies "unpacked" Chrome extensions to every account                                                                                                                                                                   |
| 🛡️ Data safety                      | Atomic writes with automatic backup before overwrite, strict import validation                                                                                                                                                   |

## Installation

Requirements: [Node.js](https://nodejs.org/) (LTS recommended, 18+) and npm.

```bash
git clone <this repo's URL>
cd ai-workspace-aggregator
npm install
npm start
```

## Usage

1. Open the app, click "+ Add Account" in the sidebar, pick a platform
   (Claude/ChatGPT/Gemini/Grok), give it a custom name, and log in
   normally in the window that opens.
2. Click any account in the sidebar list to switch to it; repeat step 1
   to add more.
3. To export a conversation: switch to that account, click "Export
   Conversation," and choose Markdown or JSON. The first time you use
   this, it's worth calibrating the element picker under "Settings →
   Selector Settings" first (see below) — otherwise it may not find any
   content.
4. Save prompts you use often into the "Knowledge Base" so you can copy
   them instead of retyping.
5. "Settings" lets you change the language, move where config files are
   stored, install extensions, and back up/restore your whole setup.

## Design Principles

These three principles govern every technical decision in this project;
any new feature has to clear this bar first:

1. **Never call any platform's undocumented / internal API**, and never
   automate anything that evades anti-abuse detection. Conversation
   export works by reading "the DOM content already rendered on the
   current screen" — the same effect as a user manually selecting and
   copying text.
2. **Never circumvent a website's protection mechanisms** — no
   auto-downloading/unpacking Chrome Web Store extensions, no stripping
   a third-party site's security headers.
3. **Never bundle login credentials into any portable file** — backup
   and export files never contain cookies or localStorage; those always
   stay wherever Electron manages them, tied to the OS-level user
   account.

## Architecture

<details>
<summary>Click for technical details (session isolation, multi-window design, i18n, the element picker...)</summary>

### Session isolation and account management

- Each account gets its own `session.fromPartition('persist:<accountId>')`,
  so cookies / localStorage / IndexedDB never leak between accounts. The
  `persist:` prefix writes the partition's data to disk, so restarting the
  app and reusing the same id reconnects to the same login session.
- Account content isn't rendered via `<iframe>` or `<webview>` — it uses
  `WebContentsView` (the Electron 30+ API) layered on top of the main
  window, positioned with `setBounds()` and toggled with `setVisible()`,
  which is why switching accounts is instant.
- **Lazy loading**: on startup, only account metadata is registered; the
  `WebContentsView` itself is created the first time `switchAccount()`
  targets that account. The more accounts you keep, the more this matters
  for startup resource usage. A loading indicator is shown the first time
  a lazily-loaded account's page is still loading.

### Separate-window architecture

"Add Account," "Knowledge Base," and "Settings" are each an independent
`BrowserWindow` (`parent: mainWindow`, **not** modal) rather than an HTML
dialog stacked inside the main window — `WebContentsView` is a native
layer that ignores CSS z-index, so an in-page dialog can get covered or
lose keyboard focus to it; a modal window, on the other hand, would lock
the main window, which conflicts with features (like the element picker)
that need you to interact with the main window while the child window is
open. All three windows share the same `preload.js`, and `main.js`'s
`openChildWindow()` is the shared helper that opens them.

### Internationalization

JSON locale files under `renderer/locales/` plus the shared
`renderer/i18n.js` helper apply translations automatically via a family
of `data-i18n` HTML attributes; dynamic strings use
`window.i18n.t(key, vars)`. The language preference is persisted, and
switching it broadcasts to every window to keep them in sync.

### The element picker tool

"Settings → Selector Settings" lets you click directly on messages on
screen to generate a candidate CSS selector, instead of digging through
DevTools by hand — click "Pick example: user message" and "Pick example:
AI reply" once each, and the app diffs the two to work out the message
container selector and a keyword for identifying user messages. It's a
best-effort guess; review the result after applying it and tweak by hand
if needed.

### Data safety

Config file writes all go through a shared `writeJsonFile()` helper: it
writes to a `.tmp` file first, then `rename`s it over the real file
(atomic write), and automatically backs up the existing file to `.bak`
before overwriting. Import features (knowledge base, backup) validate the
JSON structure up front and surface a clear error message on mismatch.

</details>

## Development

```bash
npm test          # unit tests (lib/utils.js, node:test, no extra deps)
npm run lint        # ESLint
npm run format      # Prettier auto-formatting
```

`main.js` has now been fully modularized: it's down to roughly 70 lines
holding just the App lifecycle (single-instance lock, `whenReady`,
window-all-closed/activate). Data stores, window management, conversation
capture/export, and IPC handlers all live under `lib/**` (IPC handlers are
further split by domain under `lib/ipc/`). `lib/utils.js` holds pure
functions with no Electron dependency (string processing, filesystem
helpers), kept separate so they can be tested directly with `node --test`.
See `PROJECT_SPEC.md` section 15 ("File Structure") for how the modules
divide responsibilities and the shared-state convention.

[GitHub Actions](./.github/workflows/ci.yml) runs syntax checks, lint,
and unit tests automatically on push/PR — it does not cover actually
launching and interacting with the Electron app (no display in CI), so
that part still needs a manual `npm start` pass.

## Packaging

Packaged with [electron-builder](https://www.electron.build/):

```bash
npm run build:win     # Windows: NSIS installer
npm run build:mac     # macOS: dmg
npm run build:linux   # Linux: AppImage
npm run build:dir     # Unpacked folder only, for quick testing
```

Output goes to `dist/`. App icons live in `assets/icons/` (currently
empty) — see [`assets/icons/README.md`](./assets/icons/README.md) and
[`assets/ICON_PROMPTS.md`](./assets/ICON_PROMPTS.md) for how to prepare
them. Packaging will fail with a "missing icon" error until those files
are in place — that's expected.

## Project Structure

```
ai-workspace-aggregator/
├── main.js                # App lifecycle entry point only; everything else lives under lib/**
├── preload.js              # contextBridge, shared by every window
├── lib/
│   ├── constants.js           # Platform URLs, sidebar widths, default UI state
│   ├── state.js                # Shared mutable state singleton (window refs, appState, console buffer...)
│   ├── dataDir.js               # DATA_DIR read/write/relocate, per-file paths
│   ├── broadcast.js              # broadcastToAllWindows (cross-window sync)
│   ├── console.js                 # Console capture: overrides global console.*
│   ├── logs.js                     # Log console: error + audit logs (sql.js/SQLite)
│   ├── stores.js                    # Data layer: loadX()/saveX() for each data file
│   ├── windows.js                    # Window and per-account WebContentsView management
│   ├── conversationCapture.js         # Conversation capture/export, selector picker tool
│   ├── reminders.js                    # Task due-date reminders: due summary, hourly schedule, native notification
│   ├── utils.js                        # Pure functions with no Electron dependency
│   ├── sqlite.js                        # Thin wrapper around sql.js: open/save/query
│   └── ipc/                              # IPC handler registration, split by domain (9 files + index.js, incl. search.js)
├── test/utils.test.js        # Unit tests
├── package.json              # npm scripts + electron-builder config
├── .eslintrc.json / .prettierrc.json
├── .github/workflows/ci.yml
├── extractors/
│   ├── domCapture.js         # Injected conversation-capture script
│   ├── selectorPicker.js      # Injected element-picker tool
│   ├── default-selectors.json # Factory-default selectors
│   └── default-knowledge-base.json # 25 built-in prompt templates (5 domains × 5 each)
├── renderer/
│   ├── index.html / renderer.js / renderer.css   # Main window
│   ├── account.html / account.js                 # Add Account (separate window)
│   ├── knowledge.html / knowledge.js / knowledge.css  # Knowledge Base (separate window)
│   ├── settings.html / settings.js / settings.css     # Settings (separate window)
│   ├── i18n.js                                   # Internationalization
│   └── locales/zh-TW.json, en.json
└── assets/                    # App icons and generation prompts
```

## Config File Locations

Generated automatically at runtime under `app.getPath('userData')`:

```
config-location.json   # Pointer file: where the real config folder is
app-state.json          # Account list, active account, sidebar state, default export path, language
knowledge-base.json     # Knowledge base entries
selectors.json          # Selectors used for conversation capture
extensions.json         # Installed extensions list
```

Under "Settings → Config Storage Location" you can point everything
above except `config-location.json` to an external folder (e.g. a
cloud-synced folder, shared across machines). This **never** includes
actual login cookies/localStorage.

## Documentation Index

| Document                                                           | What's in it                                                                                                                      |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| [CHANGELOG.md](./CHANGELOG.md)                                     | Version history — what was added each round                                                                                       |
| [ROADMAP.md](./ROADMAP.md)                                         | Not-yet-done directions worth considering                                                                                         |
| [PROJECT_SPEC.md](./PROJECT_SPEC.md)                               | A full spec prompt, best suited for agents with filesystem tools (Claude Code / Cursor) to reproduce the whole project            |
| [BUILD_PLAN.md](./BUILD_PLAN.md)                                   | An 8-phase build prompt sequence, best suited for models without filesystem tools (Gemini / Grok / ChatGPT) building from scratch |
| [NEW_FEATURE_BUILD_PROMPT.md](./NEW_FEATURE_BUILD_PROMPT.md)       | Prompt template for adding a new feature once all existing phases are done                                                        |
| [FIX_EXISTING_FEATURE_PROMPT.md](./FIX_EXISTING_FEATURE_PROMPT.md) | Prompt template for fixing a problem in an existing feature                                                                       |
| [SPEC_ONLY_BUILD_PROMPT.md](./SPEC_ONLY_BUILD_PROMPT.md)           | Prompt template for starting a new chat with only the docs attached, no source code                                               |
| [PARTIAL_FILES_BUILD_PROMPT.md](./PARTIAL_FILES_BUILD_PROMPT.md)   | Prompt template for starting a new chat with the spec plus only a specific subset of files, not the whole codebase                |

## Contributing

Forks and PRs are welcome. Before submitting a PR, please make sure:

1. `npm test` passes completely
2. `npm run lint` doesn't introduce new errors
3. For any change touching behavior, you've actually run through it with
   `npm start` (CI doesn't cover Electron interaction tests)
4. New features that violate any of the three [Design Principles](#design-principles)
   above (calling undocumented APIs, circumventing site protections,
   bundling login credentials into backups) won't be accepted

## License

[MIT](<a href="./LICENSE.txt">LICENSE</a>)
