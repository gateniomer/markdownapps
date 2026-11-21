<!--
id: network
name: Network
description: A full-screen graph explorer for prerequisites and links.
version: 1
order: 3
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
  const COLORS = ["#7d8b83", "#e07a5f", "#dfad4d", "#4fa58d", "#72d39a"];
  const WIDTH = 920;
  const HEIGHT = 650;
  const CX = WIDTH / 2;
  const CY = HEIGHT / 2;

  let { graph, actions } = $props();
  let openId = $state(null);
  let query = $state("");
  let zoom = $state(1);
  let bodyDraft = $state("");
  let editingBody = $state(false);
  let comment = $state("");
  let saving = $state(false);
  let newMode = $state(false);
  let newTitle = $state("");
  let newBody = $state("");
  let connectKind = $state("prereq");
  let connectTarget = $state("");

  let topics = $derived(parseTopicDocument(graph.raw).topics);

  let layout = $derived.by(() => {
    const buckets = new Map();
    for (const topic of topics) {
      const level = Math.min(4, Math.max(0, topic.level));
      if (!buckets.has(level)) buckets.set(level, []);
      buckets.get(level).push(topic);
    }

    const nodes = new Map();
    for (let level = 0; level <= 4; level += 1) {
      const group = buckets.get(level) || [];
      const radius = 58 + level * 63;
      group.forEach((topic, index) => {
        const angle =
          -Math.PI / 2 + level * 0.42 + (index / Math.max(1, group.length)) * Math.PI * 2;
        nodes.set(topic.id, {
          topic,
          x: CX + Math.cos(angle) * radius,
          y: CY + Math.sin(angle) * radius,
          radius: 10 + (4 - level) * 1.1,
        });
      });
    }

    const edges = [];
    const seen = new Set();
    for (const topic of topics) {
      const to = nodes.get(topic.id);
      if (!to) continue;

      for (const name of topic.prereqs) {
        const fromTopic = topics.find(
          (candidate) => candidate.title.toLowerCase() === name.trim().toLowerCase()
        );
        const from = fromTopic && nodes.get(fromTopic.id);
        if (from) edges.push({ from, to, kind: "prereq" });
      }

      for (const name of topic.related) {
        const other = topics.find(
          (candidate) => candidate.title.toLowerCase() === name.trim().toLowerCase()
        );
        if (!other || other.id === topic.id) continue;
        const from = nodes.get(other.id);
        if (!from) continue;
        const key = [from.topic.id, to.topic.id].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ from, to, kind: "related" });
      }
    }

    return { nodes: [...nodes.values()], edges };
  });

  let bounds = $derived.by(() => {
    const nodes = layout.nodes;
    if (nodes.length === 0) return { x: 0, y: 0, w: WIDTH, h: HEIGHT };
    const pad = 110;
    const xs = nodes.flatMap((node) => [node.x - node.radius - pad, node.x + node.radius + pad]);
    const ys = nodes.flatMap((node) => [node.y - node.radius - pad, node.y + node.radius + pad]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return {
      x,
      y,
      w: Math.max(320, Math.max(...xs) - x),
      h: Math.max(320, Math.max(...ys) - y),
    };
  });

  let view = $derived.by(() => {
    const w = bounds.w / zoom;
    const h = bounds.h / zoom;
    return {
      x: bounds.x + (bounds.w - w) / 2,
      y: bounds.y + (bounds.h - h) / 2,
      w,
      h,
    };
  });

  let openTopic = $derived(topics.find((topic) => topic.id === openId) ?? null);
  let needle = $derived(query.trim().toLowerCase());

  function isMatch(topic) {
    if (!needle) return true;
    return [topic.title, topic.tags.join(" "), topic.prereqs.join(" ")]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  }

  function openNode(id) {
    openId = id;
    newMode = false;
    editingBody = false;
    comment = "";
    connectTarget = "";
  }

  function startNew() {
    newMode = true;
    openId = null;
    newTitle = "";
    newBody = "";
    editingBody = false;
  }

  async function saveNew() {
    if (!newTitle.trim() || saving) return;
    saving = true;
    const result = addTopic(graph.raw, {
      title: newTitle,
      body: newBody,
      level: 0,
      confidence: "unknown",
    });
    const ok = await actions.write(result.source);
    if (ok) {
      openId = result.id;
      newMode = false;
    }
    saving = false;
  }

  async function saveBody() {
    if (!openTopic || saving) return;
    saving = true;
    const result = updateTopic(graph.raw, openTopic.id, { body: bodyDraft });
    const ok = await actions.write(result.source);
    if (ok) editingBody = false;
    saving = false;
  }

  async function setLevel(delta) {
    if (!openTopic) return;
    const next = Math.min(4, Math.max(0, openTopic.level + delta));
    if (next !== openTopic.level) {
      await actions.write(setTopicMeta(graph.raw, openTopic.id, "level", String(next)));
    }
  }

  async function cycleConfidence() {
    if (!openTopic) return;
    const values = ["unknown", "low", "medium", "high"];
    const next = values[(values.indexOf(openTopic.confidence) + 1) % values.length];
    await actions.write(setTopicMeta(graph.raw, openTopic.id, "confidence", next));
  }

  async function addConnection() {
    if (!openTopic || !connectTarget || saving) return;
    const target = topics.find((topic) => topic.id === connectTarget);
    if (!target) return;
    saving = true;
    const name = target.title;
    const without = (list) => list.filter((item) => item.toLowerCase() !== name.toLowerCase());
    const prereqs = without(openTopic.prereqs);
    const related = without(openTopic.related);
    if (connectKind === "prereq") prereqs.push(name);
    else related.push(name);
    const result = updateTopic(graph.raw, openTopic.id, {
      prereqs: prereqs.join(", "),
      related: related.join(", "),
    });
    const ok = await actions.write(result.source);
    if (ok) connectTarget = "";
    saving = false;
  }

  async function removeConnection(kind, name) {
    if (!openTopic || saving) return;
    saving = true;
    const keep = (list) => list.filter((item) => item.toLowerCase() !== name.toLowerCase());
    const result = updateTopic(graph.raw, openTopic.id, {
      prereqs: kind === "prereq" ? keep(openTopic.prereqs).join(", ") : openTopic.prereqs.join(", "),
      related: kind === "related" ? keep(openTopic.related).join(", ") : openTopic.related.join(", "),
    });
    await actions.write(result.source);
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

  function shortTitle(title) {
    return title.length > 18 ? `${title.slice(0, 17)}…` : title;
  }
</script>

<div class="network-app">
  <div class="canvas-wrap">
    <svg
      viewBox={`${view.x} ${view.y} ${view.w} ${view.h}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      aria-label="Topic network"
    >
      <defs>
        <radialGradient id="network-bg" cx="50%" cy="50%" r="65%">
          <stop offset="0%" stop-color="#143029" />
          <stop offset="100%" stop-color="#050b09" />
        </radialGradient>
        <filter id="node-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x={view.x} y={view.y} width={view.w} height={view.h} fill="url(#network-bg)" />

      {#each layout.edges as edge}
        <line
          class:related={edge.kind === "related"}
          class:active={openTopic?.id === edge.from.topic.id || openTopic?.id === edge.to.topic.id}
          x1={edge.from.x}
          y1={edge.from.y}
          x2={edge.to.x}
          y2={edge.to.y}
        />
      {/each}

      {#each layout.nodes as node (node.topic.id)}
        <g
          class="network-node"
          class:active={openTopic?.id === node.topic.id}
          class:dimmed={!isMatch(node.topic)}
          onclick={() => openNode(node.topic.id)}
          role="button"
          tabindex="0"
          onkeydown={(event) => {
            if (event.key === "Enter" || event.key === " ") openNode(node.topic.id);
          }}
        >
          <circle
            cx={node.x}
            cy={node.y}
            r={openTopic?.id === node.topic.id ? node.radius + 5 : node.radius}
            fill={COLORS[node.topic.level]}
            filter={openTopic?.id === node.topic.id ? "url(#node-glow)" : ""}
          />
          <text x={node.x} y={node.y + node.radius + 16} text-anchor="middle">
            {shortTitle(node.topic.title)}
          </text>
          <title>{node.topic.title} · {LEVELS[node.topic.level]} · {node.topic.confidence}</title>
        </g>
      {/each}
    </svg>
  </div>

  <div class="canvas-title">
    <span class="title-mark">N</span>
    <div>
      <strong>{graph.title}</strong>
      <span>{topics.length} nodes</span>
    </div>
  </div>

  <div class="canvas-controls">
    <input bind:value={query} placeholder="Search nodes…" />
    <div class="zoom-controls">
      <button onclick={() => (zoom = Math.max(0.6, zoom - 0.2))} aria-label="Zoom out">−</button>
      <button onclick={() => (zoom = 1)}>{Math.round(zoom * 100)}%</button>
      <button onclick={() => (zoom = Math.min(2.4, zoom + 0.2))} aria-label="Zoom in">+</button>
    </div>
    <button class="new-button" onclick={startNew}>+ Node</button>
  </div>

  <div class="canvas-legend">
    {#each LEVELS as label, index}
      <span><i style={`background:${COLORS[index]}`}></i>{label}</span>
    {/each}
  </div>

  {#if topics.length === 0}
    <div class="canvas-empty">
      <p>No nodes yet.</p>
      <button class="new-button" onclick={startNew}>Create the first node</button>
    </div>
  {/if}

  {#if newMode}
    <aside class="inspector">
      <header class="inspector-head">
        <span>NEW NODE</span>
        <button class="close" onclick={() => (newMode = false)} aria-label="Close inspector">×</button>
      </header>
      <h1>New node</h1>
      <input class="inspector-title-input" bind:value={newTitle} placeholder="Node title" />
      <textarea class="inspector-body-input" bind:value={newBody} placeholder="Content in Markdown…"></textarea>
      <div class="inspector-actions">
        <button class="quiet" onclick={() => (newMode = false)}>Cancel</button>
        <button class="save" onclick={saveNew} disabled={saving || !newTitle.trim()}>
          {saving ? "Creating…" : "Create node"}
        </button>
      </div>
    </aside>
  {:else if openTopic}
    <aside class="inspector">
      <header class="inspector-head">
        <span>{openTopic.id}</span>
        <button class="close" onclick={() => (openId = null)} aria-label="Close inspector">×</button>
      </header>

      <h1>{openTopic.title}</h1>

      <div class="meta-line">
        <span class="level-chip">{LEVELS[openTopic.level]}</span>
        <button class="confidence" onclick={cycleConfidence}>
          {openTopic.confidence}
        </button>
      </div>

      <div class="level-stepper">
        <button onclick={() => setLevel(-1)} disabled={openTopic.level <= 0}>−</button>
        <span>{openTopic.level} / 4</span>
        <button onclick={() => setLevel(1)} disabled={openTopic.level >= 4}>+</button>
      </div>

      {#if openTopic.tags.length}
        <p class="tags">{openTopic.tags.join(" · ")}</p>
      {/if}

      <section class="connections">
        <div class="section-head"><span>Connections</span></div>

        {#if openTopic.prereqs.length}
          <div class="connection-group">
            <span class="connection-label">Prerequisites</span>
            {#each openTopic.prereqs as name}
              <span class="connection solid">
                {name}
                <button onclick={() => removeConnection("prereq", name)} aria-label={`Remove ${name}`}>×</button>
              </span>
            {/each}
          </div>
        {/if}

        {#if openTopic.related.length}
          <div class="connection-group">
            <span class="connection-label">Related</span>
            {#each openTopic.related as name}
              <span class="connection dashed">
                {name}
                <button onclick={() => removeConnection("related", name)} aria-label={`Remove ${name}`}>×</button>
              </span>
            {/each}
          </div>
        {/if}

        <div class="connect-form">
          <select bind:value={connectKind}>
            <option value="prereq">Prerequisite</option>
            <option value="related">Related</option>
          </select>
          <select bind:value={connectTarget}>
            <option value="">Connect to…</option>
            {#each topics as topic (topic.id)}
              {#if topic.id !== openTopic.id}
                <option value={topic.id}>{topic.title}</option>
              {/if}
            {/each}
          </select>
          <button onclick={addConnection} disabled={!connectTarget || saving}>Connect</button>
        </div>
      </section>

      <section class="body-section">
        <div class="section-head">
          <span>Content</span>
          {#if editingBody}
            <div>
              <button class="quiet" onclick={() => (editingBody = false)}>Cancel</button>
              <button class="save" onclick={saveBody} disabled={saving}>Save</button>
            </div>
          {:else}
            <button class="quiet" onclick={() => (editingBody = true, bodyDraft = openTopic.body || "")}>
              Edit
            </button>
          {/if}
        </div>

        {#if editingBody}
          <textarea bind:value={bodyDraft}></textarea>
        {:else if openTopic.html}
          <div class="markdown">{@html openTopic.html}</div>
        {:else}
          <p class="muted">No content.</p>
        {/if}
      </section>

      <form class="comment-form" onsubmit={sendComment}>
        <textarea bind:value={comment} placeholder="Add a comment…"></textarea>
        <button class="save" type="submit" disabled={saving || !comment.trim()}>Add</button>
      </form>
    </aside>
  {/if}
</div>

<style>
  .network-app {
    position: relative;
    height: 100vh;
    overflow: hidden;
    color: #dcefe6;
    background: #050b09;
  }

  .canvas-wrap {
    position: absolute;
    inset: 0;
  }

  svg {
    display: block;
    width: 100%;
    height: 100%;
  }

  line {
    stroke: #6fd7ac;
    stroke-width: 1;
    opacity: 0.35;
  }

  line.related {
    stroke: #88a7bd;
    stroke-dasharray: 4 5;
    opacity: 0.18;
  }

  line.active {
    stroke: #a8ffda;
    stroke-width: 1.6;
    opacity: 0.85;
  }

  .network-node {
    cursor: pointer;
    transition: opacity 140ms ease;
  }

  .network-node circle {
    stroke: rgba(255, 255, 255, 0.45);
    stroke-width: 1;
  }

  .network-node text {
    fill: #c8d8d1;
    font-family: Inter, ui-sans-serif, sans-serif;
    font-size: 10px;
    pointer-events: none;
  }

  .network-node:hover circle,
  .network-node.active circle {
    stroke: #e8fff4;
    stroke-width: 2;
  }

  .network-node:hover text,
  .network-node.active text {
    fill: #ffffff;
  }

  .network-node.dimmed {
    opacity: 0.18;
  }

  .canvas-title {
    position: absolute;
    top: 16px;
    left: 18px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 12px 9px 9px;
    border: 1px solid rgba(196, 233, 217, 0.14);
    border-radius: 12px;
    background: rgba(6, 15, 12, 0.72);
    backdrop-filter: blur(12px);
  }

  .title-mark {
    display: grid;
    width: 27px;
    height: 27px;
    place-items: center;
    border-radius: 7px;
    color: #04120d;
    background: #65e7b0;
    font-size: 0.7rem;
    font-weight: 800;
  }

  .canvas-title div {
    display: flex;
    flex-direction: column;
  }

  .canvas-title strong {
    max-width: 220px;
    overflow: hidden;
    color: #f1fff8;
    font-size: 0.78rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canvas-title span {
    color: #719083;
    font-size: 0.6rem;
  }

  .canvas-controls {
    position: absolute;
    top: 16px;
    right: 18px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px;
    border: 1px solid rgba(196, 233, 217, 0.14);
    border-radius: 12px;
    background: rgba(6, 15, 12, 0.72);
    backdrop-filter: blur(12px);
  }

  .canvas-controls input {
    width: 180px;
    border-color: rgba(196, 233, 217, 0.13);
    color: #e7f1ec;
    background: rgba(255, 255, 255, 0.05);
    font-size: 0.7rem;
  }

  .canvas-controls input::placeholder {
    color: #5f7d71;
  }

  .zoom-controls {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .zoom-controls button {
    min-width: 26px;
    height: 26px;
    padding: 0 5px;
    border: 0;
    border-radius: 5px;
    color: #9db9ac;
    background: transparent;
    font-size: 0.6rem;
  }

  .zoom-controls button:hover {
    background: rgba(255, 255, 255, 0.07);
  }

  .new-button {
    padding: 6px 9px;
    border: 1px solid #65e7b0;
    border-radius: 6px;
    color: #04120d;
    background: #65e7b0;
    font-size: 0.65rem;
    font-weight: 750;
  }

  .canvas-legend {
    position: absolute;
    bottom: 16px;
    left: 18px;
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    padding: 8px 10px;
    border: 1px solid rgba(196, 233, 217, 0.12);
    border-radius: 9px;
    color: #78978a;
    background: rgba(6, 15, 12, 0.66);
    font-size: 0.58rem;
  }

  .canvas-legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .canvas-legend i {
    width: 6px;
    height: 6px;
    border-radius: 999px;
  }

  .canvas-empty {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: #85a396;
  }

  .inspector {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 5;
    width: min(390px, 100vw);
    overflow: auto;
    padding: 18px 20px 40px;
    border-left: 1px solid rgba(196, 233, 217, 0.14);
    color: #1d2420;
    background: #f4f1e9;
    box-shadow: -30px 0 70px rgba(0, 0, 0, 0.35);
  }

  .inspector-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: #8a8f86;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.58rem;
  }

  .close {
    width: 26px;
    height: 26px;
    border: 1px solid #dcd8cc;
    border-radius: 6px;
    color: #49524b;
    background: #fffdf7;
    font-size: 1rem;
    line-height: 1;
  }

  .inspector h1 {
    margin: 14px 0 12px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.8rem;
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }

  .inspector-title-input,
  .inspector-body-input {
    border-color: #d8d2c4;
    background: #fffdf7;
  }

  .inspector-title-input {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.2rem;
  }

  .inspector-body-input {
    min-height: 180px;
    margin-top: 8px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.76rem;
  }

  .inspector-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
    margin-top: 12px;
  }

  .meta-line {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .level-chip {
    padding: 4px 8px;
    border-radius: 999px;
    color: #176b4d;
    background: #e1efe6;
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
  }

  .confidence {
    padding: 4px 8px;
    border: 1px solid #ddd8ca;
    border-radius: 999px;
    color: #6e766f;
    background: transparent;
    font-size: 0.65rem;
  }

  .level-stepper {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    color: #6e766f;
    font-size: 0.68rem;
  }

  .level-stepper button {
    width: 24px;
    height: 24px;
    border: 1px solid #dcd8cc;
    border-radius: 5px;
    color: #49524b;
    background: #fffdf7;
    line-height: 1;
  }

  .tags {
    margin: 12px 0 0;
    color: #8a8f86;
    font-size: 0.68rem;
  }

  .connections {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #ddd8cc;
  }

  .connection-group {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    margin-top: 8px;
  }

  .connection-label {
    margin-right: 3px;
    color: #8a8f86;
    font-size: 0.58rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .connection {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 4px 3px 7px;
    border-radius: 6px;
    color: #49524b;
    background: #eef3ec;
    font-size: 0.64rem;
  }

  .connection.dashed {
    color: #4c6476;
    background: #edf1f5;
  }

  .connection button {
    width: 16px;
    height: 16px;
    padding: 0;
    border: 0;
    border-radius: 4px;
    color: #7a847c;
    background: transparent;
    line-height: 1;
  }

  .connection button:hover {
    color: #a6472d;
    background: #f4e7e2;
  }

  .connect-form {
    display: grid;
    grid-template-columns: 1fr 1.35fr auto;
    gap: 5px;
    margin-top: 12px;
  }

  .connect-form select {
    min-width: 0;
    padding: 6px 7px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-size: 0.64rem;
  }

  .connect-form button {
    padding: 6px 8px;
    border: 1px solid #176b4d;
    border-radius: 5px;
    color: #ffffff;
    background: #176b4d;
    font-size: 0.63rem;
    font-weight: 650;
  }

  .body-section {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #ddd8cc;
  }

  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #8a8f86;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .section-head > div {
    display: flex;
    gap: 4px;
  }

  .body-section textarea {
    min-height: 150px;
    margin-top: 8px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.75rem;
  }

  .markdown {
    margin-top: 10px;
    font-size: 0.82rem;
    line-height: 1.55;
  }

  .muted {
    color: #8a8f86;
    font-style: italic;
  }

  .quiet {
    padding: 4px 6px;
    border: 0;
    border-radius: 4px;
    color: #6e766f;
    background: transparent;
    font-size: 0.66rem;
  }

  .save {
    padding: 6px 9px;
    border: 1px solid #176b4d;
    border-radius: 5px;
    color: #ffffff;
    background: #176b4d;
    font-size: 0.68rem;
    font-weight: 700;
  }

  .comment-form {
    display: flex;
    align-items: flex-end;
    gap: 6px;
    margin-top: 16px;
    padding-top: 14px;
    border-top: 1px solid #ddd8cc;
  }

  .comment-form textarea {
    min-height: 54px;
    border-color: #d8d2c4;
    background: #fffdf7;
    font-size: 0.73rem;
  }

  @media (max-width: 720px) {
    .canvas-controls {
      left: 18px;
      right: auto;
      top: 76px;
    }

    .canvas-controls input {
      width: 130px;
    }

    .inspector {
      width: 100vw;
    }
  }
</style>
