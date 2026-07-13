/* ===========================================================
   IST Trust Zone — Site login
   ---------------------------------------------------------
   There is no traditional application server in this project —
   both pages talk directly to Firebase Realtime Database (see
   README: the database rules are public read/write, since the
   project ships with no login of its own on the data layer).
   Given that constraint, this module implements the strongest
   practical version of the requested login system:

   - The password itself is never stored or compared in plain
     text anywhere, in Firebase or in the frontend. Only a
     salted SHA-256 hash (computed with the browser's native
     Web Crypto API) is ever written to the database or held
     in memory.
   - "config/auth" in Firebase holds { passwordHash, passwordSalt,
     authVersion }. authVersion increments every time the
     password is changed from the Admin Panel.
   - A successful login stores only the authVersion that was
     current at login time in localStorage — not the password,
     not the hash. On every page load that stored version is
     compared against the live authVersion in Firebase; a
     mismatch (i.e. the password was changed since) forces a
     fresh login, which is what invalidates old sessions.
   - Because localStorage (not sessionStorage) is used, closing
     and reopening the browser does not ask for the password
     again, per the request.

   Honest limitation: because Firebase's rules are public
   read/write (required for the realtime sync elsewhere in this
   app to work without a backend), a technically sophisticated
   visitor could in principle read config/auth's hash or write
   to items/ directly, bypassing the UI. A real access-control
   boundary would require Firebase Auth + security rules or a
   server layer, which is a larger architectural change outside
   this task's scope. This module is the best login system
   achievable within the project's current architecture.
=========================================================== */
import {
  get, set
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { authConfigRef } from "./shared.js";
import { AUTH_SEED } from "./firebase-config.js";

const SESSION_KEY = "ist_session";

/* Pure-JS SHA-256 fallback for non-HTTPS / file:// contexts
   where the Web Crypto API (crypto.subtle) is unavailable. */
async function sha256Hex(text) {
  /* Try native Web Crypto first (fast, available on HTTPS). */
  if (typeof crypto !== "undefined" && crypto.subtle) {
    try {
      const bytes = new TextEncoder().encode(text);
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    } catch (_) { /* fall through to pure JS */ }
  }
  /* Pure JS SHA-256 — used only as a last-resort fallback. */
  return sha256PureJS(text);
}

function sha256PureJS(msg) {
  function rightRotate(v, n) { return (v >>> n) | (v << (32 - n)); }
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2
  ];
  let H = [
    0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,
    0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19
  ];
  const bytes = new TextEncoder().encode(msg);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 56; i >= 0; i -= 8) bytes.push((bitLen / Math.pow(2, i)) & 0xff);
  for (let off = 0; off < bytes.length; off += 64) {
    const W = new Array(64);
    for (let i = 0; i < 16; i++) W[i] = (bytes[off+i*4]<<24)|(bytes[off+i*4+1]<<16)|(bytes[off+i*4+2]<<8)|bytes[off+i*4+3];
    for (let i = 16; i < 64; i++) {
      const s0 = rightRotate(W[i-15],7)^rightRotate(W[i-15],18)^(W[i-15]>>>3);
      const s1 = rightRotate(W[i-2],17)^rightRotate(W[i-2],19)^(W[i-2]>>>10);
      W[i] = (W[i-16]+s0+W[i-7]+s1)|0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rightRotate(e,6)^rightRotate(e,11)^rightRotate(e,25);
      const ch = (e&f)^(~e&g);
      const t1 = (h+S1+ch+K[i]+W[i])|0;
      const S0 = rightRotate(a,2)^rightRotate(a,13)^rightRotate(a,22);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj)|0;
      h=g; g=f; f=e; e=(d+t1)|0; d=c; c=b; b=a; a=(t1+t2)|0;
    }
    H = [(H[0]+a)|0,(H[1]+b)|0,(H[2]+c)|0,(H[3]+d)|0,(H[4]+e)|0,(H[5]+f)|0,(H[6]+g)|0,(H[7]+h)|0];
  }
  return H.map(v => (v>>>0).toString(16).padStart(8,"0")).join("");
}

function randomSaltHex() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeSession(authVersion) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ v: authVersion }));
  } catch (_) {}
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch (_) {}
}

/* Reads config/auth, bootstrapping it with the seed hash on the
   very first run (i.e. nothing has been written there yet). */
async function fetchAuthConfig() {
  const snap = await get(authConfigRef);
  if (snap.exists()) return snap.val();
  const seeded = {
    passwordHash: AUTH_SEED.hash,
    passwordSalt: AUTH_SEED.salt,
    authVersion: 1
  };
  await set(authConfigRef, seeded);
  return seeded;
}

/* True if the locally stored session still matches the current
   authVersion in Firebase (i.e. the password hasn't changed
   since this browser last logged in). */
export async function hasValidSession() {
  const config = await fetchAuthConfig();
  const session = readSession();
  return !!(session && session.v === config.authVersion);
}

export async function login(password) {
  const config = await fetchAuthConfig();
  const hash = await sha256Hex(config.passwordSalt + password);
  if (hash === config.passwordHash) {
    writeSession(config.authVersion);
    return true;
  }
  return false;
}

/* Changes the site password (Admin Panel only). Bumps authVersion,
   which invalidates every other session on their next page load —
   this browser's session is refreshed to the new version so the
   admin who just changed it isn't logged out mid-task. */
export async function changePassword(newPassword) {
  const salt = randomSaltHex();
  const hash = await sha256Hex(salt + newPassword);
  const config = await fetchAuthConfig();
  const newVersion = (config.authVersion || 1) + 1;
  await set(authConfigRef, { passwordHash: hash, passwordSalt: salt, authVersion: newVersion });
  writeSession(newVersion);
}

/* Returns the current authVersion if a password is set, or null/0 if not. */
export async function getCurrentAuthVersion() {
  try {
    const config = await fetchAuthConfig();
    return config.authVersion || 0;
  } catch (_) {
    return 0;
  }
}

/* Removes the password (resets to open access). */
export async function removePassword() {
  const config = await fetchAuthConfig();
  const newVersion = (config.authVersion || 0) + 1;
  await set(authConfigRef, {
    passwordHash: "",
    passwordSalt: "",
    authVersion: newVersion
  });
  writeSession(newVersion);
}
