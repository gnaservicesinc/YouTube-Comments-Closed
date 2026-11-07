(() => {
  "use strict";

  const MODE_STORAGE_KEY = "ycc-panel-mode";
  const MODE_ALWAYS_CLOSED = "always-closed";
  const MODE_REMEMBER = "remember";
  const form = document.getElementById("settings-form");

  function normalizeMode(value) {
    return value === MODE_REMEMBER ? MODE_REMEMBER : MODE_ALWAYS_CLOSED;
  }

  function getSavedMode() {
    try {
      return normalizeMode(localStorage.getItem(MODE_STORAGE_KEY));
    } catch {
      return MODE_ALWAYS_CLOSED;
    }
  }

  function applyModeToForm(mode) {
    const input = form?.querySelector(`input[name="panelMode"][value="${mode}"]`);
    if (input instanceof HTMLInputElement) input.checked = true;
  }

  async function broadcastMode(mode) {
    if (!globalThis.chrome?.tabs?.query) return;
    try {
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        if (typeof tab.id !== "number") continue;
        try {
          await chrome.tabs.sendMessage(tab.id, { type: "ycc-set-mode", mode });
        } catch {
          // Non-YouTube tabs do not run the content script; ignore.
        }
      }
    } catch {
      // Ignore tab query errors in restricted environments.
    }
  }

  const initialMode = getSavedMode();
  applyModeToForm(initialMode);
  void broadcastMode(initialMode);

  form?.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "panelMode") return;
    const mode = normalizeMode(target.value);
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted environments.
    }
    void broadcastMode(mode);
  });
})();
