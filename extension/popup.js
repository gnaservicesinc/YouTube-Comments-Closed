(() => {
  "use strict";

  const MODE_STORAGE_KEY = "ycc-panel-mode";
  const MODE_ALWAYS_CLOSED = "always-closed";
  const MODE_REMEMBER = "remember";
  const form = document.getElementById("settings-form");
  const versionLabel = document.getElementById("version-label");
  const openSettingsButton = document.getElementById("open-settings");
  const saveStatus = document.getElementById("save-status");

  if (versionLabel && globalThis.chrome?.runtime?.getManifest) {
    try {
      const version = chrome.runtime.getManifest()?.version;
      if (version) versionLabel.textContent = version;
    } catch {
      // Keep fallback HTML version.
    }
  }

  function normalizeMode(value) {
    return value === MODE_REMEMBER ? MODE_REMEMBER : MODE_ALWAYS_CLOSED;
  }

  function getSavedMode() {
    try {
      const raw = localStorage.getItem(MODE_STORAGE_KEY);
      return raw === null ? null : normalizeMode(raw);
    } catch {
      return null;
    }
  }

  function saveLocalMode(mode) {
    try {
      localStorage.setItem(MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors in restricted environments.
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

  async function syncInitialMode() {
    const saved = getSavedMode();
    if (saved !== null) {
      applyModeToForm(saved);
      await broadcastMode(saved);
      return;
    }
    if (globalThis.chrome?.tabs?.query) {
      try {
        const tabs = await chrome.tabs.query({});
        for (const tab of tabs) {
          if (typeof tab.id !== "number") continue;
          try {
            const response = await chrome.tabs.sendMessage(tab.id, { type: "ycc-get-mode" });
            if (response?.ok && response.mode) {
              const mode = normalizeMode(response.mode);
              saveLocalMode(mode);
              applyModeToForm(mode);
              return;
            }
          } catch {
            // Ignore non-YouTube tabs.
          }
        }
      } catch {
        // Ignore tab query errors.
      }
    }
    applyModeToForm(MODE_ALWAYS_CLOSED);
  }

  void syncInitialMode();

  form?.addEventListener("change", event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.name !== "panelMode") return;
    const mode = normalizeMode(target.value);
    saveLocalMode(mode);
    void broadcastMode(mode);
    if (saveStatus) {
      saveStatus.textContent = "Setting saved.";
    }
  });

  window.addEventListener("storage", event => {
    if (event.key === MODE_STORAGE_KEY && event.newValue) {
      applyModeToForm(normalizeMode(event.newValue));
    }
  });

  openSettingsButton?.addEventListener("click", () => {
    if (globalThis.chrome?.runtime?.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open("options.html", "_blank", "noopener");
    }
  });
})();
