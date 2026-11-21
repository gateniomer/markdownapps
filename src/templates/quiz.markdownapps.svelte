<!--
id: quiz
name: Quiz
description: A question-and-answer review session with scoring.
version: 1
order: 6
permissions:
  - document:read
  - document:write
-->

<script>
  import {
    addSection,
    parseTopicDocument,
    setTopicMeta,
    updateTopic,
  } from "markdownapps/schema/topics";

  const DIFFICULTIES = ["easy", "medium", "hard"];

  let { graph, actions } = $props();
  let index = $state(0);
  let revealed = $state(false);
  let correct = $state(0);
  let answered = $state(0);
  let modalOpen = $state(false);
  let editId = $state("");
  let titleDraft = $state("");
  let answerDraft = $state("");
  let difficultyDraft = $state("medium");
  let bodyDraft = $state("");
  let saving = $state(false);

  let questions = $derived.by(() =>
    parseTopicDocument(graph.raw).topics.map((topic) => ({
      ...topic,
      answer: String(topic.meta?.answer ?? ""),
      difficulty: String(topic.meta?.difficulty ?? "medium").toLowerCase(),
    }))
  );

  let current = $derived(questions[index] ?? null);
  let progress = $derived(questions.length ? Math.min(100, ((index + 1) / questions.length) * 100) : 0);

  function next() {
    if (index < questions.length) {
      index += 1;
      revealed = false;
    }
  }

  async function answer(correctAnswer) {
    if (!current || saving) return;
    saving = true;
    const level = correctAnswer ? "3" : "1";
    await actions.write(setTopicMeta(graph.raw, current.id, "level", level));
    if (correctAnswer) correct += 1;
    answered += 1;
    saving = false;
    next();
  }

  function openNew() {
    modalOpen = true;
    editId = "";
    titleDraft = "";
    answerDraft = "";
    difficultyDraft = "medium";
    bodyDraft = "";
  }

  function openEdit(question) {
    modalOpen = true;
    editId = question.id;
    titleDraft = question.title;
    answerDraft = question.answer;
    difficultyDraft = question.difficulty;
    bodyDraft = question.body || "";
  }

  async function saveQuestion() {
    if (!titleDraft.trim() || !answerDraft.trim() || saving) return;
    saving = true;
    let result;
    if (editId) {
      let nextRaw = graph.raw;
      nextRaw = setTopicMeta(nextRaw, editId, "answer", answerDraft);
      nextRaw = setTopicMeta(nextRaw, editId, "difficulty", difficultyDraft);
      result = updateTopic(nextRaw, editId, { title: titleDraft, body: bodyDraft });
    } else {
      result = addSection(graph.raw, {
        title: titleDraft,
        body: bodyDraft,
        meta: {
          answer: answerDraft,
          difficulty: difficultyDraft,
        },
      });
    }
    const ok = await actions.write(result.source);
    if (ok) modalOpen = false;
    saving = false;
  }

  function handleKey(event) {
    if (modalOpen) {
      if (event.key === "Escape") modalOpen = false;
      return;
    }
    const tag = event.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (event.key === " ") {
      event.preventDefault();
      revealed = true;
    } else if (revealed && event.key === "1") {
      answer(false);
    } else if (revealed && event.key === "2") {
      answer(true);
    }
  }
</script>

<svelte:window onkeydown={handleKey} />

<div class="quiz-app">
  <aside class="quiz-rail">
    <span class="quiz-mark">Q</span>
    <span class="rail-title">{graph.title}</span>
    <div class="rail-score">
      <strong>{correct}</strong>
      <span>correct</span>
    </div>
    <div class="rail-progress">
      <span style={`height:${progress}%`}></span>
    </div>
    <div class="rail-actions">
      <button onclick={openNew} aria-label="New question" title="New question">+</button>
      <button onclick={() => (index = 0, revealed = false, correct = 0, answered = 0)} aria-label="Restart" title="Restart">
        ↺
      </button>
    </div>
  </aside>

  <main class="quiz-main">
    {#if questions.length === 0}
      <div class="quiz-empty">
        <p>No questions yet.</p>
        <button class="new-button" onclick={openNew}>Create the first question</button>
      </div>
    {:else if !current}
      <div class="quiz-complete">
        <p class="eyebrow">session complete</p>
        <h1>{correct} / {answered} correct</h1>
        <div class="complete-actions">
          <button class="new-button" onclick={() => (index = 0, revealed = false, correct = 0, answered = 0)}>
            Restart
          </button>
          <button class="ghost" onclick={openNew}>Add a question</button>
        </div>
      </div>
    {:else}
      <div class="session-meta">
        <span>{index + 1} / {questions.length}</span>
        <span>{current.difficulty}</span>
      </div>

      <section class="question-card">
        <span class="question-label">Question</span>
        <h1>{current.title}</h1>

        {#if !revealed}
          <button class="reveal" onclick={() => (revealed = true)}>Reveal answer <kbd>Space</kbd></button>
        {:else}
          <div class="answer">
            <span class="answer-label">Answer</span>
            <p>{current.answer}</p>
            {#if current.html}
              <div class="explanation">{@html current.html}</div>
            {/if}
          </div>
        {/if}
      </section>

      <div class="quiz-footer">
        <button class="ghost" onclick={() => openEdit(current)}>Edit question</button>
        {#if revealed}
          <div class="grade-row">
            <button class="missed" onclick={() => answer(false)} disabled={saving}>
              Missed <kbd>1</kbd>
            </button>
            <button class="got-it" onclick={() => answer(true)} disabled={saving}>
              Got it <kbd>2</kbd>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </main>

  {#if modalOpen}
    <div class="modal-backdrop" onclick={() => (modalOpen = false)} role="presentation"></div>
    <div class="question-modal" role="dialog" aria-modal="true" aria-label="Question editor">
      <header>
        <span>{editId ? "Edit question" : "New question"}</span>
        <button class="close" onclick={() => (modalOpen = false)} aria-label="Close">×</button>
      </header>

      <label class="field">
        <span>Question</span>
        <textarea class="question-input" bind:value={titleDraft} placeholder="What is a closure?"></textarea>
      </label>

      <label class="field">
        <span>Answer</span>
        <textarea class="answer-input" bind:value={answerDraft} placeholder="A function that keeps its lexical scope."></textarea>
      </label>

      <div class="field-grid">
        <label>
          <span>Difficulty</span>
          <select bind:value={difficultyDraft}>
            {#each DIFFICULTIES as difficulty}
              <option value={difficulty}>{difficulty}</option>
            {/each}
          </select>
        </label>
      </div>

      <label class="field">
        <span>Explanation · Markdown</span>
        <textarea class="body-input" bind:value={bodyDraft} placeholder="Optional explanation…"></textarea>
      </label>

      <div class="modal-actions">
        <button class="ghost" onclick={() => (modalOpen = false)}>Cancel</button>
        <button
          class="new-button"
          onclick={saveQuestion}
          disabled={saving || !titleDraft.trim() || !answerDraft.trim()}
        >
          {saving ? "Saving…" : editId ? "Save question" : "Create question"}
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .quiz-app {
    display: grid;
    grid-template-columns: 86px minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    color: #ede9ff;
    background:
      radial-gradient(circle at 50% 0%, rgba(139, 108, 255, 0.16), transparent 36rem),
      #151225;
  }

  .quiz-rail {
    display: flex;
    align-items: center;
    flex-direction: column;
    padding: 18px 0;
    border-right: 1px solid rgba(237, 233, 255, 0.1);
    background: rgba(9, 7, 18, 0.35);
  }

  .quiz-mark {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 9px;
    color: #151225;
    background: #ffd166;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1rem;
    font-weight: 700;
  }

  .rail-title {
    max-height: 150px;
    margin-top: 16px;
    overflow: hidden;
    color: #7c7398;
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    text-overflow: ellipsis;
    text-transform: uppercase;
    writing-mode: vertical-rl;
    transform: rotate(180deg);
  }

  .rail-score {
    display: flex;
    align-items: center;
    flex-direction: column;
    margin-top: 16px;
  }

  .rail-score strong {
    color: #f7f4ff;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.5rem;
    font-weight: 500;
  }

  .rail-score span {
    color: #756d91;
    font-size: 0.54rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .rail-progress {
    display: flex;
    align-items: flex-end;
    width: 3px;
    flex: 1;
    margin: 22px 0;
    overflow: hidden;
    border-radius: 999px;
    background: rgba(255, 255, 255, 0.08);
  }

  .rail-progress span {
    width: 100%;
    border-radius: inherit;
    background: #8b6cff;
    transition: height 180ms ease;
  }

  .rail-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .rail-actions button {
    width: 32px;
    height: 32px;
    border: 1px solid rgba(237, 233, 255, 0.13);
    border-radius: 7px;
    color: #bdb5d5;
    background: transparent;
    font-size: 0.9rem;
    line-height: 1;
  }

  .rail-actions button:hover {
    border-color: #ffd166;
    color: #ffd166;
  }

  .ghost {
    padding: 7px 9px;
    border: 1px solid rgba(237, 233, 255, 0.14);
    border-radius: 6px;
    color: #bdb5d5;
    background: transparent;
    font-size: 0.68rem;
  }

  .new-button {
    padding: 7px 10px;
    border: 1px solid #ffd166;
    border-radius: 6px;
    color: #151225;
    background: #ffd166;
    font-size: 0.68rem;
    font-weight: 750;
  }

  .quiz-main {
    display: flex;
    align-items: center;
    flex-direction: column;
    justify-content: center;
    width: min(760px, calc(100% - 48px));
    height: 100vh;
    margin: 0 auto;
    overflow: auto;
    padding: 48px 0;
  }

  .session-meta {
    display: flex;
    justify-content: space-between;
    width: 100%;
    color: #756d91;
    font-size: 0.62rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .question-card {
    width: 100%;
    min-height: 360px;
    margin-top: 24px;
    padding: 40px;
    border: 1px solid rgba(237, 233, 255, 0.12);
    border-radius: 20px;
    background:
      linear-gradient(150deg, rgba(255, 209, 102, 0.04), transparent 40%),
      #1c1832;
    box-shadow: 0 30px 80px rgba(0, 0, 0, 0.26);
  }

  .question-label,
  .answer-label {
    color: #756d91;
    font-size: 0.6rem;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  h1 {
    margin: 18px 0 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(1.9rem, 4vw, 3rem);
    font-weight: 500;
    letter-spacing: -0.03em;
    line-height: 1.12;
  }

  .reveal {
    margin-top: 34px;
    padding: 9px 13px;
    border: 1px solid rgba(255, 209, 102, 0.4);
    border-radius: 8px;
    color: #ffd166;
    background: rgba(255, 209, 102, 0.06);
    font-size: 0.74rem;
  }

  .reveal kbd,
  .grade-row kbd {
    margin-left: 5px;
    padding: 2px 4px;
    border: 1px solid currentColor;
    border-radius: 4px;
    font-size: 0.55rem;
    opacity: 0.7;
  }

  .answer {
    margin-top: 30px;
    padding-top: 20px;
    border-top: 1px solid rgba(237, 233, 255, 0.12);
  }

  .answer p {
    margin: 10px 0 0;
    color: #f7f4ff;
    font-size: 1.04rem;
    line-height: 1.55;
  }

  .explanation {
    margin-top: 18px;
    color: #b6adcf;
    font-size: 0.84rem;
    line-height: 1.55;
  }

  .quiz-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    width: 100%;
    margin-top: 14px;
  }

  .grade-row {
    display: flex;
    gap: 7px;
  }

  .missed,
  .got-it {
    padding: 8px 12px;
    border-radius: 7px;
    font-size: 0.7rem;
    font-weight: 650;
  }

  .missed {
    border: 1px solid rgba(255, 139, 115, 0.4);
    color: #ff9c87;
    background: transparent;
  }

  .got-it {
    border: 1px solid #58d68d;
    color: #102019;
    background: #58d68d;
  }

  .quiz-empty,
  .quiz-complete {
    display: grid;
    min-height: 60vh;
    place-content: center;
    justify-items: center;
    gap: 14px;
    color: #8e86a8;
  }

  .quiz-complete h1 {
    color: #f7f4ff;
  }

  .complete-actions {
    display: flex;
    gap: 7px;
  }

  .eyebrow {
    color: #ffd166;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(5, 4, 12, 0.68);
    backdrop-filter: blur(4px);
  }

  .question-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(620px, calc(100vw - 32px));
    max-height: calc(100vh - 40px);
    overflow: auto;
    padding: 20px;
    border: 1px solid rgba(237, 233, 255, 0.14);
    border-radius: 14px;
    color: #ede9ff;
    background: #1c1832;
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
  }

  .question-modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #8e86a8;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .close {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(237, 233, 255, 0.12);
    border-radius: 6px;
    color: #bdb5d5;
    background: rgba(255, 255, 255, 0.04);
    font-size: 1rem;
    line-height: 1;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 12px;
  }

  .field span {
    color: #8e86a8;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .field textarea,
  .field-grid select {
    border-color: rgba(237, 233, 255, 0.12);
    color: #ede9ff;
    background: rgba(255, 255, 255, 0.04);
    font-size: 0.76rem;
  }

  .question-input,
  .answer-input {
    min-height: 80px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1rem;
  }

  .body-input {
    min-height: 120px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.74rem;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 8px;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 7px;
    margin-top: 18px;
  }

  @media (max-width: 620px) {
    .quiz-app {
      grid-template-columns: 56px minmax(0, 1fr);
    }

    .quiz-rail {
      padding: 12px 0;
    }

    .quiz-mark {
      width: 28px;
      height: 28px;
      font-size: 0.8rem;
    }

    .rail-score {
      margin-top: 18px;
    }

    .rail-score strong {
      font-size: 1.1rem;
    }

    .quiz-main {
      width: calc(100% - 28px);
      padding: 28px 0;
    }

    .question-card {
      min-height: 300px;
      padding: 26px 20px;
    }

    .quiz-footer {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
