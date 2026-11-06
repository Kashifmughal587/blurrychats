const CHIPS = [
  ["messages", "Messages"], ["preview", "Chat previews"], ["media", "Photos & videos"],
  ["gallery", "Full-screen viewer"], ["input", "Typing box"], ["pics", "Profile pictures"], ["names", "Names"]
];
const $ = (id) => document.getElementById(id);
const store = chrome.storage.local;

// Build the chips
$("chips").innerHTML = CHIPS.map(([key, label]) =>
  `<label class="chip"><input type="checkbox" data-key="${key}"><span>${label}</span></label>`).join("");

const controls = document.querySelectorAll("[data-key]");
const amountOut = $("amountOut");
let current = { ...BC_DEFAULTS };

async function save(key, value) {
  const { settings = {} } = await store.get("settings");
  await store.set({ settings: { ...BC_DEFAULTS, ...settings, [key]: value } });
}

function show(settings) {
  current = settings;
  controls.forEach((el) => {
    const v = settings[el.dataset.key];
    if (el.type === "checkbox") el.checked = !!v; else el.value = v;
  });
  amountOut.textContent = settings.amount + " px";
  renderSafe();
}

controls.forEach((el) => {
  el.addEventListener(el.type === "range" ? "input" : "change", () => {
    const value = el.type === "checkbox" ? el.checked : Number(el.value);
    if (el.id === "amount") amountOut.textContent = value + " px";
    save(el.dataset.key, value);
  });
});

/* ================= Pause ================= */
let pausedUntil = 0;

function renderPause() {
  const left = pausedUntil - Date.now();
  const on = left > 0;
  $("pauseRow").classList.toggle("on", on);
  $("pauseMinutes").hidden = on;
  $("pauseBtn").textContent = on ? "Resume" : "Pause";
  if (on) {
    const s = Math.ceil(left / 1000);
    $("pauseLabel").textContent = `Showing all · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} left`;
  } else {
    $("pauseLabel").textContent = "Show all for";
  }
}
$("pauseBtn").addEventListener("click", () => {
  const on = pausedUntil > Date.now();
  store.set({ pausedUntil: on ? 0 : Date.now() + Number($("pauseMinutes").value) * 60000 });
});
setInterval(renderPause, 500);

/* ================= Never-blur chats ================= */
const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase();

function safeHint(text, cls) {
  const h = $("safeHint");
  h.textContent = text || "";
  h.className = "hint" + (cls ? " " + cls : "");
}

function renderSafe() {
  const list = current.safeChats || [];
  $("safeCount").textContent = list.length ? `(${list.length})` : "";
  const ul = $("safeList");
  ul.textContent = "";
  list.forEach((name, i) => {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = name; span.title = name;
    const x = document.createElement("button");
    x.type = "button"; x.textContent = "×"; x.title = "Remove";
    x.addEventListener("click", () => save("safeChats", list.filter((_, j) => j !== i)));
    li.append(span, x);
    ul.appendChild(li);
  });
  if (!list.length && !$("safeHint").textContent) {
    safeHint("Chats on this list are never blurred. Names must match the chat name exactly (capitals don't matter).");
  }
}

function addSafe(name) {
  name = (name || "").replace(/\s+/g, " ").trim();
  if (!name) return;
  const list = current.safeChats || [];
  if (list.some((n) => norm(n) === norm(name))) return safeHint(`"${name}" is already on the list.`, "err");
  save("safeChats", [...list, name]);
  safeHint(`Added "${name}".`, "ok");
}

$("addOpen").addEventListener("click", async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const res = await chrome.tabs.sendMessage(tab.id, { type: "bc-get-open-chat" });
    if (res && res.name) addSafe(res.name);
    else safeHint("No chat is open. Click a chat in WhatsApp Web first.", "err");
  } catch (e) {
    safeHint("Open WhatsApp Web in this tab first (reload it once if you just updated the extension).", "err");
  }
});
$("safeAdd").addEventListener("click", () => { addSafe($("safeName").value); $("safeName").value = ""; });
$("safeName").addEventListener("keydown", (e) => { if (e.key === "Enter") $("safeAdd").click(); });

/* ================= Password lock ================= */
let lockCfg = null;
const hasLock = () => !!(lockCfg && lockCfg.hash);

function lockMsg(text, cls) {
  $("lockMsg").textContent = text || "";
  $("lockMsg").className = "hint" + (cls ? " " + cls : "");
}

function syncMinsRow() { $("minsRow").hidden = $("lockMode").value !== "timeout"; }
// Mode and timer save as soon as you change them (the password is only needed to change or remove the password itself)
async function autoSaveLock() {
  if (!hasLock()) return;
  await store.set({
    lockCfg: { ...lockCfg, mode: $("lockMode").value, timeoutMin: Number($("lockMins").value) },
    lockLastActive: Date.now()
  });
  lockMsg("Saved.", "ok");
}
$("lockMode").addEventListener("change", () => { syncMinsRow(); autoSaveLock(); });
$("lockMins").addEventListener("change", autoSaveLock);

function renderLock() {
  const on = hasLock();
  $("lockStatus").textContent = on ? "(on)" : "";
  $("lockOff").hidden = on;
  $("lockOn").hidden = !on;
  $("lockOnBtns").hidden = !on;
  if (on) {
    $("lockMode").value = lockCfg.mode || "open";
    $("lockMins").value = String(lockCfg.timeoutMin || 5);
  }
  syncMinsRow();
}

// Checks the "current password" box; returns true if it is right
async function checkCurrent() {
  const pw = $("pwCur").value;
  if (!pw) { lockMsg("Type your current password first.", "err"); return false; }
  const res = await BC_LOCK.attempt(lockCfg, pw);
  if (res.ok) return true;
  lockMsg(res.wait ? `Too many wrong tries. Wait ${res.wait} s.` : "Current password is wrong.", "err");
  return false;
}

// Checks the two "new password" boxes; returns the password or null
function readNew() {
  const a = $("pwNew").value, b = $("pwNew2").value;
  if (a.length < 4) { lockMsg("Use at least 4 characters.", "err"); return null; }
  if (a !== b) { lockMsg("The two passwords don't match.", "err"); return null; }
  return a;
}
function clearBoxes() { ["pwCur", "pwNew", "pwNew2"].forEach((id) => ($(id).value = "")); }

$("lockTurnOn").addEventListener("click", async () => {
  const pw = readNew();
  if (!pw) return;
  const rec = await BC_LOCK.create(pw);
  await store.set({
    lockCfg: { ...rec, mode: $("lockMode").value, timeoutMin: Number($("lockMins").value) },
    lockUnlocked: true, lockLastActive: Date.now(), lockFails: 0, lockBlockedUntil: 0
  });
  clearBoxes();
  lockMsg("Password lock is on. WhatsApp Web stays open now and locks next time.", "ok");
});

$("lockNow").addEventListener("click", async () => {
  await store.set({ lockUnlocked: false });
  lockMsg("Locked.", "ok");
});

$("lockChange").addEventListener("click", async () => {
  if (!(await checkCurrent())) return;
  const pw = readNew();
  if (!pw) return;
  const rec = await BC_LOCK.create(pw);
  await store.set({ lockCfg: { ...lockCfg, ...rec } });
  clearBoxes();
  lockMsg("Password changed.", "ok");
});

$("lockRemove").addEventListener("click", async () => {
  if (!(await checkCurrent())) return;
  await store.remove(["lockCfg", "lockUnlocked", "lockLastActive", "lockFails", "lockBlockedUntil"]);
  clearBoxes();
  lockMsg("Password lock removed.", "ok");
});

/* ================= load + live updates ================= */
store.get(["settings", "pausedUntil", "lockCfg"], (res) => {
  pausedUntil = res.pausedUntil || 0;
  lockCfg = res.lockCfg || null;
  show({ ...BC_DEFAULTS, ...(res.settings || {}) });
  renderPause();
  renderLock();
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area !== "local") return;
  if (c.settings) show({ ...BC_DEFAULTS, ...c.settings.newValue }); // keeps switches right when a shortcut is used
  if (c.pausedUntil) { pausedUntil = c.pausedUntil.newValue || 0; renderPause(); }
  if (c.lockCfg) { lockCfg = c.lockCfg.newValue || null; renderLock(); }
});
