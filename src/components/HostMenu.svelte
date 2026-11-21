<script>
  import { client } from "../client/index.js";

  let { open = false, graph, activeTemplate, actions, close, connected } = $props();

  let tab = $state("note");
  let hub = $state(null);
  let hubError = $state("");
  let busy = $state(false);
  let newName = $state("new-note");
  let newTemplate = $state("");
  let settingsLocation = $state("");
  let settingsBusy = $state(false);
  let pickingFolder = $state(false);
  let settingsNotice = $state("");
  let syncStatus = $state(null);
  let syncBusy = $state(false);
  let syncError = $state("");
  let syncNotice = $state("");
  let fileInput = $state(null);

  let nameError = $derived.by(() => {
    const value = newName.trim();
    if (!value) return "Enter a file name.";
    if (/[\\/]/.test(value)) return "Use a file name, not a path.";
    if (value === "." || value === "..") return "Enter a valid file name.";
    return "";
  });

  let newNoteTarget = $derived.by(() => {
    if (nameError) return "";
    const base = hub?.settings?.defaultLocation;
    const fileName = /\.md$/i.test(newName.trim()) ? newName.trim() : `${newName.trim()}.md`;
    return base ? `${base.replace(/[\\/]+$/, "")}/${fileName}` : "";
  });

  let canCreateNote = $derived.by(
    () =>
      !nameError &&
      Boolean(hub?.settings?.defaultLocation) &&
      Boolean(newTemplate)
  );

  $effect(() => {
    if (open) loadHub();
    if (open && !graph && tab === "note") tab = "recent";
  });

  $effect(() => {
    if (!open || tab !== "settings") return;
    loadSyncStatus();
    const timer = setInterval(loadSyncStatus, 4000);
    return () => clearInterval(timer);
  });

  async function loadHub() {
    try {
      const data = await client.hubState();
      hub = data;
      settingsLocation = data.settings?.defaultLocation ?? "";
      const templates = data.templates ?? [];
      if (!templates.some((template) => template.id === newTemplate)) {
        newTemplate = templates[0]?.id ?? "";
      }
      hubError = "";
    } catch (cause) {
      hubError = cause.message;
    }
  }

  async function saveSettings(event) {
    event.preventDefault();
    if (settingsBusy) return;
    settingsBusy = true;
    settingsNotice = "";
    hubError = "";
    try {
      const data = await client.updateSettings();
      hub = hub ? { ...hub, settings: data } : hub;
      settingsLocation = data.defaultLocation ?? "";
      settingsNotice = data.defaultLocation
        ? "Default folder saved."
        : "Choose a folder to use for new notes.";
    } catch (cause) {
      hubError = cause.message;
    } finally {
      settingsBusy = false;
    }
  }

  async function chooseFolder() {
    if (pickingFolder) return;
    pickingFolder = true;
    hubError = "";
    try {
      const data = await client.pickFolder();
      if (data?.name) {
        settingsLocation = data.name;
        settingsNotice = "Folder selected and saved.";
        await loadHub();
      }
    } catch (cause) {
      if (cause?.name !== "AbortError") hubError = cause.message;
    } finally {
      pickingFolder = false;
    }
  }

  async function loadSyncStatus() {
    try {
      syncStatus = await client.syncStatus();
    } catch (cause) {
      syncError = cause.message;
    }
  }

  async function connectSync() {
    if (syncBusy) return;
    syncBusy = true;
    syncError = "";
    syncNotice = "";
    const popup = window.open("", "_blank");

    try {
      const data = await client.syncConnect();
      if (popup) {
        popup.location.href = data.url;
      } else {
        window.location.href = data.url;
        return;
      }
      syncNotice = "Finish signing in to Dropbox in the new tab.";
    } catch (cause) {
      popup?.close();
      syncError = cause.message;
    } finally {
      syncBusy = false;
      setTimeout(loadSyncStatus, 1500);
    }
  }

  async function runSyncNow() {
    if (syncBusy) return;
    syncBusy = true;
    syncError = "";
    syncNotice = "";
    try {
      const data = await client.syncNow();
      syncStatus = data;
      syncNotice = data.lastMessage || "Sync finished.";
    } catch (cause) {
      syncError = cause.message;
    } finally {
      syncBusy = false;
    }
  }

  async function disconnectSync() {
    if (!confirm("Disconnect Dropbox? Local notes stay on this machine.")) return;
    syncBusy = true;
    syncError = "";
    syncNotice = "";
    try {
      syncStatus = await client.syncDisconnect();
      syncNotice = "Dropbox disconnected.";
    } catch (cause) {
      syncError = cause.message;
    } finally {
      syncBusy = false;
    }
  }

  async function openPicker() {
    if (busy) return;
    busy = true;
    hubError = "";
    try {
      await client.openNote();
      await loadHub();
      close();
    } catch (cause) {
      if (cause?.name !== "AbortError") hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  async function openFile(id) {
    if (busy) return;
    busy = true;
    hubError = "";
    try {
      await client.openRecent(id);
      await loadHub();
      close();
    } catch (cause) {
      hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  async function createNote(event) {
    event.preventDefault();
    if (!canCreateNote || busy) return;
    busy = true;
    hubError = "";
    try {
      await client.createNote({
        name: newName.trim(),
        template: newTemplate,
      });
      await loadHub();
      close();
    } catch (cause) {
      hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  async function removeTemplate(template) {
    if (!confirm(`Remove template "${template.name}"?`)) return;
    busy = true;
    hubError = "";
    try {
      await client.removeTemplate(template.id);
      await actions.reloadTemplates?.();
      await loadHub();
    } catch (cause) {
      hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  async function exportTemplate(template) {
    hubError = "";
    try {
      await client.exportTemplate(template.id);
    } catch (cause) {
      hubError = cause.message;
    }
  }

  async function importTemplate(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    const agreed = confirm(
      "Templates run as code in this page and can reach anything it stores. Only import templates you trust. Continue?"
    );
    if (!agreed) return;

    busy = true;
    hubError = "";
    try {
      const source = await file.text();
      await client.installTemplate(source, file.name);
      await actions.reloadTemplates?.();
      await loadHub();
    } catch (cause) {
      hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  async function restoreTemplates() {
    if (busy) return;
    busy = true;
    hubError = "";
    try {
      await client.restoreTemplates();
      await actions.reloadTemplates?.();
      await loadHub();
    } catch (cause) {
      hubError = cause.message;
    } finally {
      busy = false;
    }
  }

  function relativeTime(value) {
    const date = new Date(value);
    const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
    return `${Math.round(seconds / 86400)}d ago`;
  }
</script>

{#if open}
  <div class="host-menu">
    <button class="host-backdrop" aria-label="Close markdownapps menu" onclick={close}></button>
    <div class="host-panel" role="dialog" aria-modal="true" aria-label="markdownapps menu">
      <header class="panel-head">
        <div class="panel-title">
          <p class="eyebrow">markdownapps hub</p>
          <h2>{graph?.title ?? "No note open"}</h2>
          <p class="host-file">
            Template app: {activeTemplate?.name ?? "none"}
            <span class:live={connected} class="host-live">
              <i></i>{connected ? "live" : "idle"}
            </span>
          </p>
        </div>
        <button class="panel-close" type="button" onclick={close} aria-label="Close menu">
          ×
        </button>
      </header>

      <nav class:no-note={!graph} class="tabs">
        {#if graph}
          <button class:active={tab === "note"} onclick={() => (tab = "note")}>Note</button>
        {/if}
        <button class:active={tab === "recent"} onclick={() => (tab = "recent")}>Recent</button>
        <button class:active={tab === "templates"} onclick={() => (tab = "templates")}>Templates</button>
        <button class:active={tab === "settings"} onclick={() => (tab = "settings")}>Settings</button>
      </nav>

      {#if hubError}<div class="panel-error">{hubError}</div>{/if}

      {#if tab === "note"}
        <div class="host-actions">
          <button
            class="primary"
            onclick={() => {
              actions.openSource();
              close();
            }}
          >
            Open Markdown
          </button>
          <button class="ghost" onclick={() => (tab = "recent")}>Recent files</button>
        </div>

        <section class="host-section">
          <h3>Template binding</h3>
          <p>
            This note is bound to <code>{activeTemplate?.id ?? "unknown"}</code>.
            Templates own their document shape, so switching apps is not automatic.
          </p>
          <p>To change it, edit <code>template:</code> in the frontmatter.</p>
        </section>
      {:else if tab === "recent"}
        <section class="host-section first">
          <div class="section-title">
            <h3>Recent notes</h3>
            <div class="section-actions">
              <button class="quiet" onclick={openPicker} disabled={busy}>
                Open file…
              </button>
            </div>
          </div>
          {#if !hub}
            <p>Loading…</p>
          {:else if hub.recent.length === 0}
            <p>No recent notes yet.</p>
          {:else}
            <div class="recent-list">
              {#each hub.recent as item (item.id)}
                <button
                  class="recent-row"
                  class:missing={!item.exists}
                  onclick={() => openFile(item.id)}
                  disabled={!item.exists || busy}
                >
                  <span class="file-badge">MD</span>
                  <span class="recent-copy">
                    <strong>{item.title}</strong>
                    <small>{item.path}</small>
                  </span>
                  <span class="recent-time">{item.exists ? relativeTime(item.lastOpened) : "missing"}</span>
                </button>
              {/each}
            </div>
          {/if}
        </section>

        <form class="new-note" onsubmit={createNote}>
          <h3>New note</h3>
          <p class="location-line">
            {#if hub?.settings?.defaultLocation}
              Saves in <code>{hub.settings.defaultLocation}</code>
            {:else}
              <span class="location-missing">No default folder set.</span>
            {/if}
            <button type="button" class="quiet" onclick={() => (tab = "settings")}>
              {hub?.settings?.defaultLocation ? "Change" : "Set folder"}
            </button>
          </p>
          <label class="field">
            <span class="field-label">File name</span>
            <span class="name-input">
              <input bind:value={newName} placeholder="my-note" spellcheck="false" />
              {#if !/\.md$/i.test(newName.trim())}
                <span class="file-ext">.md</span>
              {/if}
            </span>
          </label>
          {#if nameError}
            <p class="field-error">{nameError}</p>
          {:else if newNoteTarget}
            <p class="path-preview"><code>{newNoteTarget}</code></p>
          {/if}
          <label class="field">
            <span class="field-label">Template</span>
            <select bind:value={newTemplate}>
              {#if hub}
                {#if hub.templates.length === 0}
                  <option value="">No templates installed</option>
                {:else}
                  {#each hub.templates as template (template.id)}
                    <option value={template.id}>{template.name}</option>
                  {/each}
                {/if}
              {/if}
            </select>
          </label>
          {#if hub && hub.templates.length === 0}
            <p class="settings-note">
              Install a template or restore the starters before creating a note.
            </p>
          {/if}
          {#if hub && !hub.settings?.defaultLocation}
            <p class="settings-note">
              Set a default folder in Settings before creating a note.
            </p>
          {/if}
          <button class="primary" type="submit" disabled={busy || !canCreateNote}>
            {busy ? "Working…" : "Create note"}
          </button>
        </form>
      {:else if tab === "settings"}
        <section class="host-section first">
          <h3>New note folder</h3>
          <p>
            New notes are created in this folder. Pick it once with the browser's
            folder picker; the handle is stored for this site. The browser may ask
            for permission again after a restart.
          </p>

          <form class="settings-form" onsubmit={saveSettings}>
            <div class="field">
              <label class="field-label" for="default-location">Default folder</label>
              <span class="folder-input">
                <input
                  id="default-location"
                  bind:value={settingsLocation}
                  placeholder="No folder chosen"
                  spellcheck="false"
                  readonly
                />
                <button
                  class="ghost choose-folder"
                  type="button"
                  onclick={chooseFolder}
                  disabled={settingsBusy || pickingFolder}
                >
                  {pickingFolder ? "Opening…" : "Choose…"}
                </button>
              </span>
            </div>
            {#if hub && !settingsLocation.trim()}
              <p class="settings-require">Choose a folder to create notes by name.</p>
            {/if}
            <div class="settings-actions">
              <button
                class="primary"
                type="submit"
                disabled={settingsBusy || pickingFolder || !settingsLocation.trim()}
              >
                {settingsBusy ? "Saving…" : "Save folder"}
              </button>
            </div>
          </form>

          {#if hub}
            <p class="settings-note">
              Current:
              <code>{hub.settings?.defaultLocation || "not set"}</code>
            </p>
          {/if}
          {#if settingsNotice}<p class="settings-saved">{settingsNotice}</p>{/if}
        </section>

        <section class="host-section">
          <h3>Sync</h3>

          {#if !syncStatus}
            <p>Loading sync status…</p>
          {:else if !syncStatus.configured}
            <p>
              Dropbox sync is not configured in this build. The app key is
              registered once by the markdownapps developer, not by each user.
            </p>
            <p class="settings-note">
              Register this redirect URI in the Dropbox app:
              <code>{syncStatus.redirectUri}</code>
            </p>
            <p class="settings-note">
              Developer setup: set <code>VITE_DROPBOX_APP_KEY</code> before building,
              or run <code>localStorage.setItem("markdownapps.dropboxAppKey", "…")</code>.
            </p>
          {:else if !syncStatus.connected}
            <p>
              Connect Dropbox to keep this note in sync. You sign in on
              Dropbox's website; markdownapps never sees your password.
            </p>
            <p class="settings-note">
              Callback: <code>{syncStatus.redirectUri}</code>
            </p>
            <div class="settings-actions">
              <button
                class="primary"
                type="button"
                onclick={connectSync}
                disabled={syncBusy}
              >
                {syncBusy ? "Opening…" : "Connect Dropbox"}
              </button>
            </div>
          {:else}
            <div class="sync-account">
              <span class="sync-dot" class:ok={syncStatus.phase !== "error"}></span>
              <div>
                <strong>
                  {syncStatus.account?.name ||
                    syncStatus.account?.email ||
                    "Dropbox connected"}
                </strong>
                <small>{syncStatus.account?.email || "Dropbox"}</small>
              </div>
            </div>

            <p class="settings-note">
              {#if syncStatus.lastError}
                <span class="sync-problem">{syncStatus.lastError}</span>
              {:else}
                {syncStatus.lastMessage || "Ready to sync."}
              {/if}
            </p>

            <p class="settings-note">
              Remote: <code>{syncStatus.remotePath || syncStatus.remoteRoot}</code>
              {#if syncStatus.entry?.syncedAt}
                · synced {relativeTime(syncStatus.entry.syncedAt)}
              {/if}
            </p>

            {#if syncStatus.conflictPath}
              <p class="settings-note">
                Conflict copy: <code>{syncStatus.conflictPath}</code>
              </p>
            {/if}

            <div class="settings-actions">
              <button
                class="primary"
                type="button"
                onclick={runSyncNow}
                disabled={syncBusy || syncStatus.syncing}
              >
                {syncStatus.syncing ? "Syncing…" : "Sync now"}
              </button>
              <button
                class="ghost"
                type="button"
                onclick={disconnectSync}
                disabled={syncBusy}
              >
                Disconnect
              </button>
            </div>
          {/if}

          {#if syncError}<p class="settings-require">{syncError}</p>{/if}
          {#if syncNotice}<p class="settings-saved">{syncNotice}</p>{/if}
        </section>

        <section class="host-section">
          <h3>Storage</h3>
          <p>
            Settings, recent files, and the folder handle live in this browser's
            IndexedDB. Notes stay on this machine unless you connect a sync
            provider.
          </p>
        </section>
      {:else}
        <section class="host-section first">
          <div class="section-title">
            <h3>Templates</h3>
            <div class="section-actions">
              <button class="quiet" onclick={() => fileInput?.click()} disabled={busy}>
                Import…
              </button>
              <button class="quiet" onclick={restoreTemplates} disabled={busy}>
                Restore starters
              </button>
              <input
                class="file-input"
                bind:this={fileInput}
                type="file"
                accept=".svelte,text/plain"
                onchange={importTemplate}
              />
            </div>
          </div>

          {#if hub}
            {#if hub.templates.length === 0}
              <p class="empty-line">
                No templates installed. Restore the starters to keep working.
              </p>
            {:else}
              {#each hub.templates as template (template.id)}
                <div class="template-row">
                  <div>
                    <strong>
                      {template.name}
                      {#if template.installed}
                        <span class="badge">Installed</span>
                      {:else if template.starter}
                        <span class="badge">Bundled</span>
                      {/if}
                    </strong>
                    <small>
                      {template.id} · v{template.version}
                      {#if template.error} · failed to load{/if}
                    </small>
                  </div>
                  <div class="row-actions">
                    <button class="quiet" onclick={() => exportTemplate(template)} disabled={busy}>
                      Export
                    </button>
                    <button class="quiet danger" onclick={() => removeTemplate(template)} disabled={busy}>
                      Remove
                    </button>
                  </div>
                </div>
              {/each}
            {/if}

            <p class="install-hint">
              Templates are single <code>.svelte</code> files with a manifest comment.
              Export one to inspect or edit it, then import it back. Imported templates
              are compiled in this page and can be removed at any time.
            </p>
          {/if}
        </section>
      {/if}

      <p class="host-hint">Recent notes, templates, and settings live here.</p>
    </div>
  </div>
{/if}

<style>
  .host-menu {
    position: fixed;
    inset: 0;
    z-index: 100;
  }

  .host-backdrop {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
    background: rgba(10, 14, 12, 0.36);
    backdrop-filter: blur(4px);
  }

  .host-panel {
    position: absolute;
    top: 22px;
    left: 22px;
    bottom: 22px;
    width: min(400px, calc(100vw - 44px));
    overflow: auto;
    padding: 26px;
    border: 1px solid #d8d4c8;
    border-radius: 18px;
    background: #f4f1e9;
    box-shadow: 0 30px 90px rgba(10, 14, 12, 0.26);
  }

  .panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .panel-title {
    min-width: 0;
  }

  .panel-close {
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    padding: 0;
    place-items: center;
    border: 1px solid #ddd8cc;
    border-radius: 999px;
    color: #617068;
    background: #fffdf7;
    font-size: 1.1rem;
    line-height: 1;
  }

  .panel-close:hover {
    background: #ece7db;
  }

  h2 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 2rem;
    font-weight: 500;
    letter-spacing: -0.03em;
  }

  .host-file {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 8px 0 0;
    color: #6e766f;
    font-size: 0.76rem;
  }

  .host-live {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 0.65rem;
  }

  .host-live i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: #b3b2a8;
  }

  .host-live.live i {
    background: #2fa36b;
  }

  .tabs {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    margin-top: 22px;
    padding: 3px;
    border: 1px solid #ddd8cc;
    border-radius: 8px;
    background: #ece8dc;
  }

  .tabs button {
    padding: 6px 4px;
    border: 0;
    border-radius: 5px;
    color: #7d847b;
    background: transparent;
    font-size: 0.66rem;
    font-weight: 650;
  }

  .tabs.no-note {
    grid-template-columns: repeat(3, 1fr);
  }

  .tabs button.active {
    color: #176b4d;
    background: #fffdf7;
    box-shadow: 0 1px 4px rgba(20, 28, 23, 0.08);
  }

  .panel-error {
    margin-top: 14px;
    padding: 8px 10px;
    border-radius: 7px;
    color: #7d2c19;
    background: #f7e4dc;
    font-size: 0.7rem;
  }

  .host-actions {
    display: flex;
    gap: 8px;
    margin-top: 18px;
  }

  .host-section {
    margin-top: 24px;
    padding-top: 18px;
    border-top: 1px solid #ddd8cc;
  }

  .host-section.first {
    margin-top: 18px;
    padding-top: 0;
    border-top: 0;
  }

  .host-section h3,
  .new-note h3 {
    margin: 0;
    font-size: 0.84rem;
  }

  .host-section > p {
    margin: 7px 0 0;
    color: #6e766f;
    font-size: 0.74rem;
    line-height: 1.5;
  }

  .host-hint {
    margin: 24px 0 0;
    color: #8a8f86;
    font-size: 0.68rem;
  }

  code {
    padding: 2px 5px;
    border-radius: 4px;
    background: #eae5d8;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.7rem;
  }

  .recent-list {
    margin-top: 10px;
    overflow: hidden;
    border: 1px solid #ddd8cc;
    border-radius: 8px;
    background: #fffdf7;
  }

  .recent-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 9px;
    border: 0;
    border-bottom: 1px solid #e8e3d7;
    background: transparent;
    text-align: left;
  }

  .recent-row:last-child {
    border-bottom: 0;
  }

  .recent-row:hover:not(:disabled) {
    background: #f7f3e8;
  }

  .recent-row:disabled {
    opacity: 0.55;
  }

  .file-badge {
    display: grid;
    width: 27px;
    height: 27px;
    flex: 0 0 auto;
    place-items: center;
    border-radius: 6px;
    color: #176b4d;
    background: #e2efe5;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.5rem;
    font-weight: 700;
  }

  .recent-copy {
    display: flex;
    flex: 1;
    flex-direction: column;
    min-width: 0;
    gap: 2px;
  }

  .recent-copy strong {
    overflow: hidden;
    font-size: 0.74rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-copy small {
    overflow: hidden;
    color: #8a8f86;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.55rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recent-time {
    color: #9a9f96;
    font-size: 0.57rem;
    white-space: nowrap;
  }

  .new-note {
    margin-top: 22px;
    padding-top: 16px;
    border-top: 1px solid #ddd8cc;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 9px;
  }

  .field-label {
    color: #7d847b;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field input,
  .field select {
    border-color: #ddd8cc;
    background: #fffdf7;
    font-size: 0.72rem;
  }

  .new-note .primary {
    margin-top: 12px;
  }

  .location-line {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 5px;
    margin: 8px 0 0;
    color: #6e766f;
    font-size: 0.68rem;
    line-height: 1.45;
  }

  .location-line code {
    word-break: break-all;
  }

  .location-missing {
    color: #a6472d;
    font-weight: 600;
  }

  .folder-input,
  .name-input {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .folder-input input {
    flex: 1;
    min-width: 0;
  }

  .choose-folder {
    flex: none;
    padding: 9px 10px;
    font-size: 0.64rem;
  }

  .name-input input {
    flex: 1;
    min-width: 0;
  }

  .file-ext {
    flex: none;
    color: #8a8f86;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.68rem;
  }

  .field-error {
    margin: 6px 0 0;
    color: #a6472d;
    font-size: 0.64rem;
  }

  .path-preview {
    overflow: hidden;
    margin: 7px 0 0;
    color: #8a8f86;
    font-size: 0.6rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-preview code {
    font-size: 0.58rem;
  }

  .settings-form {
    margin-top: 14px;
  }

  .settings-require {
    margin: 6px 0 0;
    color: #a6472d;
    font-size: 0.64rem;
  }

  .settings-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 12px;
  }

  .settings-note {
    margin: 14px 0 0;
    color: #6e766f;
    font-size: 0.68rem;
    line-height: 1.5;
  }

  .settings-note code {
    word-break: break-all;
  }

  .settings-saved {
    margin: 9px 0 0;
    color: #176b4d;
    font-size: 0.68rem;
  }

  .sync-account {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-top: 12px;
  }

  .sync-account div {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .sync-account strong {
    font-size: 0.74rem;
  }

  .sync-account small {
    color: #8a8f86;
    font-size: 0.6rem;
  }

  .sync-dot {
    width: 7px;
    height: 7px;
    flex: none;
    border-radius: 999px;
    background: #b3b2a8;
  }

  .sync-dot.ok {
    background: #2fa36b;
  }

  .sync-problem {
    color: #a6472d;
  }

  .section-title {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .section-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 2px;
    justify-content: flex-end;
  }

  .badge {
    display: inline-block;
    margin-left: 4px;
    padding: 1px 5px;
    border-radius: 999px;
    color: #176b4d;
    background: #e1efe6;
    font-size: 0.52rem;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    vertical-align: middle;
  }

  .template-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 0;
    border-bottom: 1px solid #e8e3d7;
  }

  .template-row > div:first-child {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .template-row strong {
    font-size: 0.74rem;
  }

  .template-row small {
    color: #8a8f86;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.58rem;
  }

  .row-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .quiet {
    padding: 4px 5px;
    border: 0;
    border-radius: 4px;
    color: #617068;
    background: transparent;
    font-size: 0.6rem;
    text-decoration: none;
  }

  .quiet:hover {
    background: #ece7db;
  }

  .danger {
    color: #a6472d;
  }

  .empty-line,
  .install-hint {
    color: #8a8f86;
    font-size: 0.66rem;
    line-height: 1.45;
  }

  .install-hint {
    margin: 14px 0 0;
  }

  .file-input {
    display: none;
  }

  .primary {
    padding: 8px 12px;
    border: 1px solid #176b4d;
    border-radius: 6px;
    color: #ffffff;
    background: #176b4d;
    font-size: 0.7rem;
    font-weight: 700;
  }

  .ghost {
    padding: 8px 12px;
    border: 1px solid #ddd8cc;
    border-radius: 6px;
    color: #38413b;
    background: #fffdf7;
    font-size: 0.7rem;
    font-weight: 600;
  }

  @media (max-width: 640px) {
    .host-panel {
      inset: 0;
      width: 100%;
      height: 100dvh;
      padding: max(18px, env(safe-area-inset-top)) 18px
        max(18px, env(safe-area-inset-bottom));
      border: 0;
      border-radius: 0;
      overscroll-behavior: contain;
    }

    .host-backdrop {
      display: none;
    }

    .tabs {
      margin-top: 18px;
    }

    .tabs button {
      padding: 10px 4px;
      font-size: 0.7rem;
    }

    .recent-row {
      padding: 12px 9px;
    }

    .primary,
    .ghost {
      min-height: 42px;
    }

    .panel-close {
      width: 42px;
      height: 42px;
    }

    .quiet {
      min-height: 36px;
      padding: 8px 7px;
    }

    .section-title {
      flex-wrap: wrap;
    }

    .section-actions {
      justify-content: flex-start;
    }

    .template-row {
      flex-wrap: wrap;
    }

    .row-actions {
      margin-left: auto;
    }

    .settings-actions {
      flex-direction: column;
      align-items: stretch;
    }

    .host-hint {
      padding-bottom: 8px;
    }
  }
</style>
