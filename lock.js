// Password lock for WhatsApp Web.
// Runs at document_start: the page is hidden straight away and only shown once we know it's allowed.
(() => {
  const root = document.documentElement;
  root.classList.add("bc-locked");

  let cfg = null;            // { hash, salt, iter, mode: "open" | "timeout", timeoutMin }
  let unlocked = false;      // shared between tabs (storage)
  let lastActive = 0;        // shared between tabs (storage)
  let pageUnlocked = false;  // this page was unlocked by typing the password (used by "open" mode)
  let ready = false;
  let ui = null;
  let lastWrite = 0;

  // After the extension is reloaded/updated, an already-open tab keeps an "orphaned" copy of this script.
  // Chrome cuts it off from the extension, so every chrome.* call would throw. We detect that and stop quietly.
  const alive = () => { try { return !!chrome.runtime.id; } catch (e) { return false; } };
  let dead = false;
  function save(obj) {
    if (!alive()) return;
    try { chrome.storage.local.set(obj); } catch (e) { /* extension was reloaded */ }
  }
  function shutdown() {
    if (dead) return;
    dead = true;
    clearInterval(timer);
    ACTIVITY.forEach((e) => window.removeEventListener(e, onActivity, true));
    document.removeEventListener("visibilitychange", evaluate);
    window.removeEventListener("focus", evaluate);
    if (ui) ui.msg.textContent = "BlurryChats was updated. Reload this page (F5).";
  }

  const hasLock = () => !!(cfg && cfg.hash);
  const timeoutMs = () => (cfg && cfg.timeoutMin ? cfg.timeoutMin : 5) * 60000;

  function isLocked() {
    if (!hasLock()) return false;
    if (cfg.mode === "timeout") return !(unlocked && Date.now() - lastActive < timeoutMs());
    return !(pageUnlocked && unlocked); // "open": ask on every page load, and after "Lock now"
  }

  function evaluate() {
    if (!ready || dead) return;
    if (!alive()) { shutdown(); return; }
    if (hasLock() && cfg.mode === "timeout" && unlocked && Date.now() - lastActive >= timeoutMs()) {
      unlocked = false;
      save({ lockUnlocked: false });
    }
    if (isLocked()) showLock(); else hideLock();
  }

  // ---------- the lock screen ----------
  const CSS = `
    .wrap{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;color:#fff;
      background:radial-gradient(circle at 30% 20%,#312e81,#1e1b4b 60%,#0f0d2e);
      font:14px system-ui,-apple-system,"Segoe UI",Arial,sans-serif}
    .card{width:min(340px,90vw);text-align:center;padding:30px 24px 24px;border-radius:18px;
      background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15)}
    svg{width:46px;height:46px;margin-bottom:10px}
    h1{font-size:18px;margin:0 0 4px;font-weight:700}
    p{margin:0 0 18px;color:#c7d2fe;font-size:13px}
    input{width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.25);
      background:rgba(0,0,0,.25);color:#fff;font:inherit;outline:none;text-align:center;letter-spacing:.08em}
    input:focus{border-color:#a5b4fc}
    button{margin-top:12px;width:100%;padding:11px;border:0;border-radius:10px;background:#4f46e5;color:#fff;
      font:inherit;font-weight:600;cursor:pointer}
    button:hover{background:#6366f1}
    .msg{min-height:18px;margin-top:10px;font-size:12px;color:#fca5a5}`;

  function buildUI() {
    const host = document.createElement("div");
    host.style.cssText = "all:initial;position:fixed;inset:0;z-index:2147483647;display:block;";
    const sh = host.attachShadow({ mode: "closed" });
    try { // constructable stylesheet: not affected by WhatsApp's content-security-policy
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      sh.adoptedStyleSheets = [sheet];
    } catch (e) {
      const st = document.createElement("style"); st.textContent = CSS; sh.appendChild(st);
    }
    const wrap = document.createElement("div");
    wrap.className = "wrap";
    wrap.innerHTML =
      '<form class="card" autocomplete="off">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="#c7d2fe" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      '<rect x="4" y="10" width="16" height="11" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>' +
      "<h1>WhatsApp Web is locked</h1><p>Enter your BlurryChats password to continue.</p>" +
      '<input type="password" placeholder="Password" autocomplete="off" spellcheck="false">' +
      '<button type="submit">Unlock</button><div class="msg" role="alert"></div></form>';
    sh.appendChild(wrap);

    const form = wrap.querySelector("form");
    const input = wrap.querySelector("input");
    const msg = wrap.querySelector(".msg");
    let busy = false;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (busy || !input.value) return;
      busy = true;
      msg.textContent = "";
      try {
        const res = await BC_LOCK.attempt(cfg, input.value);
        if (res.ok) {
          pageUnlocked = true; unlocked = true; lastActive = Date.now();
          save({ lockUnlocked: true, lockLastActive: lastActive });
          input.value = "";
          evaluate();
        } else {
          msg.textContent = res.wait ? `Too many wrong tries. Wait ${res.wait} s.` : "Wrong password.";
          input.value = "";
          input.focus();
        }
      } catch (err) {
        msg.textContent = alive() ? "Something went wrong. Try again." : "BlurryChats was updated. Reload this page (F5).";
      }
      busy = false;
    });

    // keep key presses from reaching WhatsApp's own shortcuts
    ["keydown", "keyup", "keypress"].forEach((t) => host.addEventListener(t, (e) => e.stopPropagation()));
    return { host, input, msg };
  }

  // While locked, nothing outside the lock screen may receive keyboard / clipboard / right-click events.
  const TRAPPED = ["keydown", "keypress", "keyup", "paste", "copy", "cut", "contextmenu"];
  function trap(e) {
    if (ui && e.target !== ui.host) { e.stopImmediatePropagation(); e.preventDefault(); }
  }
  function keepFocus(e) {
    if (ui && e.target !== ui.host) ui.input.focus();
  }

  function showLock() {
    root.classList.add("bc-locked");
    if (!ui) {
      ui = buildUI();
      TRAPPED.forEach((t) => window.addEventListener(t, trap, true));
      document.addEventListener("focusin", keepFocus, true);
    }
    if (!ui.host.isConnected) root.appendChild(ui.host);
    if (ui.host.getRootNode() === document && document.activeElement !== ui.host) ui.input.focus();
  }

  function hideLock() {
    root.classList.remove("bc-locked");
    if (!ui) return;
    TRAPPED.forEach((t) => window.removeEventListener(t, trap, true));
    document.removeEventListener("focusin", keepFocus, true);
    ui.host.remove();
    ui = null;
  }

  // ---------- activity (only needed for "lock after being away") ----------
  function onActivity() {
    if (dead) return;
    if (!alive()) { shutdown(); return; }
    if (!ready || !hasLock() || cfg.mode !== "timeout" || isLocked()) return;
    const now = Date.now();
    lastActive = now;
    if (now - lastWrite > 10000) { lastWrite = now; save({ lockLastActive: now }); }
  }
  const ACTIVITY = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"];
  ACTIVITY.forEach((e) => window.addEventListener(e, onActivity, { passive: true, capture: true }));

  const timer = setInterval(evaluate, 2000);
  document.addEventListener("visibilitychange", evaluate);
  window.addEventListener("focus", evaluate);

  // ---------- storage ----------
  chrome.storage.local.get(["lockCfg", "lockUnlocked", "lockLastActive"], (r) => {
    r = r || {};
    cfg = r.lockCfg || null;
    unlocked = !!r.lockUnlocked;
    lastActive = r.lockLastActive || 0;
    ready = true;
    evaluate();
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== "local" || dead) return;
    const wasLocked = ready && isLocked();
    if (ch.lockUnlocked) {
      unlocked = !!ch.lockUnlocked.newValue;
      if (!unlocked) pageUnlocked = false;          // "Lock now" / timeout locks every open tab
    }
    if (ch.lockLastActive) lastActive = ch.lockLastActive.newValue || 0;
    if (ch.lockCfg) {
      const had = hasLock();
      cfg = ch.lockCfg.newValue || null;
      if (!had && hasLock()) { pageUnlocked = true; unlocked = true; } // password just created: stay open
      else if (had && hasLock() && !wasLocked) pageUnlocked = true;      // settings changed: a tab that is open stays open
    }
    evaluate();
  });
})();
