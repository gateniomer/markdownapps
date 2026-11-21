<script>
  let { graph, templateId, openSource } = $props();

  let name = $derived(
    String(templateId || "unknown")
      .replace(/@.*$/, "")
      .replace(/[-_]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
</script>

<div class="missing-app">
  <section class="missing-card">
    <p class="eyebrow">template missing</p>
    <h1>{name}</h1>
    <p class="lead">
      This note is bound to <code>{templateId}</code>, but this markdownapps host does
      not have that template installed.
    </p>

    <div class="actions">
      <button class="primary" onclick={openSource}>Open raw Markdown</button>
    </div>

    <p class="hint">
      Your Markdown is intact and has not been changed. Import the template file
      from the menu, restore the starter templates, or edit
      <code>template:</code> in the frontmatter to use another app.
    </p>

    <div class="raw-preview">
      <div class="raw-head">
        <span>{graph.title}</span>
        <span>read-only preview</span>
      </div>
      <pre>{graph.raw}</pre>
    </div>
  </section>
</div>

<style>
  .missing-app {
    display: grid;
    min-height: 100vh;
    padding: 40px 20px;
    place-items: center;
    color: #1d2420;
    background:
      radial-gradient(circle at 50% 0%, rgba(166, 71, 45, 0.08), transparent 34rem),
      #f4f1e9;
  }

  .missing-card {
    width: min(820px, 100%);
    padding: 34px;
    border: 1px solid #dcd8cc;
    border-radius: 18px;
    background: #fffdf7;
    box-shadow: 0 24px 70px rgba(29, 36, 32, 0.08);
  }

  .eyebrow {
    color: #a6472d;
  }

  h1 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: clamp(2.2rem, 5vw, 3.5rem);
    font-weight: 500;
    letter-spacing: -0.04em;
  }

  .lead {
    max-width: 62ch;
    margin: 12px 0 0;
    color: #5f665f;
    line-height: 1.55;
  }

  code {
    padding: 2px 5px;
    border-radius: 4px;
    background: #eee9dd;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.82em;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 22px;
  }

  .primary {
    padding: 9px 14px;
    border: 1px solid #176b4d;
    border-radius: 999px;
    color: #ffffff;
    background: #176b4d;
    font-size: 0.8rem;
    font-weight: 650;
  }

  .hint {
    margin: 14px 0 0;
    color: #8a8f86;
    font-size: 0.72rem;
  }

  .raw-preview {
    margin-top: 26px;
    overflow: hidden;
    border: 1px solid #e2ddd0;
    border-radius: 10px;
    background: #faf7ef;
  }

  .raw-head {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    padding: 9px 12px;
    border-bottom: 1px solid #e2ddd0;
    color: #7c8279;
    font-size: 0.62rem;
    letter-spacing: 0.07em;
    text-transform: uppercase;
  }

  pre {
    max-height: 340px;
    margin: 0;
    overflow: auto;
    padding: 14px;
    color: #3d463f;
    font-family: "SFMono-Regular", Consolas, monospace;
    font-size: 0.72rem;
    line-height: 1.55;
    white-space: pre-wrap;
  }

  @media (max-width: 620px) {
    .missing-card {
      padding: 22px;
    }
  }
</style>
