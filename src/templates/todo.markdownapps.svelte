<!--
id: todo
name: Todo
description: A task list with priorities, due dates, and completion.
version: 1
order: 4
permissions:
  - document:read
  - document:write
-->

<script>
  import {
    addSection,
    parseTopicDocument,
    removeSection,
    setTopicMeta,
    updateTopic,
  } from "markdownapps/schema/topics";

  const PRIORITIES = ["low", "medium", "high"];

  let { graph, actions } = $props();
  let filter = $state("open");
  let modalOpen = $state(false);
  let editId = $state("");
  let titleDraft = $state("");
  let bodyDraft = $state("");
  let priorityDraft = $state("medium");
  let dueDraft = $state("");
  let tagsDraft = $state("");
  let saving = $state(false);

  let todos = $derived.by(() =>
    parseTopicDocument(graph.raw).topics.map((topic) => ({
      ...topic,
      done: String(topic.meta?.done ?? "false").toLowerCase() === "true",
      priority: String(topic.meta?.priority ?? "medium").toLowerCase(),
      due: String(topic.meta?.due ?? ""),
    }))
  );

  let visible = $derived.by(() => {
    const list = todos.filter((todo) => {
      if (filter === "open") return !todo.done;
      if (filter === "done") return todo.done;
      return true;
    });
    return list.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      if (a.due && b.due) return a.due.localeCompare(b.due);
      if (a.due) return -1;
      if (b.due) return 1;
      return a.title.localeCompare(b.title);
    });
  });

  let openCount = $derived(todos.filter((todo) => !todo.done).length);
  let doneCount = $derived(todos.length - openCount);
  let filterLabel = $derived(
    filter === "open" ? "Open tasks" : filter === "done" ? "Completed" : "All tasks"
  );

  function openNew() {
    modalOpen = true;
    editId = "";
    titleDraft = "";
    bodyDraft = "";
    priorityDraft = "medium";
    dueDraft = "";
    tagsDraft = "";
  }

  function openEdit(todo) {
    modalOpen = true;
    editId = todo.id;
    titleDraft = todo.title;
    bodyDraft = todo.body || "";
    priorityDraft = todo.priority;
    dueDraft = todo.due;
    tagsDraft = todo.tags.join(", ");
  }

  async function toggle(todo) {
    await actions.write(setTopicMeta(graph.raw, todo.id, "done", todo.done ? "false" : "true"));
  }

  async function saveTask() {
    if (!titleDraft.trim() || saving) return;
    saving = true;
    let result;
    if (editId) {
      let next = graph.raw;
      next = setTopicMeta(next, editId, "priority", priorityDraft);
      next = setTopicMeta(next, editId, "due", dueDraft);
      next = setTopicMeta(next, editId, "tags", tagsDraft);
      result = updateTopic(next, editId, { title: titleDraft, body: bodyDraft });
    } else {
      result = addSection(graph.raw, {
        title: titleDraft,
        body: bodyDraft,
        meta: {
          done: "false",
          priority: priorityDraft,
          due: dueDraft,
          tags: tagsDraft,
        },
      });
    }
    const ok = await actions.write(result.source);
    if (ok) modalOpen = false;
    saving = false;
  }

  async function removeTask() {
    if (!editId || saving) return;
    saving = true;
    const ok = await actions.write(removeSection(graph.raw, editId));
    if (ok) modalOpen = false;
    saving = false;
  }

  function isOverdue(todo) {
    if (!todo.due || todo.done) return false;
    return todo.due < new Date().toISOString().slice(0, 10);
  }
</script>

<div class="todo-app">
  <aside class="todo-side">
    <div class="todo-brand">
      <span class="todo-mark">✓</span>
      <div>
        <strong>{graph.title}</strong>
        <span>task list</span>
      </div>
    </div>

    <div class="side-stat">
      <strong>{openCount}</strong>
      <span>open tasks</span>
    </div>

    <nav class="filters">
      <button class:active={filter === "open"} onclick={() => (filter = "open")}>
        Open <span>{openCount}</span>
      </button>
      <button class:active={filter === "all"} onclick={() => (filter = "all")}>
        All <span>{todos.length}</span>
      </button>
      <button class:active={filter === "done"} onclick={() => (filter = "done")}>
        Done <span>{doneCount}</span>
      </button>
    </nav>

    <button class="new-button" onclick={openNew}>+ New task</button>
    <p class="side-note">{doneCount} completed</p>
  </aside>

  <main class="todo-main">
    <header class="list-head">
      <h1>{filterLabel}</h1>
      <span>{visible.length}</span>
    </header>

    {#if visible.length === 0}
      <div class="empty">
        <p>{filter === "open" ? "Nothing open." : "No tasks here."}</p>
        <button class="new-button" onclick={openNew}>Add a task</button>
      </div>
    {:else}
      <ul class="task-list">
        {#each visible as todo (todo.id)}
          <li class:done={todo.done} class:overdue={isOverdue(todo)}>
            <button
              class="check"
              class:checked={todo.done}
              onclick={() => toggle(todo)}
              aria-label={todo.done ? "Mark open" : "Mark done"}
            >
              {todo.done ? "✓" : ""}
            </button>

            <button class="task-body" onclick={() => openEdit(todo)}>
              <strong>{todo.title}</strong>
              {#if todo.body}<span>{todo.body.replace(/[#*_`>\[\]]/g, "").slice(0, 120)}</span>{/if}
            </button>

            <div class="task-meta">
              {#if todo.due}
                <span class="due" class:late={isOverdue(todo)}>{todo.due}</span>
              {/if}
              <span class="priority {todo.priority}">{todo.priority}</span>
              {#if todo.tags.length}<span class="tags">{todo.tags.join(" · ")}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}
  </main>

  {#if modalOpen}
    <div class="modal-backdrop" onclick={() => (modalOpen = false)} role="presentation"></div>
    <div class="task-modal" role="dialog" aria-modal="true" aria-label="Task editor">
      <header>
        <span>{editId ? "Edit task" : "New task"}</span>
        <button class="close" onclick={() => (modalOpen = false)} aria-label="Close">×</button>
      </header>

      <input class="title-input" bind:value={titleDraft} placeholder="Task title" />
      <textarea class="body-input" bind:value={bodyDraft} placeholder="Notes in Markdown…"></textarea>

      <div class="field-grid">
        <label>
          <span>Priority</span>
          <select bind:value={priorityDraft}>
            {#each PRIORITIES as priority}
              <option value={priority}>{priority}</option>
            {/each}
          </select>
        </label>
        <label>
          <span>Due</span>
          <input type="date" bind:value={dueDraft} />
        </label>
      </div>

      <label class="field">
        <span>Tags</span>
        <input bind:value={tagsDraft} placeholder="work, personal" />
      </label>

      <div class="modal-actions">
        {#if editId}
          <button class="delete" onclick={removeTask} disabled={saving}>Delete</button>
        {/if}
        <div>
          <button class="ghost" onclick={() => (modalOpen = false)}>Cancel</button>
          <button class="save" onclick={saveTask} disabled={saving || !titleDraft.trim()}>
            {saving ? "Saving…" : editId ? "Save task" : "Create task"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .todo-app {
    display: grid;
    grid-template-columns: 270px minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    color: #26312b;
    background: #f5f7f3;
  }

  .todo-side {
    display: flex;
    flex-direction: column;
    padding: 24px 20px;
    color: #dcebe2;
    background: #10251b;
  }

  .todo-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .todo-mark {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: 9px;
    color: #ffffff;
    background: #2f855a;
    font-size: 1rem;
    font-weight: 800;
  }

  .todo-brand div {
    display: flex;
    flex-direction: column;
  }

  .todo-brand strong {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.15rem;
    font-weight: 500;
  }

  .todo-brand span {
    color: #7e9a8b;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .side-stat {
    display: flex;
    flex-direction: column;
    margin: 34px 0 26px;
  }

  .side-stat strong {
    color: #f1fbf5;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 4rem;
    font-weight: 500;
    line-height: 0.9;
  }

  .side-stat span {
    margin-top: 5px;
    color: #7e9a8b;
    font-size: 0.65rem;
  }

  .new-button {
    padding: 8px 12px;
    border: 1px solid #2f855a;
    border-radius: 7px;
    color: #ffffff;
    background: #2f855a;
    font-size: 0.74rem;
    font-weight: 700;
  }

  .todo-side .new-button {
    margin-top: auto;
    border-color: #59b984;
    background: #59b984;
    color: #0b1d14;
  }

  .side-note {
    margin: 10px 0 0;
    color: #6d897a;
    font-size: 0.62rem;
    text-align: center;
  }

  .todo-main {
    overflow: auto;
    padding: 38px max(28px, 6vw) 70px;
  }

  .list-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    max-width: 760px;
    margin: 0 auto 18px;
    padding-bottom: 14px;
    border-bottom: 1px solid #dce3db;
  }

  .list-head h1 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 2.2rem;
    font-weight: 500;
    letter-spacing: -0.035em;
  }

  .list-head span {
    color: #8a958d;
    font-size: 0.66rem;
  }

  .filters {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .filters button {
    display: flex;
    justify-content: space-between;
    padding: 8px 9px;
    border: 1px solid transparent;
    border-radius: 7px;
    color: #94ab9f;
    background: transparent;
    font-size: 0.72rem;
    text-align: left;
  }

  .filters button span {
    color: #6d897a;
  }

  .filters button.active {
    border-color: rgba(89, 185, 132, 0.18);
    color: #e8f7ee;
    background: rgba(89, 185, 132, 0.1);
  }

  .task-list {
    display: flex;
    max-width: 760px;
    flex-direction: column;
    gap: 1px;
    margin: 0 auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid #dce3db;
    border-radius: 12px;
    background: #dce3db;
    list-style: none;
  }

  .task-list li {
    display: grid;
    grid-template-columns: 28px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    padding: 12px 14px;
    background: #fffefa;
  }

  .task-list li.done {
    background: #f8faf7;
  }

  .task-list li.done .task-body strong {
    color: #8c978f;
    text-decoration: line-through;
  }

  .check {
    width: 22px;
    height: 22px;
    border: 1.5px solid #b9c8bd;
    border-radius: 6px;
    color: #ffffff;
    background: transparent;
    font-size: 0.8rem;
    line-height: 1;
  }

  .check.checked {
    border-color: #2f855a;
    background: #2f855a;
  }

  .task-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    background: transparent;
    text-align: left;
  }

  .task-body strong {
    color: #26312b;
    font-size: 0.86rem;
    font-weight: 600;
  }

  .task-body span {
    overflow: hidden;
    color: #8a958d;
    font-size: 0.7rem;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-meta {
    display: flex;
    align-items: center;
    gap: 7px;
    color: #8a958d;
    font-size: 0.62rem;
  }

  .due {
    padding: 3px 6px;
    border-radius: 5px;
    background: #f1f4ef;
  }

  .due.late {
    color: #a6472d;
    background: #f8e8e2;
  }

  .priority {
    padding: 3px 6px;
    border-radius: 999px;
    text-transform: uppercase;
  }

  .priority.low {
    background: #eef2f7;
  }

  .priority.medium {
    color: #8a651d;
    background: #f8efd9;
  }

  .priority.high {
    color: #9d3f2a;
    background: #f8e3dc;
  }

  .tags {
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    display: grid;
    min-height: 300px;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: #7c887f;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(18, 30, 24, 0.35);
    backdrop-filter: blur(3px);
  }

  .task-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(600px, calc(100vw - 32px));
    max-height: calc(100vh - 40px);
    overflow: auto;
    padding: 20px;
    border: 1px solid #d8e2d6;
    border-radius: 14px;
    background: #fffefa;
    box-shadow: 0 30px 90px rgba(18, 30, 24, 0.24);
    transform: translate(-50%, -50%);
  }

  .task-modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #7c887f;
    font-size: 0.62rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .close {
    width: 28px;
    height: 28px;
    border: 1px solid #dce3db;
    border-radius: 6px;
    color: #526057;
    background: #f8faf7;
    font-size: 1rem;
    line-height: 1;
  }

  .title-input {
    margin-top: 12px;
    border-color: #d8e2d6;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.4rem;
  }

  .body-input {
    min-height: 130px;
    margin-top: 8px;
    border-color: #d8e2d6;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.76rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
    margin-top: 10px;
  }

  .field-grid label,
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }

  .field-grid span,
  .field span {
    color: #7c887f;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field input,
  .field-grid input,
  .field-grid select {
    border-color: #d8e2d6;
    background: #ffffff;
    font-size: 0.75rem;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 16px;
  }

  .modal-actions > div {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .delete {
    padding: 7px 9px;
    border: 1px solid #e3c6bd;
    border-radius: 6px;
    color: #a6472d;
    background: #fff8f5;
    font-size: 0.7rem;
  }

  .ghost {
    padding: 7px 9px;
    border: 1px solid #dce3db;
    border-radius: 6px;
    color: #526057;
    background: #fffefa;
    font-size: 0.7rem;
  }

  .save {
    padding: 7px 10px;
    border: 1px solid #2f855a;
    border-radius: 6px;
    color: #ffffff;
    background: #2f855a;
    font-size: 0.7rem;
    font-weight: 700;
  }

  @media (max-width: 820px) {
    .todo-app {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }

    .todo-side {
      min-height: auto;
    }

    .side-stat {
      margin: 20px 0;
    }

    .todo-side .new-button {
      margin-top: 16px;
    }

    .todo-main {
      padding: 28px 22px 60px;
    }
  }

  @media (max-width: 620px) {
    .task-list li {
      grid-template-columns: 28px minmax(0, 1fr);
    }

    .task-meta {
      grid-column: 2;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
