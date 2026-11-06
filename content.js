// Runs inside WhatsApp Web. It only toggles CSS classes on <html>; content.css does the blurring.
(() => {
  const root = document.documentElement;
  const CLASSES = {
    enabled: "bc-on", messages: "bc-messages", preview: "bc-preview", media: "bc-media",
    gallery: "bc-gallery", input: "bc-input", pics: "bc-pics", names: "bc-names",
    instant: "bc-instant", peek: "bc-peek"
  };

  let settings = { ...BC_DEFAULTS };
  let pausedUntil = 0;       // "show everything" pause, timestamp in ms
  let lastPaused = false;
  let active = false;        // blur is really on (enabled AND not paused)
  let lastActive = Date.now();
  let idleHidden = false;
  let awayHidden = false;

  const isPaused = () => Date.now() < pausedUntil;

  function updateHide() {
    root.classList.toggle("bc-hide", active && (idleHidden || awayHidden));
  }

  function apply() {
    active = !!settings.enabled && !isPaused();
    for (const [key, cls] of Object.entries(CLASSES)) {
      root.classList.toggle(cls, key === "enabled" ? active : !!settings[key]);
    }
    root.style.setProperty("--bc-amount", settings.amount + "px");
    if (!settings.idle) idleHidden = false;
    if (!settings.leave) awayHidden = false;
    updateHide();
    scanSafe();
  }

  // ---------- "never blur" chats ----------
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

  function titleOf(el) {
    if (!el) return "";
    const t = el.getAttribute("title") || (el.querySelector("[title]") || {}).title || el.textContent;
    return (t || "").trim();
  }

  // Name of the chat that is open right now ("" if none)
  function getOpenChatName() {
    const h = document.querySelector("#main header");
    if (!h) return "";
    return titleOf(
      h.querySelector('[data-testid="conversation-info-header-chat-title"]') ||
      h.querySelector('span[dir="auto"][title]') ||
      h.querySelector("span[title]") ||
      h.querySelector('span[dir="auto"]')
    );
  }

  function scanSafe() {
    const safe = new Set((settings.safeChats || []).map(norm).filter(Boolean));
    if (!safe.size && !root.classList.contains("bc-safe-open") && !document.querySelector("[data-bc-safe]")) return;

    // chat list: mark the rows
    document.querySelectorAll('#pane-side [data-testid="cell-frame-title"]').forEach((t) => {
      const row = t.closest('[role="listitem"]') || t.closest('[data-testid="cell-frame-container"]') ||
                  t.closest('[data-testid^="chatlist-message-"]');
      if (!row) return;
      const isSafe = safe.has(norm(titleOf(t)));
      if (isSafe !== row.hasAttribute("data-bc-safe")) {
        if (isSafe) row.setAttribute("data-bc-safe", "1"); else row.removeAttribute("data-bc-safe");
      }
    });

    // open chat
    const open = safe.size > 0 && safe.has(norm(getOpenChatName()));
    if (open !== root.classList.contains("bc-safe-open")) root.classList.toggle("bc-safe-open", open);
  }

  // Runs before the browser paints, so switching chats never flashes the wrong state.
  new MutationObserver(scanSafe).observe(root, {
    childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["title"]
  });

  // ---------- idle / leave ----------
  // Activity just records a time stamp (very cheap). A 1-second check does the rest.
  function onActivity() {
    lastActive = Date.now();
    if (idleHidden) { idleHidden = false; updateHide(); }
  }
  ["mousemove", "mousedown", "keydown", "wheel", "touchstart"].forEach((e) =>
    window.addEventListener(e, onActivity, { passive: true, capture: true })
  );

  setInterval(() => {
    const p = isPaused();
    if (p !== lastPaused) {            // pause just started or ended
      lastPaused = p;
      if (!p) lastActive = Date.now(); // give a fresh idle timer when the pause ends
      apply();
    }
    if (active && settings.idle && !idleHidden &&
        Date.now() - lastActive > settings.idleSeconds * 1000) {
      idleHidden = true;
      updateHide();
    }
  }, 1000);

  window.addEventListener("blur", () => { if (settings.leave) { awayHidden = true; updateHide(); } });
  window.addEventListener("focus", () => { awayHidden = false; lastActive = Date.now(); updateHide(); });

  // ---------- settings ----------
  function load(saved) {
    settings = { ...BC_DEFAULTS, ...(saved || {}) };
    lastPaused = isPaused();
    apply();
  }
  chrome.storage.local.get(["settings", "pausedUntil"], (res) => {
    pausedUntil = res.pausedUntil || 0;
    load(res.settings);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.pausedUntil) pausedUntil = changes.pausedUntil.newValue || 0;
    if (changes.settings) load(changes.settings.newValue); else if (changes.pausedUntil) { lastPaused = isPaused(); apply(); }
  });

  // The popup asks for the open chat's name (for "Add the chat that's open now")
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === "bc-get-open-chat") sendResponse({ name: getOpenChatName() });
  });
})();
