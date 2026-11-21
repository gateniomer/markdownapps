<!--
id: kanban
name: Kanban
description: A full-screen board with draggable cards.
version: 1
order: 2
permissions:
  - document:read
  - document:write
-->

<script>
  import {
    addTopic,
    addTopicComment,
    parseTopicDocument,
    setTopicMeta,
    updateTopic,
  } from "markdownapps/schema/topics";

  const LEVELS = ["New", "Shaky", "Learning", "Solid", "Strong"];
  const CONFIDENCES = ["unknown", "low", "medium", "high"];

  let { graph, actions } = $props();
  let dragId = $state(null);
  let modalOpen = $state(false);
  let newCard = $state(false);
  let openId = $state("");
  let titleDraft = $state("");
  let bodyDraft = $state("");
  let levelDraft = $state(0);
  let confidenceDraft = $state("unknown");
  let tagsDraft = $state("");
  let prereqDraft = $state("");
  let comment = $state("");
  let saving = $state(false);

  let topics = $derived(parseTopicDocument(graph.raw).topics);
  let columns = $derived(
    LEVELS.map((label, level) => ({
      level,
      label,
      topics: topics.filter((topic) => topic.level === level),
    }))
  );

  let openTopic = $derived(topics.find((topic) => topic.id === openId) ?? null);

  function startDrag(event, id) {
    dragId = id;
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", id);
  }

  function dropOn(event, level) {
    event.preventDefault();
    const id = dragId || event.dataTransfer.getData("text/plain");
    dragId = null;
    if (id) actions.write(setTopicMeta(graph.raw, id, "level", String(level)));
  }

  function openCard(id) {
    const topic = topics.find((candidate) => candidate.id === id);
    if (!topic) return;
    modalOpen = true;
    newCard = false;
    openId = id;
    titleDraft = topic.title;
    bodyDraft = topic.body || "";
    levelDraft = topic.level;
    confidenceDraft = topic.confidence;
    tagsDraft = topic.tags.join(", ");
    prereqDraft = topic.prereqs.join(", ");
    comment = "";
  }

  function startNew(level = 0) {
    modalOpen = true;
    newCard = true;
    openId = "";
    titleDraft = "";
    bodyDraft = "";
    levelDraft = level;
    confidenceDraft = "unknown";
    tagsDraft = "";
    prereqDraft = "";
    comment = "";
  }

  async function saveCard() {
    if (!titleDraft.trim() || saving) return;
    saving = true;
    const payload = {
      title: titleDraft,
      body: bodyDraft,
      level: Number(levelDraft),
      confidence: confidenceDraft,
      tags: tagsDraft,
      prereqs: prereqDraft,
    };
    const result = newCard
      ? addTopic(graph.raw, payload)
      : updateTopic(graph.raw, openId, payload);
    const ok = await actions.write(result.source);
    if (ok) modalOpen = false;
    saving = false;
  }

  async function sendComment(event) {
    event.preventDefault();
    if (!openTopic || !comment.trim() || saving) return;
    saving = true;
    const ok = await actions.write(addTopicComment(graph.raw, openTopic.id, comment));
    if (ok) comment = "";
    saving = false;
  }
</script>

<div class="kanban-app">
  <div class="board-title">
    <span class="board-mark">K</span>
    <div>
      <strong>{graph.title}</strong>
      <span>{topics.length} cards · board</span>
    </div>
  </div>

  <button class="floating-add" onclick={() => startNew(0)} aria-label="New card">+</button>

  <div class="board-scroll">
    <div class="board">
      {#each columns as column (column.level)}
        <section
          class="column"
          aria-label={`${column.label} level`}
          ondragover={(event) => event.preventDefault()}
          ondrop={(event) => dropOn(event, column.level)}
        >
          <header class="column-head">
            <span class="dot level-{column.level}"></span>
            <strong>{column.label}</strong>
            <small>{column.topics.length}</small>
          </header>

          <div class="column-cards">
            {#each column.topics as topic (topic.id)}
              <div
                class="kanban-card"
                class:active={openId === topic.id}
                role="button"
                tabindex="0"
                draggable={true}
                ondragstart={(event) => startDrag(event, topic.id)}
                ondragend={() => (dragId = null)}
                onclick={() => openCard(topic.id)}
                onkeydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openCard(topic.id);
                  }
                }}
              >
                <div class="card-meta">
                  <span>{topic.confidence}</span>
                  {#if topic.tags.length}<span>{topic.tags[0]}</span>{/if}
                </div>
                <h3>{topic.title}</h3>
                {#if topic.prereqs.length}
                  <p class="card-prereq">after {topic.prereqs.join(", ")}</p>
                {/if}
              </div>
            {/each}

            <button class="add-card" onclick={() => startNew(column.level)}>
              + Add card
            </button>
          </div>
        </section>
      {/each}
    </div>
  </div>

  {#if modalOpen}
    <div class="modal-backdrop" onclick={() => (modalOpen = false)} role="presentation"></div>
    <div class="card-modal" role="dialog" aria-modal="true" aria-label="Card details">
      <header class="modal-head">
        <span>{newCard ? "New card" : "Card"}</span>
        <button class="close" onclick={() => (modalOpen = false)} aria-label="Close">×</button>
      </header>

      <input class="title-input" bind:value={titleDraft} />
      <textarea class="body-input" bind:value={bodyDraft} placeholder="Card content in Markdown…"></textarea>

      <div class="field-grid">
        <label>
          <span>Level</span>
          <select bind:value={levelDraft}>
            {#each LEVELS as label, level}
              <option value={level}>{level} · {label}</option>
            {/each}
          </select>
        </label>

        <label>
          <span>Confidence</span>
          <select bind:value={confidenceDraft}>
            {#each CONFIDENCES as confidence}
              <option value={confidence}>{confidence}</option>
            {/each}
          </select>
        </label>
      </div>

      <label class="field">
        <span>Prerequisites</span>
        <input bind:value={prereqDraft} placeholder="Topic A, Topic B" />
      </label>

      <label class="field">
        <span>Tags</span>
        <input bind:value={tagsDraft} placeholder="react, frontend" />
      </label>

      <div class="modal-actions">
        <button class="ghost" onclick={() => (modalOpen = false)}>Cancel</button>
        <button class="save" onclick={saveCard} disabled={saving || !titleDraft.trim()}>
          {saving ? "Saving…" : newCard ? "Create card" : "Save card"}
        </button>
      </div>

      {#if !newCard && openTopic}
        <form class="comment-box" onsubmit={sendComment}>
          <textarea bind:value={comment} placeholder="Add a comment…"></textarea>
          <button class="quiet" type="submit" disabled={saving || !comment.trim()}>Add comment</button>
        </form>
      {/if}
    </div>
  {/if}
</div>

<style>
  .kanban-app {
    display: flex;
    flex-direction: column;
    min-height: 100vh;
    color: #e7f1ec;
    background:
      radial-gradient(circle at 50% -20%, rgba(69, 176, 139, 0.14), transparent 40rem),
      #0d1917;
  }

  .board-title {
    position: fixed;
    top: 16px;
    left: 18px;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 12px 8px 8px;
    border: 1px solid rgba(197, 226, 213, 0.14);
    border-radius: 12px;
    background: rgba(7, 17, 14, 0.82);
    backdrop-filter: blur(12px);
  }

  .board-mark {
    display: grid;
    width: 27px;
    height: 27px;
    place-items: center;
    border-radius: 7px;
    color: #04120d;
    background: #59d3a0;
    font-size: 0.68rem;
    font-weight: 800;
  }

  .board-title div {
    display: flex;
    flex-direction: column;
  }

  .board-title strong {
    max-width: 220px;
    overflow: hidden;
    color: #effaf4;
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .board-title span {
    color: #6e8b80;
    font-size: 0.58rem;
  }

  .floating-add {
    position: fixed;
    right: 22px;
    bottom: 20px;
    z-index: 4;
    display: grid;
    width: 46px;
    height: 46px;
    place-items: center;
    border: 1px solid #59d3a0;
    border-radius: 999px;
    color: #04120d;
    background: #59d3a0;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.3);
    font-size: 1.3rem;
    font-weight: 700;
  }

  .board-scroll {
    height: 100vh;
    overflow-x: auto;
    overflow-y: hidden;
  }

  .board {
    display: grid;
    grid-template-columns: repeat(5, 260px);
    gap: 10px;
    height: 100vh;
    padding: 70px 16px 18px;
    align-items: stretch;
  }

  .column {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 9px;
    border: 1px solid rgba(197, 226, 213, 0.12);
    border-radius: 12px;
    background: rgba(24, 46, 40, 0.55);
  }

  .column-head {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 3px 4px 10px;
    color: #b9d2c7;
    font-size: 0.66rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .column-head strong {
    flex: 1;
    font-weight: 700;
  }

  .column-head small {
    color: #6e8b80;
    font-size: 0.6rem;
  }

  .column-cards {
    display: flex;
    flex: 1;
    flex-direction: column;
    gap: 7px;
    overflow-y: auto;
    padding-right: 2px;
  }

  .kanban-card {
    padding: 11px;
    border: 1px solid rgba(197, 226, 213, 0.18);
    border-radius: 9px;
    background: #162a25;
    box-shadow: 0 8px 18px rgba(0, 0, 0, 0.12);
    cursor: grab;
  }

  .kanban-card:active {
    cursor: grabbing;
  }

  .kanban-card:hover,
  .kanban-card.active {
    border-color: #59d3a0;
    background: #1a332c;
  }

  .kanban-card h3 {
    margin: 6px 0 0;
    color: #effaf4;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 0.98rem;
    font-weight: 500;
    line-height: 1.18;
  }

  .card-meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: #6e8b80;
    font-size: 0.55rem;
    text-transform: uppercase;
  }

  .card-prereq {
    margin: 6px 0 0;
    color: #79958a;
    font-size: 0.63rem;
    line-height: 1.35;
  }

  .add-card {
    padding: 8px;
    border: 1px dashed rgba(197, 226, 213, 0.2);
    border-radius: 8px;
    color: #69877b;
    background: transparent;
    font-size: 0.64rem;
    text-align: left;
  }

  .add-card:hover {
    border-color: #59d3a0;
    color: #59d3a0;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(3, 9, 7, 0.58);
    backdrop-filter: blur(3px);
  }

  .card-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 21;
    display: flex;
    align-items: stretch;
    flex-direction: column;
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 40px);
    overflow: auto;
    padding: 20px;
    border: 1px solid #dcd8cc;
    border-radius: 16px;
    color: #1d2420;
    background: #f4f1e9;
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.3);
    transform: translate(-50%, -50%);
  }

  .modal-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #7b827a;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .close {
    width: 28px;
    height: 28px;
    border: 1px solid #dcd8cc;
    border-radius: 6px;
    color: #49524b;
    background: #fffdf7;
    font-size: 1rem;
    line-height: 1;
  }

  .title-input {
    margin-top: 12px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.7rem;
  }

  .body-input {
    min-height: 160px;
    margin-top: 8px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.78rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }

  .field,
  .field-grid label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }

  .field span,
  .field-grid span {
    color: #7b827a;
    font-size: 0.6rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  .field input,
  .field-grid select {
    border-color: #d8d2c4;
    background: #fffdf7;
    font-size: 0.75rem;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 14px;
  }

  .ghost,
  .quiet {
    padding: 6px 9px;
    border: 0;
    border-radius: 6px;
    color: #647068;
    background: transparent;
    font-size: 0.7rem;
  }

  .ghost {
    border: 1px solid #d8d2c4;
    background: #fffdf7;
  }

  .save {
    padding: 7px 11px;
    border: 1px solid #176b4d;
    border-radius: 6px;
    color: #ffffff;
    background: #176b4d;
    font-size: 0.72rem;
    font-weight: 700;
  }

  .comment-box {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #ddd8cc;
  }

  .comment-box textarea {
    min-height: 56px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-size: 0.74rem;
  }

  @media (max-width: 620px) {
    .board {
      grid-template-columns: repeat(5, 220px);
      height: 100vh;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
