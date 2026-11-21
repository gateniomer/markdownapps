<script>
  let { onOpen } = $props();
</script>

<button
  class="menu-button"
  type="button"
  onclick={onOpen}
  aria-label="Open menu"
  title="Open menu"
>
  <span class="menu-lines" aria-hidden="true"><i></i><i></i><i></i></span>
</button>

<style>
  .menu-button {
    position: fixed;
    bottom: max(14px, env(safe-area-inset-bottom));
    left: max(14px, env(safe-area-inset-left));
    z-index: 90;
    display: grid;
    width: 40px;
    height: 40px;
    padding: 0;
    place-items: center;
    border: 1px solid rgba(120, 128, 120, 0.3);
    border-radius: 999px;
    background: rgba(244, 241, 233, 0.86);
    box-shadow: 0 4px 16px rgba(20, 28, 23, 0.1);
    opacity: 0.7;
    backdrop-filter: blur(8px);
    transition: opacity 120ms ease, transform 120ms ease;
  }

  .menu-button:hover {
    opacity: 1;
  }

  .menu-button:active {
    transform: scale(0.95);
  }

  .menu-lines {
    display: flex;
    width: 16px;
    flex-direction: column;
    gap: 3px;
  }

  .menu-lines i {
    display: block;
    height: 2px;
    border-radius: 999px;
    background: #59625b;
  }

  @media (max-width: 640px) {
    .menu-button {
      width: 48px;
      height: 48px;
      opacity: 0.9;
    }

    .menu-lines {
      width: 18px;
    }
  }
</style>
