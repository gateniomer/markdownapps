<script>
  let { template, graph, actions } = $props();
</script>

{#if template.View}
  {@const View = template.View}
  <View {graph} {actions} />
{:else}
  <div class="template-error">
    <h1>Template not available</h1>
    <p>
      <code>{template.id}</code> could not be loaded.
      {#if template.error}
        {template.error}
      {:else}
        Open the hub to reinstall it.
      {/if}
    </p>
  </div>
{/if}

<style>
  .template-error {
    display: grid;
    min-height: 100vh;
    padding: 40px;
    place-content: center;
    color: #7d2c19;
    background: #f7e4dc;
    text-align: center;
  }

  .template-error h1 {
    margin: 0;
    font-family: Georgia, "Times New Roman", serif;
    font-size: 2rem;
    font-weight: 500;
  }

  .template-error p {
    margin: 10px 0 0;
  }
</style>
