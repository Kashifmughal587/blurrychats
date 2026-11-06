// Password helpers shared by lock.js (WhatsApp page) and popup.js.
// The password itself is never stored - only a salted PBKDF2 hash.
var BC_LOCK = (() => {
  const ITER = 200000;
  const enc = new TextEncoder();
  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function derive(password, salt, iter) {
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: iter }, key, 256);
  }

  // -> { salt, hash, iter }
  async function create(password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    return { salt: toB64(salt), hash: toB64(await derive(password, salt, ITER)), iter: ITER };
  }

  async function verify(cfg, password) {
    if (!cfg || !cfg.hash) return false;
    const got = toB64(await derive(password, fromB64(cfg.salt), cfg.iter || ITER));
    let diff = got.length ^ cfg.hash.length;
    for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ (cfg.hash.charCodeAt(i) || 0);
    return diff === 0;
  }

  // Checks a password and enforces a cool-down after repeated mistakes (kept in storage, so a reload doesn't reset it).
  // -> { ok, wait }   wait = seconds to wait before trying again
  async function attempt(cfg, password) {
    const s = await chrome.storage.local.get(["lockFails", "lockBlockedUntil"]);
    const now = Date.now();
    if ((s.lockBlockedUntil || 0) > now) return { ok: false, wait: Math.ceil((s.lockBlockedUntil - now) / 1000) };
    if (await verify(cfg, password)) {
      await chrome.storage.local.set({ lockFails: 0, lockBlockedUntil: 0 });
      return { ok: true, wait: 0 };
    }
    const fails = (s.lockFails || 0) + 1;
    const wait = fails % 5 === 0 ? Math.min(600, 30 * 2 ** (fails / 5 - 1)) : 0;
    await chrome.storage.local.set({ lockFails: fails, lockBlockedUntil: wait ? now + wait * 1000 : 0 });
    return { ok: false, wait };
  }

  return { create, verify, attempt };
})();
