<!--
id: map
name: Sections
description: A numbered reading deck with level rings and a phone-first reader.
version: 2
order: 1
permissions:
  - document:read
  - document:write
-->

<script>
  import { onMount, tick } from "svelte";
  import { fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import {
    addTopic,
    addTopicComment,
    parseTopicDocument,
    setTopicMeta,
    updateTopic,
  } from "markdownapps/schema/topics";

  const LEVELS = ["New", "Shaky", "Learning", "Solid", "Strong"];
  const TONES = ["#c8bfae", "#d9a06a", "#cc7a4a", "#b4552f", "#a8452b"];
  const CONFIDENCES = ["unknown", "low", "medium", "high"];

  const clamp = (level) => Math.min(4, Math.max(0, Number(level) || 0));
  const tone = (level) => TONES[clamp(level)];
  const pad = (value) => String(Math.max(0, value)).padStart(2, "0");

  let { graph, actions } = $props();

  let wide = $state(
    typeof window !== "undefined" && window.matchMedia("(min-width: 880px)").matches
  );
  let calm = $state(
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );

  let query = $state("");
  let levelFilter = $state(-1);
  let activeId = $state("");
  let mobileOpen = $state(false);
  let mode = $state("read"); // read | edit | new
  let draftTitle = $state("");
  let draftBody = $state("");
  let note = $state("");
  let sending = $state(false);
  let justAdded = $state(false);
  let progress = $state(0);
  let titleEl = $state(null);
  let scrollEl = $state(null);

  let pushed = false;
  let fromDeck = false;
  let pulseTimer = 0;

  let topics = $derived(parseTopicDocument(graph.raw).topics);
  let active = $derived(topics.find((topic) => topic.id === activeId) ?? null);
  let index = $derived(active ? topics.findIndex((topic) => topic.id === active.id) : -1);
  let prev = $derived(index > 0 ? topics[index - 1] : null);
  let next = $derived(index >= 0 && index < topics.length - 1 ? topics[index + 1] : null);

  let counts = $derived.by(() => {
    const total = [0, 0, 0, 0, 0];
    for (const topic of topics) total[clamp(topic.level)] += 1;
    return total;
  });

  let average = $derived(
    topics.length
      ? topics.reduce((sum, topic) => sum + clamp(topic.level), 0) / topics.length
      : 0
  );

  let visible = $derived.by(() => {
    const needle = query.trim().toLowerCase();
    return topics.filter((topic) => {
      if (levelFilter >= 0 && clamp(topic.level) !== levelFilter) return false;
      if (!needle) return true;
      return (
        topic.title.toLowerCase().includes(needle) ||
        topic.body.toLowerCase().includes(needle) ||
        topic.tags.some((tag) => tag.toLowerCase().includes(needle))
      );
    });
  });

  onMount(() => {
    if (topics.length) activeId = topics[0].id;

    const wideQuery = window.matchMedia("(min-width: 880px)");
    const calmQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onWide = (event) => {
      wide = event.matches;
      if (wide) mobileOpen = false;
    };
    const onCalm = (event) => {
      calm = event.matches;
    };

    wideQuery.addEventListener("change", onWide);
    calmQuery.addEventListener("change", onCalm);
    window.addEventListener("popstate", onPop);

    return () => {
      wideQuery.removeEventListener("change", onWide);
      calmQuery.removeEventListener("change", onCalm);
      window.removeEventListener("popstate", onPop);
      clearTimeout(pulseTimer);
      pushed = false;
    };
  });

  function onPop() {
    if (!pushed) return;
    pushed = false;
    mobileOpen = false;
    mode = "read";
  }

  function open(topic) {
    if (!topic) return;
    activeId = topic.id;
    mode = "read";
    progress = 0;
    if (wide) {
      scrollEl?.scrollTo({ top: 0 });
      return;
    }
    mobileOpen = true;
    if (pushed) return;
    pushed = true;
    try {
      history.pushState({ markdownapps: "section" }, "");
    } catch {
      pushed = false;
    }
  }

  function leaveReader() {
    mode = "read";
    if (wide) return;
    if (pushed) {
      // onPop closes the reader once the pushed entry is popped.
      history.back();
      return;
    }
    mobileOpen = false;
  }

  function goBack() {
    if (mode !== "read") {
      cancelForm();
      return;
    }
    leaveReader();
  }

  function cancelForm() {
    mode = "read";
    if (!fromDeck) return;
    fromDeck = false;
    leaveReader();
  }

  async function startNew() {
    fromDeck = !wide && !mobileOpen;
    draftTitle = "";
    draftBody = "";
    mode = "new";
    if (!wide) {
      mobileOpen = true;
      if (!pushed) {
        pushed = true;
        try {
          history.pushState({ markdownapps: "new" }, "");
        } catch {
          pushed = false;
        }
      }
    }
    await tick();
    scrollEl?.scrollTo({ top: 0 });
    titleEl?.focus();
  }

  async function startEdit() {
    if (!active) return;
    draftTitle = active.title;
    draftBody = active.body || "";
    mode = "edit";
    await tick();
    scrollEl?.scrollTo({ top: 0 });
    titleEl?.focus();
  }

  async function save(event) {
    event?.preventDefault();
    if (sending) return;
    const title = draftTitle.trim();
    if (!title) return;

    sending = true;
    try {
      if (mode === "new") {
        const result = addTopic(graph.raw, {
          title,
          body: draftBody,
          level: 0,
          confidence: "unknown",
        });
        if (await actions.write(result.source)) {
          activeId = result.id;
          mode = "read";
          fromDeck = false;
          await tick();
          scrollEl?.scrollTo({ top: 0 });
        }
      } else if (active) {
        const result = updateTopic(graph.raw, active.id, { title, body: draftBody });
        if (await actions.write(result.source)) {
          activeId = result.id;
          mode = "read";
        }
      }
    } finally {
      sending = false;
    }
  }

  async function setLevel(level) {
    if (!active || sending) return;
    const value = clamp(level);
    if (value === clamp(active.level)) return;
    sending = true;
    try {
      await actions.write(setTopicMeta(graph.raw, active.id, "level", String(value)));
    } finally {
      sending = false;
    }
  }

  async function cycleConfidence() {
    if (!active || sending) return;
    const current = CONFIDENCES.indexOf(active.confidence);
    const value = CONFIDENCES[(current + 1) % CONFIDENCES.length];
    sending = true;
    try {
      await actions.write(setTopicMeta(graph.raw, active.id, "confidence", value));
    } finally {
      sending = false;
    }
  }

  async function addNote(event) {
    event.preventDefault();
    if (!active || sending || !note.trim()) return;
    sending = true;
    try {
      const ok = await actions.write(addTopicComment(graph.raw, active.id, note));
      if (!ok) return;
      note = "";
      justAdded = true;
      clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => {
        justAdded = false;
      }, 1600);
    } finally {
      sending = false;
    }
  }

  function resolve(name) {
    const needle = String(name || "").trim().toLowerCase();
    return topics.find((topic) => topic.title.toLowerCase() === needle) ?? null;
  }

  function trackScroll(event) {
    const el = event.currentTarget;
    const span = el.scrollHeight - el.clientHeight;
    progress = span > 8 ? Math.min(1, Math.max(0, el.scrollTop / span)) : 0;
  }

  function metaLine(topic) {
    const bits = [];
    if (topic.body) {
      const words = topic.body.split(/\s+/).filter(Boolean).length;
      bits.push(`${Math.max(1, Math.round(words / 200))} min`);
    }
    if (topic.tags.length) bits.push(topic.tags.slice(0, 2).join(" · "));
    return bits.join(" · ") || "empty";
  }
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape" && mobileOpen && !wide) goBack();
  }}
/>

<div class="map-app">
  <aside class="deck" aria-label="Sections">
    <header class="deck-head">
      <p class="kicker">Notebook</p>
      <div class="deck-title">
        <h1>{graph.title || "Untitled"}</h1>
        <button class="add" onclick={startNew} aria-label="New section">
          <span aria-hidden="true">+</span>
        </button>
      </div>
      <p class="deck-sub">
        {#if topics.length}
          {topics.length}
          {topics.length === 1 ? "section" : "sections"}
          <span class="dot-sep">·</span>
          avg level {average.toFixed(1)}
        {:else}
          A blank notebook
        {/if}
      </p>
      {#if topics.length}
        <div class="meter" aria-hidden="true">
          <i style="--p:{average / 4}"></i>
        </div>
      {/if}
    </header>

    {#if topics.length}
      <div class="tools">
        <div class="search">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5"></circle>
            <path d="m13 13 4 4"></path>
          </svg>
          <input bind:value={query} type="search" placeholder="Find a section" aria-label="Find a section" />
          {#if query}
            <button class="clear" onclick={() => (query = "")} aria-label="Clear search">×</button>
          {/if}
        </div>

        <div class="filters" role="group" aria-label="Filter by level">
          <button class:on={levelFilter === -1} onclick={() => (levelFilter = -1)}>All</button>
          {#each LEVELS as label, level}
            <button
              class:on={levelFilter === level}
              style="--c:{tone(level)}"
              aria-pressed={levelFilter === level}
              onclick={() => (levelFilter = levelFilter === level ? -1 : level)}
            >
              {label}<sup>{counts[level]}</sup>
            </button>
          {/each}
        </div>
      </div>

      <nav class="list">
        {#each visible as topic, i (topic.id)}
          <div class="card-slot" animate:flip={{ duration: calm ? 0 : 260 }}>
            <button
              class="card"
              class:current={active?.id === topic.id && (wide || mobileOpen)}
              style="--i:{i};--c:{tone(topic.level)}"
              onclick={() => open(topic)}
            >
              {@render ring(topic.level)}
              <span class="card-text">
                <span class="card-num">
                  {pad(topics.indexOf(topic) + 1)} · {LEVELS[clamp(topic.level)]}
                </span>
                <span class="card-title">{topic.title}</span>
                <span class="card-meta">{metaLine(topic)}</span>
              </span>
              <span class="card-go" aria-hidden="true">→</span>
            </button>
          </div>
        {:else}
          <p class="none">No sections match “{query}”.</p>
        {/each}
      </nav>
    {:else}
      <div class="deck-empty">
        <p class="deck-empty-mark" aria-hidden="true">01</p>
        <p>This notebook is empty.</p>
        <button class="cta" onclick={startNew}>Write the first section</button>
      </div>
    {/if}
  </aside>

  {#if wide || mobileOpen}
    <section
      class="reader"
      aria-label="Section reader"
      in:fly={{
        x: wide || calm ? 0 : 34,
        opacity: wide || calm ? 1 : 0.4,
        duration: wide || calm ? 0 : 280,
      }}
      out:fly={{
        x: wide || calm ? 0 : 34,
        duration: wide || calm ? 0 : 200,
      }}
    >
      <header class="reader-bar">
        <button class="back" onclick={goBack} aria-label="Back to all sections">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5"></path></svg>
          <span>All sections</span>
        </button>

        <div class="bar-right">
          {#if mode === "read" && active}
            <span class="bar-level" style="--c:{tone(active.level)}">
              {LEVELS[clamp(active.level)]}
            </span>
            <button class="edit" onclick={startEdit}>Edit</button>
          {/if}
        </div>

        <i class="reading" style="--p:{progress}" aria-hidden="true"></i>
      </header>

      <div class="reader-scroll" bind:this={scrollEl} onscroll={trackScroll}>
        {#if mode === "read" && active}
          <article class="sheet">
            <p class="kicker">Section {pad(index + 1)} <span>/ {pad(topics.length)}</span></p>
            <h2 class="sheet-title">{active.title}</h2>

            <div class="ladder" role="group" aria-label="Section level">
              <div class="track" aria-hidden="true">
                <i style="--p:{clamp(active.level) / 4}"></i>
              </div>
              {#each LEVELS as label, level}
                <button
                  class:lit={level <= clamp(active.level)}
                  class:here={level === clamp(active.level)}
                  style="--c:{tone(level)}"
                  aria-pressed={level === clamp(active.level)}
                  aria-label={`Set level to ${label}`}
                  title={label}
                  onclick={() => setLevel(level)}
                >
                  <span></span>
                </button>
              {/each}
            </div>

            <div class="chips">
              <button class="chip conf" onclick={cycleConfidence} title="Cycle confidence">
                {active.confidence}
              </button>
              {#each active.tags as tag}
                <span class="chip">{tag}</span>
              {/each}
            </div>

            {#if active.prereqs.length || active.related.length}
              <div class="links">
                {#each active.prereqs as name}
                  {@const hit = resolve(name)}
                  <button
                    class="link"
                    class:missing={!hit}
                    aria-disabled={!hit}
                    title={hit ? `Go to ${name}` : `${name} is not mapped yet`}
                    onclick={() => hit && open(hit)}
                  >
                    <span>after</span>{name}
                  </button>
                {/each}
                {#each active.related as name}
                  {@const hit = resolve(name)}
                  <button
                    class="link related"
                    class:missing={!hit}
                    aria-disabled={!hit}
                    title={hit ? `Go to ${name}` : `${name} is not mapped yet`}
                    onclick={() => hit && open(hit)}
                  >
                    <span>see</span>{name}
                  </button>
                {/each}
              </div>
            {/if}

            {#if active.body}
              <div class="prose">{@html active.html}</div>
            {:else}
              <p class="blank">Nothing written yet. Open the editor and start this section.</p>
            {/if}

            {#if prev || next}
              <nav class="chapter" aria-label="Adjacent sections">
                {#if prev}
                  <button onclick={() => open(prev)}>
                    <span class="dir" aria-hidden="true">←</span>
                    <span>{prev.title}</span>
                  </button>
                {/if}
                {#if next}
                  <button class="next" onclick={() => open(next)}>
                    <span>{next.title}</span>
                    <span class="dir" aria-hidden="true">→</span>
                  </button>
                {/if}
              </nav>
            {/if}

            <section class="notes">
              <div class="notes-head">
                <h3>Notes</h3>
                <span>appended to the file</span>
              </div>
              <form onsubmit={addNote}>
                <textarea
                  bind:value={note}
                  rows="3"
                  placeholder="A note for yourself or the agent…"
                  aria-label="Add a note"
                ></textarea>
                <div class="notes-foot">
                  <span class:pulse={justAdded}>{justAdded ? "Added" : "Markdown comment"}</span>
                  <button class="cta small" type="submit" disabled={sending || !note.trim()}>
                    {sending ? "Adding…" : "Add note"}
                  </button>
                </div>
              </form>
            </section>
          </article>
        {:else if mode === "edit" || mode === "new"}
          <article class="sheet compose">
            <p class="kicker">{mode === "new" ? "New section" : "Editing"}</p>
            <form onsubmit={save}>
              <label class="field">
                <span>Title</span>
                <input
                  bind:this={titleEl}
                  bind:value={draftTitle}
                  placeholder="Section title"
                  autocomplete="off"
                />
              </label>
              <label class="field">
                <span>Markdown</span>
                <textarea bind:value={draftBody} rows="10" placeholder="Write the section…"></textarea>
              </label>
              <div class="compose-actions">
                <button type="button" class="quiet" onclick={cancelForm}>Cancel</button>
                <button class="cta" type="submit" disabled={sending || !draftTitle.trim()}>
                  {sending ? "Saving…" : mode === "new" ? "Create section" : "Save section"}
                </button>
              </div>
            </form>
          </article>
        {:else}
          <div class="reader-empty">
            <p class="kicker">No section</p>
            <h2 class="sheet-title">Pick something to read</h2>
            <button class="cta" onclick={startNew}>Write a section</button>
          </div>
        {/if}
      </div>
    </section>
  {/if}
</div>

{#snippet ring(level)}
  <span class="ring" style="--p:{clamp(level) / 4}" aria-hidden="true">
    <svg viewBox="0 0 36 36">
      <circle class="ring-track" cx="18" cy="18" r="15.5"></circle>
      <circle class="ring-fill" cx="18" cy="18" r="15.5"></circle>
    </svg>
    <b>{clamp(level)}</b>
  </span>
{/snippet}

<style>
  .map-app {
    --paper: #f6f1e7;
    --card: #fffdf8;
    --ink: #201c17;
    --muted: #7c7265;
    --line: #e3dbcb;
    --accent: #a8452b;
    --accent-soft: #f5e4db;
    min-height: 100dvh;
    color: var(--ink);
    background:
      radial-gradient(circle at 84% -10%, rgba(200, 142, 96, 0.16), transparent 34rem),
      var(--paper);
    font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  /* The template ships as one portable file: never rely on host resets. */
  .map-app,
  .map-app :global(*),
  .map-app :global(*)::before,
  .map-app :global(*)::after {
    box-sizing: border-box;
  }

  .map-app :global(button) {
    cursor: pointer;
  }

  .map-app :global(button:disabled) {
    cursor: not-allowed;
    opacity: 0.5;
  }

  /* ---------- deck ---------- */

  .deck {
    display: flex;
    min-height: 100dvh;
    flex-direction: column;
    padding: max(16px, env(safe-area-inset-top)) 16px 0;
  }

  .kicker {
    margin: 0 0 8px;
    color: var(--accent);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.16em;
    line-height: 1;
    text-transform: uppercase;
  }

  .kicker span {
    color: color-mix(in oklab, var(--muted) 65%, transparent);
  }

  .deck-title {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .deck-title h1 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.9rem, 8vw, 2.5rem);
    font-weight: 500;
    letter-spacing: -0.035em;
    line-height: 1.02;
  }

  .add {
    display: grid;
    width: 44px;
    height: 44px;
    flex: 0 0 auto;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    color: var(--accent);
    font-size: 1.45rem;
    line-height: 1;
    place-items: center;
    transition:
      transform 160ms ease,
      box-shadow 160ms ease,
      border-color 160ms ease;
  }

  .add:hover {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
    box-shadow: 0 8px 20px -14px rgba(32, 28, 23, 0.8);
    transform: translateY(-1px);
  }

  .add:active {
    transform: scale(0.94);
  }

  .deck-sub {
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 0.76rem;
  }

  .dot-sep {
    margin: 0 5px;
  }

  .meter {
    height: 6px;
    margin-top: 12px;
    overflow: hidden;
    border-radius: 999px;
    background: color-mix(in oklab, var(--line) 70%, transparent);
  }

  .meter i {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #d9a06a, var(--accent));
    transform: scaleX(var(--p));
    transform-origin: 0 50%;
    transition: transform 500ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .tools {
    position: sticky;
    top: 0;
    z-index: 3;
    margin: 16px -16px 4px;
    padding: 10px 16px 12px;
    background: rgba(246, 241, 231, 0.9);
    backdrop-filter: blur(12px);
  }

  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--card);
    transition:
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  .search svg {
    width: 16px;
    height: 16px;
    flex: none;
    fill: none;
    stroke: var(--muted);
    stroke-linecap: round;
    stroke-width: 1.6;
  }

  .search input {
    width: auto;
    min-width: 0;
    flex: 1;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--ink);
    font-family: inherit;
    font-size: 0.86rem;
    outline: none;
  }

  .search input::-webkit-search-cancel-button {
    display: none;
  }

  .search:focus-within {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
    box-shadow: 0 0 0 3px rgba(168, 69, 43, 0.1);
  }

  .clear {
    width: 30px;
    height: 30px;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
  }

  .filters {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .filters button {
    min-height: 32px;
    flex: none;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    transition:
      background 150ms ease,
      border-color 150ms ease,
      color 150ms ease;
  }

  .filters button:hover {
    color: var(--ink);
  }

  .filters button.on {
    border-color: color-mix(in oklab, var(--c, var(--accent)) 55%, var(--line));
    background: color-mix(in oklab, var(--c, var(--accent)) 11%, var(--card));
    color: color-mix(in oklab, var(--c, var(--accent)) 85%, var(--ink));
  }

  .filters sup {
    margin-left: 4px;
    font-size: 0.56rem;
    opacity: 0.65;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 0 calc(110px + env(safe-area-inset-bottom));
  }

  .card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 12px 12px 12px 10px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--card);
    text-align: left;
    animation: rise 440ms cubic-bezier(0.2, 0.8, 0.2, 1) backwards;
    animation-delay: min(calc(var(--i) * 45ms), 360ms);
    transition:
      transform 160ms ease,
      border-color 160ms ease,
      box-shadow 160ms ease;
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.99);
    }
  }

  .card:hover {
    border-color: color-mix(in oklab, var(--c) 38%, var(--line));
  }

  .card:active {
    transform: scale(0.985);
  }

  .card.current {
    border-color: color-mix(in oklab, var(--accent) 36%, var(--line));
    box-shadow: 0 10px 24px -18px rgba(32, 28, 23, 0.9);
  }

  .card-text {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .card-num {
    color: var(--muted);
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.58rem;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .card-title {
    overflow: hidden;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.06rem;
    font-weight: 500;
    letter-spacing: -0.015em;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-meta {
    overflow: hidden;
    color: var(--muted);
    font-size: 0.67rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .card-go {
    color: color-mix(in oklab, var(--muted) 55%, transparent);
    font-size: 0.9rem;
    transition:
      transform 180ms ease,
      color 180ms ease;
  }

  .card:hover .card-go {
    color: var(--accent);
    transform: translateX(3px);
  }

  .ring {
    position: relative;
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    color: var(--c);
  }

  .ring svg {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    transform: rotate(-90deg);
  }

  .ring-track {
    fill: none;
    stroke: color-mix(in oklab, var(--c) 22%, transparent);
    stroke-width: 3;
  }

  .ring-fill {
    fill: none;
    stroke: var(--c);
    stroke-dasharray: 97.4;
    stroke-dashoffset: calc(97.4 - 97.4 * var(--p));
    stroke-linecap: round;
    stroke-width: 3;
    transition: stroke-dashoffset 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .ring b {
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.7rem;
    font-weight: 600;
  }

  .none {
    padding: 28px 6px;
    color: var(--muted);
    font-size: 0.84rem;
    text-align: center;
  }

  .deck-empty {
    display: grid;
    justify-items: center;
    gap: 10px;
    padding: 48px 8px;
    color: var(--muted);
    text-align: center;
  }

  .deck-empty-mark {
    margin: 0;
    color: color-mix(in oklab, var(--accent) 30%, transparent);
    font-family: Georgia, "Times New Roman", serif;
    font-size: 3.4rem;
    line-height: 1;
  }

  /* ---------- reader ---------- */

  .reader {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    height: 100dvh;
    flex-direction: column;
    background: var(--card);
  }

  .reader-bar {
    position: relative;
    display: flex;
    min-height: 56px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: env(safe-area-inset-top) 12px 0;
    border-bottom: 1px solid var(--line);
    background: color-mix(in oklab, var(--card) 88%, transparent);
    backdrop-filter: blur(10px);
  }

  .back {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    gap: 4px;
    padding: 0 10px 0 2px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    color: var(--muted);
    font-size: 0.74rem;
    font-weight: 600;
  }

  .back:hover {
    background: rgba(32, 28, 23, 0.04);
    color: var(--ink);
  }

  .back svg {
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.7;
  }

  .bar-right {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }

  .bar-level {
    display: inline-flex;
    align-items: center;
    padding: 5px 10px;
    border: 1px solid color-mix(in oklab, var(--c) 32%, var(--line));
    border-radius: 999px;
    background: color-mix(in oklab, var(--c) 9%, var(--card));
    color: color-mix(in oklab, var(--c) 78%, var(--ink));
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;
  }

  .edit {
    min-height: 36px;
    padding: 0 13px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--ink);
    font-size: 0.72rem;
    font-weight: 650;
  }

  .edit:hover {
    border-color: color-mix(in oklab, var(--accent) 45%, var(--line));
    color: var(--accent);
  }

  .reading {
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 100%;
    height: 2px;
    background: var(--accent);
    transform: scaleX(var(--p));
    transform-origin: 0 50%;
    transition: transform 120ms linear;
  }

  .reader-scroll {
    min-height: 0;
    flex: 1;
    overflow-y: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
  }

  .sheet {
    width: 100%;
    max-width: 760px;
    margin: 0 auto;
    padding: 30px 20px calc(64px + env(safe-area-inset-bottom));
  }

  .sheet-title {
    margin: 10px 0 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(2rem, 8vw, 3rem);
    font-weight: 500;
    letter-spacing: -0.035em;
    line-height: 1.02;
  }

  .ladder {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-top: 24px;
  }

  .ladder .track {
    position: absolute;
    top: 50%;
    right: 18px;
    left: 18px;
    height: 2px;
    border-radius: 999px;
    background: var(--line);
    transform: translateY(-50%);
  }

  .ladder .track i {
    display: block;
    width: calc(100% * var(--p));
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #e3c39c, var(--accent));
    transition: width 420ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .ladder button {
    position: relative;
    z-index: 1;
    display: grid;
    width: 36px;
    height: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    place-items: center;
  }

  .ladder button span {
    width: 13px;
    height: 13px;
    border: 2px solid color-mix(in oklab, var(--ink) 20%, transparent);
    border-radius: 999px;
    background: var(--card);
    transition:
      background 200ms ease,
      border-color 200ms ease,
      transform 200ms ease,
      box-shadow 200ms ease;
  }

  .ladder button.lit span {
    border-color: var(--c);
    background: var(--c);
  }

  .ladder button.here span {
    box-shadow: 0 0 0 5px color-mix(in oklab, var(--c) 18%, transparent);
    transform: scale(1.3);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 18px;
  }

  .chip {
    display: inline-flex;
    min-height: 28px;
    align-items: center;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.66rem;
    letter-spacing: 0.02em;
  }

  .chip.conf {
    border-style: dashed;
    color: var(--accent);
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .chip.conf:hover {
    background: var(--accent-soft);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 10px;
  }

  .link {
    display: inline-flex;
    min-height: 34px;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    border: 1px solid color-mix(in oklab, var(--accent) 22%, var(--line));
    border-radius: 9px;
    background: color-mix(in oklab, var(--accent) 5%, transparent);
    color: color-mix(in oklab, var(--accent) 82%, var(--ink));
    font-size: 0.7rem;
  }

  .link span {
    font-size: 0.55rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    opacity: 0.65;
    text-transform: uppercase;
  }

  .link.related {
    border-color: var(--line);
    background: transparent;
    color: var(--muted);
  }

  .link.missing {
    border-style: dashed;
    background: transparent;
    color: color-mix(in oklab, var(--muted) 80%, transparent);
    cursor: default;
  }

  .blank {
    margin-top: 28px;
    color: var(--muted);
    font-family: Georgia, "Times New Roman", serif;
    font-style: italic;
  }

  .prose {
    max-width: 68ch;
    margin-top: 28px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.04rem;
    line-height: 1.72;
  }

  .prose :global(p) {
    margin: 0 0 1.05em;
  }

  .prose :global(h1),
  .prose :global(h2),
  .prose :global(h3) {
    margin: 1.5em 0 0.45em;
    font-family: inherit;
    font-size: 1.3rem;
    font-weight: 600;
    letter-spacing: -0.015em;
    line-height: 1.2;
  }

  .prose :global(ul),
  .prose :global(ol) {
    margin: 0 0 1.05em;
    padding-left: 1.25em;
  }

  .prose :global(li) {
    margin-bottom: 0.3em;
  }

  .prose :global(strong) {
    font-weight: 650;
  }

  .prose :global(a) {
    color: var(--accent);
    text-decoration-thickness: 1px;
    text-underline-offset: 3px;
  }

  .prose :global(code) {
    padding: 0.12em 0.34em;
    border-radius: 5px;
    background: #efe8d9;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.84em;
  }

  .prose :global(pre) {
    overflow: auto;
    margin: 0 0 1.2em;
    padding: 14px 16px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: #faf5ea;
  }

  .prose :global(pre code) {
    padding: 0;
    background: transparent;
  }

  .prose :global(blockquote) {
    margin: 0 0 1.2em;
    padding: 10px 16px;
    border-left: 3px solid #d9b48e;
    border-radius: 0 10px 10px 0;
    background: #faf3e4;
    color: #5d5348;
    font-size: 0.96em;
  }

  .prose :global(blockquote p) {
    margin: 0.3em 0;
  }

  .prose :global(hr) {
    margin: 2em 0;
    border: 0;
    border-top: 1px solid var(--line);
  }

  .prose :global(table) {
    width: 100%;
    margin-bottom: 1.2em;
    border-collapse: collapse;
    font-size: 0.9em;
  }

  .prose :global(th),
  .prose :global(td) {
    padding: 7px 9px;
    border-bottom: 1px solid var(--line);
    text-align: left;
  }

  .chapter {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 40px;
    padding-top: 18px;
    border-top: 1px solid var(--line);
  }

  .chapter button {
    display: flex;
    min-height: 52px;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: transparent;
    color: var(--muted);
    font-size: 0.72rem;
    text-align: left;
    transition:
      background 160ms ease,
      border-color 160ms ease,
      color 160ms ease;
  }

  .chapter button:hover {
    border-color: color-mix(in oklab, var(--accent) 30%, var(--line));
    background: color-mix(in oklab, var(--accent) 4%, transparent);
    color: var(--accent);
  }

  .chapter .next {
    justify-content: flex-end;
    text-align: right;
  }

  .chapter button:only-child {
    grid-column: 1 / -1;
  }

  .chapter .dir {
    color: var(--accent);
    font-size: 0.9rem;
  }

  .chapter button span:not(.dir) {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .notes {
    margin-top: 44px;
    padding-top: 20px;
    border-top: 1px solid var(--line);
  }

  .notes-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 10px;
  }

  .notes-head h3 {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .notes-head span {
    color: var(--muted);
    font-size: 0.62rem;
  }

  .notes textarea {
    width: 100%;
    min-height: 86px;
    padding: 12px 13px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--card);
    color: var(--ink);
    font-family: inherit;
    font-size: 0.86rem;
    line-height: 1.5;
  }

  .notes textarea:focus {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
    box-shadow: 0 0 0 3px rgba(168, 69, 43, 0.1);
    outline: none;
  }

  .notes-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 8px;
    color: var(--muted);
    font-size: 0.64rem;
  }

  .notes-foot > span {
    display: inline-block;
  }

  .notes-foot .pulse {
    color: var(--accent);
    font-weight: 700;
    animation: pop 420ms ease;
  }

  @keyframes pop {
    from {
      opacity: 0;
      transform: translateY(3px);
    }
  }

  .cta {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    padding: 0 18px;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: #fffdf8;
    font-size: 0.78rem;
    font-weight: 700;
    letter-spacing: 0.01em;
    transition:
      background 160ms ease,
      box-shadow 160ms ease,
      transform 160ms ease;
  }

  .cta:hover:not(:disabled) {
    background: #8f3821;
    box-shadow: 0 8px 20px -12px rgba(168, 69, 43, 0.8);
  }

  .cta:active:not(:disabled) {
    transform: scale(0.97);
  }

  .cta.small {
    min-height: 36px;
    padding: 0 14px;
    font-size: 0.72rem;
  }

  .quiet {
    min-height: 44px;
    padding: 0 16px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: transparent;
    color: var(--muted);
    font-size: 0.78rem;
    font-weight: 650;
  }

  .quiet:hover {
    border-color: #c9bfae;
    color: var(--ink);
  }

  .compose .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 18px;
  }

  .compose .field > span {
    color: var(--muted);
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .compose input,
  .compose textarea {
    width: 100%;
    padding: 12px 14px;
    border: 1px solid var(--line);
    border-radius: 12px;
    background: var(--paper);
    color: var(--ink);
    font-size: 0.9rem;
    line-height: 1.55;
  }

  .compose input {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.35rem;
  }

  .compose textarea {
    min-height: 240px;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 0.82rem;
  }

  .compose input:focus,
  .compose textarea:focus {
    border-color: color-mix(in oklab, var(--accent) 40%, var(--line));
    box-shadow: 0 0 0 3px rgba(168, 69, 43, 0.1);
    outline: none;
  }

  .compose-actions {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 18px;
    padding: 12px 0 max(12px, env(safe-area-inset-bottom));
    background: linear-gradient(rgba(255, 253, 248, 0), var(--card) 34%);
  }

  .reader-empty {
    display: grid;
    max-width: 760px;
    margin: 0 auto;
    padding: 56px 20px;
    justify-items: start;
    gap: 14px;
  }

  /* ---------- wide ---------- */

  @media (min-width: 880px) {
    .map-app {
      display: grid;
      grid-template-columns: minmax(320px, 390px) minmax(0, 1fr);
      height: 100dvh;
      overflow: hidden;
    }

    .deck {
      height: 100dvh;
      min-height: 0;
      overflow-y: auto;
      padding: 24px 20px 0;
      border-right: 1px solid var(--line);
      background: transparent;
    }

    .tools {
      margin-right: -20px;
      margin-left: -20px;
      padding-right: 20px;
      padding-left: 20px;
    }

    .list {
      padding-bottom: 40px;
    }

    .reader {
      position: static;
      inset: auto;
      z-index: auto;
      height: 100dvh;
      border-left: 0;
    }

    .back {
      display: none;
    }

    .reader-bar {
      padding-right: 28px;
      padding-left: 28px;
    }

    .sheet {
      padding: 56px 44px 120px;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .card,
    .meter i,
    .ring-fill,
    .ladder .track i,
    .ladder button span,
    .reading,
    .card-go,
    .notes-foot .pulse {
      animation: none;
      transition: none;
    }
  }
</style>
