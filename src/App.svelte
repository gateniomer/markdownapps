<script>
  import { onMount } from "svelte";
  import { client } from "./client/index.js";
  import HostMenu from "./components/HostMenu.svelte";
  import MenuButton from "./components/MenuButton.svelte";
  import TemplateHost from "./components/TemplateHost.svelte";
  import MissingTemplate from "./components/MissingTemplate.svelte";

  let graph = $state(null);
  let noFile = $state(false);
  let installedTemplates = $state([]);
  let loading = $state(true);
  let saving = $state(false);
  let connected = $state(false);
  let hostOpen = $state(false);
  let error = $state("");
  let notice = $state("");
  let sourceMode = $state(false);
  let draft = $state("");
  let draftDirty = $state(false);
  let lastClientError = "";
  let hubOpened = $state(false);

  let activeTemplate = $derived(
    installedTemplates.find((item) => item.id === graph?.template) ?? null
  );
  let displayTemplate = $derived(
    activeTemplate ?? {
      id: graph?.template || "unknown",
      name: graph?.template || "Unknown template",
      description: "Not installed",
    }
  );

  onMount(() => {
    const unsubscribe = client.subscribe((state) => {
      if (state.graph !== graph) {
        graph = state.graph;
        if (sourceMode && !draftDirty && state.graph) draft = state.graph.raw;
      }
      installedTemplates = state.templates || [];
      connected = state.connected;
      loading = state.loading;
      noFile = state.noFile;
      if (state.graph) hubOpened = false;
      if (state.noFile && !hubOpened) {
        hubOpened = true;
        hostOpen = true;
      }
      if (state.error && state.error !== lastClientError) {
        lastClientError = state.error;
        error = state.error;
      }
    });

    client.init().catch((cause) => {
      loading = false;
      error = cause.message;
    });

    const onFocus = () => {
      client.focusSync().catch(() => {});
    };
    window.addEventListener("focus", onFocus);

    return () => {
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  });

  function flash(message) {
    notice = message;
    setTimeout(() => {
      if (notice === message) notice = "";
    }, 2200);
  }

  async function write(content) {
    if (saving || !graph) return false;
    saving = true;
    error = "";
    try {
      await client.write(content, graph.hash);
      flash("Saved to Markdown");
      return true;
    } catch (cause) {
      error = cause.message;
      return false;
    } finally {
      saving = false;
    }
  }

  function openSource() {
    sourceMode = true;
    draft = graph.raw;
    draftDirty = false;
  }

  async function saveSource() {
    const ok = await write(draft);
    if (ok) {
      sourceMode = false;
      draftDirty = false;
    }
  }

  function handleKeydown(event) {
    if (event.key === "Escape") hostOpen = false;
  }

  const actions = { write, openSource, reloadTemplates: client.reloadTemplates };
</script>

<svelte:window onkeydown={handleKeydown} />

{#if loading}
  <div class="boot-screen">Loading…</div>
{:else if noFile}
  <div class="no-file-screen">
    <span class="boot-mark">m</span>
    <h1>No note open</h1>
    <p>Open the menu to open a recent file or create a new note.</p>
  </div>
  <MenuButton onOpen={() => (hostOpen = true)} />
  <HostMenu
    open={hostOpen}
    {graph}
    activeTemplate={displayTemplate}
    {actions}
    {connected}
    close={() => (hostOpen = false)}
  />
{:else if !graph}
  <div class="boot-screen">Could not load the document.</div>
{:else if sourceMode}
  <div class="editor-shell">
    <div class="source-head">
      <div>
        <p class="eyebrow">source</p>
        <h2>{graph.title}</h2>
      </div>
      <div class="source-actions">
        <button class="ghost" onclick={() => (sourceMode = false)}>Cancel</button>
        <button class="primary" onclick={saveSource} disabled={saving}>
          {saving ? "Saving…" : "Save Markdown"}
        </button>
      </div>
    </div>
    <textarea
      class="source-editor"
      bind:value={draft}
      oninput={() => (draftDirty = true)}
      spellcheck="false"
    ></textarea>
    <p class="hint">
      This is the whole file. If another program changes it while you edit, saving
      is blocked until you reload.
    </p>
  </div>
{:else}
  {#if activeTemplate}
    <TemplateHost template={activeTemplate} {graph} {actions} />
  {:else}
    <MissingTemplate {graph} templateId={graph.template} openSource={openSource} />
  {/if}

  <MenuButton onOpen={() => (hostOpen = true)} />
  <HostMenu
    open={hostOpen}
    {graph}
    activeTemplate={displayTemplate}
    {actions}
    {connected}
    close={() => (hostOpen = false)}
  />
{/if}

{#if notice}<div class="toast notice">{notice}</div>{/if}
{#if error}
  <div class="toast error">{error} <button onclick={() => (error = "")}>dismiss</button></div>
{/if}
