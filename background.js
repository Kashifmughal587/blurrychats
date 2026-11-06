importScripts("defaults.js");

const store = chrome.storage.local;

chrome.commands.onCommand.addListener(async (command) => {
  // Alt+Shift+B: turn BlurryChats on/off
  if (command === "toggle-blur") {
    const { settings = {} } = await store.get("settings");
    const current = { ...BC_DEFAULTS, ...settings };
    await store.set({ settings: { ...current, enabled: !current.enabled } });
  }

  // Alt+Shift+P: show everything for a while / resume
  if (command === "pause-blur") {
    const { pausedUntil = 0, settings = {} } = await store.get(["pausedUntil", "settings"]);
    if (pausedUntil > Date.now()) {
      await store.set({ pausedUntil: 0 });
    } else {
      const minutes = { ...BC_DEFAULTS, ...settings }.pauseMinutes || 1;
      await store.set({ pausedUntil: Date.now() + minutes * 60000 });
    }
  }

  // Alt+Shift+L: lock WhatsApp Web now
  if (command === "lock-now") {
    const { lockCfg } = await store.get("lockCfg");
    if (lockCfg && lockCfg.hash) await store.set({ lockUnlocked: false });
  }
});

// A new browser session always starts locked
chrome.runtime.onStartup.addListener(() => store.set({ lockUnlocked: false }));
