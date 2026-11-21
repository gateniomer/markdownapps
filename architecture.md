# Architecture

markdownapps is a local-first Markdown app that runs entirely in the browser. The
file is the source of truth, and different notes can use different templates
without turning into different apps.

The core rule is unchanged:

> **Core owns data integrity. Templates own the canvas.**

The difference from the previous architecture is where "core" lives: instead of a
Node process on the machine, it is a small client module running next to the
templates in the page.

## Layers

```text
┌─────────────────────────────────────────────┐
│ Vite                                        │
│ dev server, build, static hosting           │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ App host (src/App.svelte)                   │
│ loading, source editor, error/notice UI     │
└──────────────────────┬──────────────────────┘
                       │ subscribe / actions
┌──────────────────────▼──────────────────────┐
│ Client core (src/client/)                   │
│ file handles, reads/writes, hashes, recents,│
│ settings, templates, sync, polling          │
└──────────────────────┬──────────────────────┘
                       │
┌──────────────────────▼──────────────────────┐
│ Browser APIs                                │
│ File System Access · IndexedDB · Web Crypto │
│ fetch (Dropbox)                             │
└──────────────────────┬──────────────────────┘
                       │ raw Markdown + actions
┌──────────────────────▼──────────────────────┐
│ Template app (src/templates/)               │
│ schema parsing, layout, state, user flow    │
└─────────────────────────────────────────────┘
```

## Client core

`src/client/index.js` is the only module the UI talks to. It exposes a small
promise-based API plus a `subscribe` callback:

```js
client.init()
client.subscribe(callback)          // { graph, templates, loading, connected, ... }
client.openNote()                   // opens the file picker
client.openRecent(id)
client.createNote({ name, template })
client.write(markdown, baseHash)
client.hubState()                   // recents, settings, templates
client.pickFolder()
client.updateSettings()
client.exportTemplate(id)
client.removeTemplate(id)
client.restoreTemplates()
client.syncStatus()
client.syncConnect()
client.syncNow()
client.syncDisconnect()
```

Nothing above knows about Svelte. `App.svelte` mirrors the subscription into
runes; `HostMenu.svelte` calls the same methods.

### Document model

The client guarantees:

- YAML frontmatter, including `template`
- the raw Markdown source
- a content hash

Everything else is owned by the template. The starter topic apps share one
schema, defined in `src/schemas/topics.js` rather than in the client:

````md
---
title: My Learning Map
template: map
---

## Topic name

```yaml
level: 2
confidence: medium
prereqs: Topic A
related: Topic B
tags: javascript, frontend
```

Markdown body.

> **Comment** · you · 2026-11-21
> A note for the agent.
````

A future journal or flashcard app can use a different shape without changing the
host.

### Writes

Every template edit ends in:

```js
await actions.write(nextMarkdown);   // -> client.write(next, graph.hash)
```

`client.write`:

1. reads the current file through its handle
2. compares the SHA-256 hash with `graph.hash`
3. refuses with a conflict error if another program changed the file
4. writes through `createWritable()` (commit on close)
5. updates the in-memory graph and notifies subscribers
6. schedules a sync push if Dropbox is connected

There is no server-side atomic rename; `createWritable()` is the browser's
closest equivalent and commits the whole file on close.

### Live updates

The browser has no `fs.watch`. When a note is open, the client polls the file
handle every 2 seconds while the tab is visible, compares hashes, and emits a
new graph if it changed. This preserves the "an agent edited the file and the UI
refreshed" loop, with two caveats:

- the tab must be open and visible
- the browser must still hold permission for the file handle

After a restart, the handle is in IndexedDB but permission is usually `prompt`,
so reopening the note needs a click (the hub's **Open file…** or **Recent**
entry).

## Per-file templates

A note chooses its template in frontmatter:

```yaml
template: kanban
```

If the template is not in the build, the app shows a named fallback: the
requested template name, a raw Markdown preview, and access to the host menu. It
never silently substitutes another app.

## Template apps

A template is a full-screen Svelte component with a manifest comment:

```svelte
<!--
id: flashcards
name: Flashcards
version: 1
permissions: [document:read, document:write]
-->

<script>
  let { graph, actions } = $props();
</script>
```

- Bundled starters are discovered from `src/templates/*.markdownapps.svelte` with
  `import.meta.glob`; there is no registry to update.
- `src/client/templates.js` owns the list, install/export, and the
  removed-template set.
- Imported templates are compiled in the page by `src/client/compiler.js`
  (`svelte/compiler`, a lazy chunk). The generated module is rewritten into a
  plain function: its static imports are bound to `src/client/compiler-runtime.js`
  and its default export becomes the component.
- Because the page has no bundler, a template may only import the modules in
  `compiler-runtime.js`; dynamic `import()`, `import.meta`, and asset imports are
  rejected.

### What the template owns

- Document schema: parsing and validation
- Page layout inside the canvas
- Styling, grouping, sorting, filtering
- Local UI state
- User flow and navigation
- Which host actions to call

### What the client owns

- Frontmatter and template resolution
- Reading and writing the Markdown file
- Hashing and optimistic conflict detection
- Polling for external changes
- Missing-template fallback
- Recent files, default folder, template discovery and install
- Sync scheduling and conflict policy

Templates call `actions.write` and `actions.openSource`; they never touch a file
handle directly.

## Persistence

| Data | Where |
|---|---|
| Note content | The `.md` file the user picked |
| Default folder | `FileSystemDirectoryHandle` in IndexedDB (`settings.folder`) |
| Recent files | Array of file handles + titles in IndexedDB (`recent`) |
| Removed templates | ID list in IndexedDB (`templates.disabled`) |
| Imported templates | Source text in IndexedDB (`templates.custom`) |
| Sync tokens, account, per-file revisions | IndexedDB (`sync.*`) |

IndexedDB stores handles with structured clone. If IndexedDB is unavailable
(private mode, blocked storage), `src/client/db.js` falls back to an in-memory
map for the session; plain values survive in memory but handles cannot persist
across reloads.

## Sync

Sync is a client concern behind a provider-shaped module. `src/client/sync.js`
implements Dropbox directly with `fetch`:

- PKCE (S256) authorization code flow, no client secret
- redirect URI is the current page (`origin + pathname`)
- token refresh via `refresh_token`
- file operations on `content.dropboxapi.com` and metadata on
  `api.dropboxapi.com`
- per-file state: remote path, revision, local hash, last sync time

Per-file rules, unchanged from the previous engine:

1. local unchanged, remote changed: download and apply; notify subscribers
2. local changed, remote unchanged: upload with the last revision
3. both changed: keep local, download the remote version as a conflict copy,
   then override the remote
4. remote deleted: keep local, drop tracking, upload again on the next pass

The engine never deletes a local note because the remote copy disappeared, and it
never merges Markdown. Conflict copies are deliberate.

Scheduling: a 1.2s debounce after a local save, a 20s poll while the note is
open, and an extra pass when the window regains focus.

## Security boundary

- A note only stores a **template ID**, never executable code.
- The build is static. There is no server to protect and no authentication.
- Dropbox tokens live in IndexedDB rather than a `0600` file. Anyone with access
  to the browser profile can read them; disconnect revokes the token.
- The old loopback-only/sync-header guards are gone because the page talks to
  Dropbox directly. PKCE avoids a client secret, but browser storage is now the
  weakest link.
- Bundled templates are trusted build-time code. **Imported templates are
  untrusted by default and are not sandboxed:** they run in the page's origin,
  can read IndexedDB (including sync tokens), and can call `fetch`. The hub warns
  before installing and offers removal; there is no permission enforcement yet,
  so the manifest `permissions` list is declarative.

## Hosting

The build is static and base-path agnostic, so the same artifact works at `/` or
under `/<repo>/` on GitHub Pages:

- `BASE_PATH` sets Vite's `base`. The deploy workflow derives it from the
  repository name and allows a `BASE_PATH` repository variable to override it.
- `index.html` uses `%BASE_URL%` for the manifest and icons.
- The manifest uses relative `start_url`, `scope`, `id`, and icon paths, so it
  resolves against wherever it is served.
- `sw.js` resolves its shell entries against its own URL, giving the worker the
  correct scope and cache keys under either base.

GitHub Pages serves over HTTPS, which the File System Access API, service
workers, and PWA install all require. Sync's redirect URI is `origin +
pathname`, so on a project site it is `https://<user>.github.io/<repo>/`; that
exact URL must be registered in the Dropbox app.

## Current scope

- One active Markdown file per tab.
- The hub can switch the active file without reloading.
- One active template per file.
- Six bundled templates, plus templates imported at runtime; remove/restore is a
  local preference and imported templates can be deleted.
- No database; IndexedDB only holds handles and preferences.
- Chromium file access; the rest of the UI is portable.
- Optional Dropbox sync.
- Installable PWA shell.

## Next steps

1. Add a Tauri or Electron shell for native file watching and OS keychain tokens.
2. Enforce manifest permissions for imported templates, or run them in a
   sandboxed worker/iframe.
3. Coordinate multiple tabs on the same file (BroadcastChannel).
4. Add a Google Drive provider behind the same sync contract.
5. Consider the Origin Private File System for a "no picker" mode.
