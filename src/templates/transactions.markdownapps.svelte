<!--
id: transactions
name: Transactions
description: A finance ledger with income, expenses, and categories.
version: 1
order: 5
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

  let { graph, actions } = $props();
  let filter = $state("all");
  let query = $state("");
  let modalOpen = $state(false);
  let editId = $state("");
  let titleDraft = $state("");
  let amountDraft = $state("");
  let typeDraft = $state("expense");
  let categoryDraft = $state("");
  let accountDraft = $state("");
  let dateDraft = $state("");
  let bodyDraft = $state("");
  let saving = $state(false);

  let currency = $derived(graph.frontmatter?.currency || "USD");

  let transactions = $derived.by(() =>
    parseTopicDocument(graph.raw).topics.map((topic) => ({
      ...topic,
      amount: Number(topic.meta?.amount ?? 0),
      category: String(topic.meta?.category ?? "Uncategorized"),
      account: String(topic.meta?.account ?? ""),
      date: String(topic.meta?.date ?? ""),
    }))
  );

  let income = $derived(transactions.filter((item) => item.amount > 0).reduce((sum, item) => sum + item.amount, 0));
  let expenses = $derived(transactions.filter((item) => item.amount < 0).reduce((sum, item) => sum + item.amount, 0));
  let balance = $derived(income + expenses);

  let visible = $derived.by(() =>
    transactions
      .filter((item) => {
        if (filter === "income" && item.amount <= 0) return false;
        if (filter === "expense" && item.amount >= 0) return false;
        const needle = query.trim().toLowerCase();
        if (!needle) return true;
        return [item.title, item.category, item.account].join(" ").toLowerCase().includes(needle);
      })
      .sort((a, b) => (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title))
  );

  function formatMoney(value) {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  }

  function openNew() {
    modalOpen = true;
    editId = "";
    titleDraft = "";
    amountDraft = "";
    typeDraft = "expense";
    categoryDraft = "";
    accountDraft = "";
    dateDraft = new Date().toISOString().slice(0, 10);
    bodyDraft = "";
  }

  function openEdit(item) {
    modalOpen = true;
    editId = item.id;
    titleDraft = item.title;
    amountDraft = String(Math.abs(item.amount));
    typeDraft = item.amount >= 0 ? "income" : "expense";
    categoryDraft = item.category === "Uncategorized" ? "" : item.category;
    accountDraft = item.account;
    dateDraft = item.date;
    bodyDraft = item.body || "";
  }

  async function saveTransaction() {
    if (!titleDraft.trim() || !amountDraft || saving) return;
    saving = true;
    const magnitude = Math.abs(Number(amountDraft));
    const amount = typeDraft === "income" ? magnitude : -magnitude;
    let result;
    if (editId) {
      let next = graph.raw;
      next = setTopicMeta(next, editId, "amount", String(amount));
      next = setTopicMeta(next, editId, "category", categoryDraft);
      next = setTopicMeta(next, editId, "account", accountDraft);
      next = setTopicMeta(next, editId, "date", dateDraft);
      result = updateTopic(next, editId, { title: titleDraft, body: bodyDraft });
    } else {
      result = addSection(graph.raw, {
        title: titleDraft,
        body: bodyDraft,
        meta: {
          amount: String(amount),
          category: categoryDraft,
          account: accountDraft,
          date: dateDraft,
        },
      });
    }
    const ok = await actions.write(result.source);
    if (ok) modalOpen = false;
    saving = false;
  }

  async function removeTransaction() {
    if (!editId || saving) return;
    saving = true;
    const ok = await actions.write(removeSection(graph.raw, editId));
    if (ok) modalOpen = false;
    saving = false;
  }
</script>

<div class="transactions-app">
  <aside class="tx-side">
    <div class="tx-brand">
      <span class="tx-mark">$</span>
      <div>
        <strong>{graph.title}</strong>
        <span>{transactions.length} transactions</span>
      </div>
    </div>

    <div class="balance-block">
      <span>Balance</span>
      <strong>{formatMoney(balance)}</strong>
    </div>

    <div class="side-stats">
      <div>
        <span>Income</span>
        <strong class="income">{formatMoney(income)}</strong>
      </div>
      <div>
        <span>Expenses</span>
        <strong class="expense">{formatMoney(expenses)}</strong>
      </div>
    </div>

    <button class="new-button" onclick={openNew}>+ New transaction</button>
  </aside>

  <main class="tx-main">
    <header class="ledger-head">
      <div>
        <p class="eyebrow">ledger</p>
        <h1>Transactions</h1>
      </div>
      <div class="filters">
        <button class:active={filter === "all"} onclick={() => (filter = "all")}>All</button>
        <button class:active={filter === "income"} onclick={() => (filter = "income")}>Income</button>
        <button class:active={filter === "expense"} onclick={() => (filter = "expense")}>Expenses</button>
      </div>
    </header>

    <div class="tx-toolbar">
      <input bind:value={query} placeholder="Search merchant, category, account…" />
    </div>

    {#if transactions.length === 0}
      <div class="empty">
        <p>No transactions yet.</p>
        <button class="new-button" onclick={openNew}>Add the first transaction</button>
      </div>
    {:else}
      <div class="tx-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th>Account</th>
              <th class="amount-col">Amount</th>
            </tr>
          </thead>
          <tbody>
            {#each visible as item (item.id)}
              <tr onclick={() => openEdit(item)}>
                <td class="date">{item.date || "—"}</td>
                <td><strong>{item.title}</strong></td>
                <td><span class="category">{item.category}</span></td>
                <td>{item.account || "—"}</td>
                <td class:positive={item.amount > 0} class:negative={item.amount < 0} class="amount-col">
                  {formatMoney(item.amount)}
                </td>
              </tr>
            {:else}
              <tr><td colspan="5" class="no-results">No matching transactions.</td></tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </main>

  {#if modalOpen}
    <div class="modal-backdrop" onclick={() => (modalOpen = false)} role="presentation"></div>
    <div class="tx-modal" role="dialog" aria-modal="true" aria-label="Transaction editor">
      <header>
        <span>{editId ? "Edit transaction" : "New transaction"}</span>
        <button class="close" onclick={() => (modalOpen = false)} aria-label="Close">×</button>
      </header>

      <input class="title-input" bind:value={titleDraft} placeholder="Merchant or description" />

      <div class="field-grid">
        <label>
          <span>Type</span>
          <select bind:value={typeDraft}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </label>
        <label>
          <span>Amount</span>
          <input type="number" min="0" step="0.01" bind:value={amountDraft} placeholder="0.00" />
        </label>
      </div>

      <div class="field-grid">
        <label>
          <span>Date</span>
          <input type="date" bind:value={dateDraft} />
        </label>
        <label>
          <span>Category</span>
          <input bind:value={categoryDraft} placeholder="Food" />
        </label>
      </div>

      <label class="field">
        <span>Account</span>
        <input bind:value={accountDraft} placeholder="Checking" />
      </label>

      <label class="field">
        <span>Notes</span>
        <textarea class="body-input" bind:value={bodyDraft} placeholder="Optional notes…"></textarea>
      </label>

      <div class="modal-actions">
        {#if editId}
          <button class="delete" onclick={removeTransaction} disabled={saving}>Delete</button>
        {/if}
        <div>
          <button class="ghost" onclick={() => (modalOpen = false)}>Cancel</button>
          <button class="save" onclick={saveTransaction} disabled={saving || !titleDraft.trim() || !amountDraft}>
            {saving ? "Saving…" : editId ? "Save" : "Add transaction"}
          </button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .transactions-app {
    display: grid;
    grid-template-columns: 310px minmax(0, 1fr);
    height: 100vh;
    overflow: hidden;
    color: #e8eef4;
    background: #0d1520;
  }

  .tx-side {
    display: flex;
    flex-direction: column;
    padding: 24px 22px;
    background:
      radial-gradient(circle at 20% 0%, rgba(56, 189, 248, 0.1), transparent 28rem),
      #08111b;
  }

  .tx-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .tx-mark {
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    border-radius: 9px;
    color: #0d1520;
    background: #58d68d;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.85rem;
    font-weight: 800;
  }

  .tx-brand div {
    display: flex;
    flex-direction: column;
  }

  .tx-brand strong {
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.3rem;
    font-weight: 500;
  }

  .tx-brand span {
    color: #7f91a4;
    font-size: 0.66rem;
  }

  .new-button {
    padding: 8px 12px;
    border: 1px solid #58d68d;
    border-radius: 7px;
    color: #0d1520;
    background: #58d68d;
    font-size: 0.72rem;
    font-weight: 750;
  }

  .tx-side .new-button {
    margin-top: auto;
  }

  .balance-block {
    display: flex;
    flex-direction: column;
    margin: 36px 0 24px;
  }

  .balance-block span,
  .side-stats span {
    color: #7f91a4;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .balance-block strong {
    margin-top: 6px;
    color: #f2f7fb;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 2rem;
    font-weight: 600;
    letter-spacing: -0.04em;
  }

  .side-stats {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 16px;
    border-top: 1px solid rgba(232, 238, 244, 0.1);
  }

  .side-stats div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .side-stats strong {
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 1rem;
    font-weight: 600;
  }

  .side-stats .income {
    color: #58d68d;
  }

  .side-stats .expense {
    color: #ff8b73;
  }

  .tx-main {
    overflow: auto;
    padding: 30px max(28px, 4vw) 60px;
  }

  .ledger-head {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 20px;
    max-width: 980px;
    margin: 0 auto;
    padding-bottom: 16px;
    border-bottom: 1px solid rgba(232, 238, 244, 0.1);
  }

  .eyebrow {
    color: #58d68d;
  }

  .ledger-head h1 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 2.2rem;
    font-weight: 500;
    letter-spacing: -0.035em;
  }

  .tx-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 14px;
    max-width: 980px;
    margin: 16px auto 10px;
  }

  .tx-toolbar input {
    max-width: 340px;
    border-color: rgba(232, 238, 244, 0.12);
    color: #e8eef4;
    background: rgba(255, 255, 255, 0.04);
    font-size: 0.74rem;
  }

  .tx-toolbar input::placeholder {
    color: #6b7e92;
  }

  .filters {
    display: flex;
    gap: 4px;
  }

  .filters button {
    padding: 6px 10px;
    border: 1px solid rgba(232, 238, 244, 0.12);
    border-radius: 999px;
    color: #8fa2b5;
    background: transparent;
    font-size: 0.67rem;
  }

  .filters button.active {
    border-color: #58d68d;
    color: #0d1520;
    background: #58d68d;
  }

  .tx-table-wrap {
    max-width: 980px;
    margin: 0 auto;
    overflow: auto;
    border: 1px solid rgba(232, 238, 244, 0.12);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.025);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.78rem;
  }

  th,
  td {
    padding: 10px 12px;
    border-bottom: 1px solid rgba(232, 238, 244, 0.08);
    text-align: left;
    white-space: nowrap;
  }

  th {
    color: #7f91a4;
    background: rgba(255, 255, 255, 0.03);
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.58rem;
    font-weight: 700;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  tbody tr {
    cursor: pointer;
  }

  tbody tr:hover {
    background: rgba(255, 255, 255, 0.04);
  }

  tbody tr:last-child td {
    border-bottom: 0;
  }

  .date {
    color: #8fa2b5;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.68rem;
  }

  .category {
    padding: 3px 7px;
    border-radius: 999px;
    color: #a9bacb;
    background: rgba(255, 255, 255, 0.06);
    font-size: 0.65rem;
  }

  .amount-col {
    text-align: right;
  }

  .positive {
    color: #58d68d;
  }

  .negative {
    color: #ff9c87;
  }

  .no-results {
    padding: 26px;
    color: #7f91a4;
    text-align: center;
  }

  .empty {
    display: grid;
    min-height: 300px;
    place-content: center;
    justify-items: center;
    gap: 12px;
    color: #8fa2b5;
  }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: rgba(3, 8, 14, 0.62);
    backdrop-filter: blur(3px);
  }

  .tx-modal {
    position: fixed;
    top: 50%;
    left: 50%;
    z-index: 21;
    display: flex;
    flex-direction: column;
    width: min(580px, calc(100vw - 32px));
    max-height: calc(100vh - 40px);
    overflow: auto;
    padding: 20px;
    border: 1px solid rgba(232, 238, 244, 0.14);
    border-radius: 14px;
    color: #e8eef4;
    background: #111c29;
    box-shadow: 0 30px 90px rgba(0, 0, 0, 0.5);
    transform: translate(-50%, -50%);
  }

  .tx-modal header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    color: #7f91a4;
    font-size: 0.6rem;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .close {
    width: 28px;
    height: 28px;
    border: 1px solid rgba(232, 238, 244, 0.12);
    border-radius: 6px;
    color: #a9bacb;
    background: rgba(255, 255, 255, 0.04);
    font-size: 1rem;
    line-height: 1;
  }

  .title-input,
  .body-input,
  .field input,
  .field-grid input,
  .field-grid select {
    border-color: rgba(232, 238, 244, 0.12);
    color: #e8eef4;
    background: rgba(255, 255, 255, 0.04);
  }

  .title-input {
    margin-top: 12px;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 1.4rem;
  }

  .body-input {
    min-height: 90px;
    margin-top: 10px;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.74rem;
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
    color: #7f91a4;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .modal-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    margin-top: 18px;
  }

  .modal-actions > div {
    display: flex;
    gap: 6px;
    margin-left: auto;
  }

  .delete {
    padding: 7px 9px;
    border: 1px solid rgba(255, 139, 115, 0.35);
    border-radius: 6px;
    color: #ff9c87;
    background: transparent;
    font-size: 0.68rem;
  }

  .ghost {
    padding: 7px 9px;
    border: 1px solid rgba(232, 238, 244, 0.14);
    border-radius: 6px;
    color: #b8c7d6;
    background: transparent;
    font-size: 0.68rem;
  }

  .save {
    padding: 7px 10px;
    border: 1px solid #58d68d;
    border-radius: 6px;
    color: #0d1520;
    background: #58d68d;
    font-size: 0.68rem;
    font-weight: 750;
  }

  @media (max-width: 900px) {
    .transactions-app {
      grid-template-columns: 1fr;
      height: auto;
      min-height: 100vh;
      overflow: visible;
    }

    .tx-side {
      min-height: auto;
    }

    .balance-block {
      margin: 22px 0 16px;
    }

    .tx-side .new-button {
      margin-top: 16px;
    }

    .tx-main {
      padding: 24px 22px 60px;
    }
  }

  @media (max-width: 700px) {
    .ledger-head {
      align-items: flex-start;
      flex-direction: column;
    }

    .tx-toolbar input {
      max-width: none;
    }

    .field-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
