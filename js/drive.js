/* ===========================================================
   IST Trust Zone — Google Drive integration (admin.html only)
   Persistent auth + year-based archive folder (IstArxivYYYY).
   Files are stored inside a Drive folder that auto-creates
   and auto-rotates each calendar year.
=========================================================== */
import { googleDriveConfig } from "./firebase-config.js";

const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files";
const FILES_URL = "https://www.googleapis.com/drive/v3/files";

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let refreshTimer = null;
let cachedFolderId = null;

const STORAGE_KEY = "ist_drive_token";
const STORAGE_EXPIRY = "ist_drive_token_expiry";
const FOLDER_CACHE_KEY = "ist_drive_folder_id";
const FOLDER_YEAR_KEY = "ist_drive_folder_year";
const MERGE_FOLDER_NAME = "IstServices Merge Pdf";
const MERGE_FOLDER_CACHE_KEY = "ist_drive_merge_folder_id";

/* ---------------------------------------------------------
   GIS loader
--------------------------------------------------------- */
function waitForGis() {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    let tries = 0;
    const interval = setInterval(() => {
      tries++;
      if (window.google?.accounts?.oauth2) { clearInterval(interval); resolve(); }
      else if (tries > 100) { clearInterval(interval); reject(new Error("Google Identity Services yüklənmədi.")); }
    }, 100);
  });
}

/* ---------------------------------------------------------
   Token persistence (localStorage)
--------------------------------------------------------- */
function saveToken(token, expiresAt) {
  try {
    localStorage.setItem(STORAGE_KEY, token);
    localStorage.setItem(STORAGE_EXPIRY, String(expiresAt));
  } catch (_) {}
}

function loadSavedToken() {
  try {
    const token = localStorage.getItem(STORAGE_KEY);
    const expiry = parseInt(localStorage.getItem(STORAGE_EXPIRY) || "0", 10);
    if (token && expiry && Date.now() < expiry - 30000) {
      accessToken = token;
      tokenExpiresAt = expiry;
      return true;
    }
  } catch (_) {}
  return false;
}

function clearSavedToken() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_EXPIRY);
  } catch (_) {}
}

/* ---------------------------------------------------------
   Proactive refresh timer
--------------------------------------------------------- */
function scheduleRefresh() {
  clearTimeout(refreshTimer);
  if (!accessToken || !tokenExpiresAt) return;
  const ms = Math.max(0, tokenExpiresAt - Date.now() - 300000);
  refreshTimer = setTimeout(async () => {
    try { await silentRefresh(); } catch (_) {}
  }, ms);
}

function cancelRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = null;
}

/* ---------------------------------------------------------
   Silent refresh
--------------------------------------------------------- */
async function silentRefresh() {
  await waitForGis();
  const client = initTokenClient();
  const token = await new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp?.access_token) resolve(resp.access_token);
      else reject(new Error("no token"));
    };
    client.error_callback = () => reject(new Error("silent refresh failed"));
    client.requestAccessToken({ prompt: "none" });
  });
  accessToken = token;
  tokenExpiresAt = Date.now() + 3500000;
  saveToken(accessToken, tokenExpiresAt);
  setDriveStatus(true);
  scheduleRefresh();
  return accessToken;
}

/* ---------------------------------------------------------
   Token client init
--------------------------------------------------------- */
function initTokenClient() {
  if (tokenClient) return tokenClient;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: googleDriveConfig.clientId,
    scope: googleDriveConfig.scope,
    callback: () => {}
  });
  return tokenClient;
}

/* ---------------------------------------------------------
   Public: ensure valid access token
--------------------------------------------------------- */
export async function ensureAccessToken(interactive = true) {
  if (accessToken && Date.now() < tokenExpiresAt - 30000) return accessToken;

  if (loadSavedToken()) {
    if (Date.now() < tokenExpiresAt - 30000) {
      setDriveStatus(true);
      scheduleRefresh();
      return accessToken;
    }
    try {
      const token = await silentRefresh();
      return token;
    } catch (_) {
      clearSavedToken();
      accessToken = null;
      tokenExpiresAt = 0;
    }
  }

  if (!googleDriveConfig.clientId || googleDriveConfig.clientId.startsWith("PASTE_")) {
    throw new Error("Google Drive OAuth Client ID təyin olunmayıb.");
  }
  await waitForGis();
  const client = initTokenClient();

  return new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp?.access_token) {
        accessToken = resp.access_token;
        tokenExpiresAt = Date.now() + (resp.expires_in ? resp.expires_in * 1000 : 3500000);
        saveToken(accessToken, tokenExpiresAt);
        setDriveStatus(true);
        scheduleRefresh();
        resolve(accessToken);
      } else {
        reject(new Error("Google Drive icazəsi alınmadı."));
      }
    };
    client.error_callback = () => reject(new Error("Google Drive girişi ləğv edildi."));
    client.requestAccessToken({ prompt: interactive ? "" : "none" });
  });
}

export function isDriveConnected() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

/* ---------------------------------------------------------
   Public: get an access token WITHOUT ever prompting the user.
   Used as a best-effort fallback (e.g. by pdf-merge.js) — if
   nobody has connected Drive in this browser yet, or the saved
   token can't be silently refreshed, this simply resolves to
   null instead of throwing or popping a login window.
--------------------------------------------------------- */
export async function getSilentAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 30000) return accessToken;
  if (loadSavedToken() && Date.now() < tokenExpiresAt - 30000) return accessToken;
  if (!googleDriveConfig.clientId || googleDriveConfig.clientId.startsWith("PASTE_")) return null;
  try {
    return await silentRefresh();
  } catch (_) {
    return null;
  }
}

export function signOutDrive() {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  cachedFolderId = null;
  cancelRefresh();
  clearSavedToken();
  clearFolderCache();
  setDriveStatus(false);
}

function setDriveStatus(connected) {
  const dot = document.getElementById("drive-status-dot");
  const text = document.getElementById("drive-status-text");
  if (dot) dot.classList.toggle("connected", connected);
  if (text) text.textContent = connected ? "Google Drive qoşuludur" : "Google Drive qoşulmayıb";
}

/* ==========================================================
   YEAR-BASED ARCHIVE FOLDER
   Folder name: IstArxivYYYY (auto-rotates each year)
   Cached in localStorage so we don't search Drive every time.
   When the year changes, a new folder is created automatically.
   ========================================================== */
function getArchiveFolderName() {
  return "IstArxiv" + new Date().getFullYear();
}

function getFolderCache() {
  try {
    const id = localStorage.getItem(FOLDER_CACHE_KEY);
    const year = localStorage.getItem(FOLDER_YEAR_KEY);
    const currentYear = String(new Date().getFullYear());
    if (id && year === currentYear) return id;
  } catch (_) {}
  return null;
}

function setFolderCache(folderId) {
  try {
    localStorage.setItem(FOLDER_CACHE_KEY, folderId);
    localStorage.setItem(FOLDER_YEAR_KEY, String(new Date().getFullYear()));
    cachedFolderId = folderId;
  } catch (_) {}
}

function clearFolderCache() {
  try {
    localStorage.removeItem(FOLDER_CACHE_KEY);
    localStorage.removeItem(FOLDER_YEAR_KEY);
  } catch (_) {}
  cachedFolderId = null;
}

/**
 * Find or create the year-based archive folder in Google Drive.
 * Returns the folder ID, using cache when possible.
 */
async function ensureArchiveFolder(token) {
  // Return cached if valid for this year
  if (cachedFolderId) return cachedFolderId;
  const cached = getFolderCache();
  if (cached) { cachedFolderId = cached; return cached; }

  const folderName = getArchiveFolderName();

  // Search for existing folder
  const searchRes = await fetch(
    `${FILES_URL}?q=name='${encodeURIComponent(folderName)}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      const folderId = data.files[0].id;
      setFolderCache(folderId);
      return folderId;
    }
  }

  // Folder doesn't exist — create it
  const createRes = await fetch(`${FILES_URL}?fields=id,name`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      name: folderName,
      mimeType: "application/vnd.google-apps.folder"
    })
  });

  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`"${folderName}" qovluğu yaradıla bilmədi: ${createRes.status} ${errText}`);
  }

  const created = await createRes.json();
  setFolderCache(created.id);
  return created.id;
}

/**
 * Find or create an arbitrary named folder in Google Drive (not
 * year-based, not cached under the archive-folder keys). Used for
 * the "IstServices Merge Pdf" output folder.
 */
async function ensureMergeFolder(token) {
  try {
    const cached = localStorage.getItem(MERGE_FOLDER_CACHE_KEY);
    if (cached) return cached;
  } catch (_) {}

  const searchRes = await fetch(
    `${FILES_URL}?q=name='${encodeURIComponent(MERGE_FOLDER_NAME)}' and mimeType='application/vnd.google-apps.folder' and trashed=false&fields=files(id,name)`,
    { headers: { "Authorization": `Bearer ${token}` } }
  );
  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      const folderId = data.files[0].id;
      try { localStorage.setItem(MERGE_FOLDER_CACHE_KEY, folderId); } catch (_) {}
      return folderId;
    }
  }

  const createRes = await fetch(`${FILES_URL}?fields=id,name`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: MERGE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  if (!createRes.ok) {
    const errText = await createRes.text().catch(() => "");
    throw new Error(`"${MERGE_FOLDER_NAME}" qovluğu yaradıla bilmədi: ${createRes.status} ${errText}`);
  }
  const created = await createRes.json();
  try { localStorage.setItem(MERGE_FOLDER_CACHE_KEY, created.id); } catch (_) {}
  return created.id;
}

/* ---------------------------------------------------------
   Resumable upload — files go into the archive folder
--------------------------------------------------------- */
async function initiateResumableSession(file, token) {
  const folderId = await ensureArchiveFolder(token);
  return initiateResumableSessionInFolder(file.name, file.type, folderId, token);
}

/**
 * Generic version of initiateResumableSession that uploads into an
 * arbitrary, already-resolved folder ID and accepts a plain
 * name/mimeType pair instead of requiring a File object — this lets
 * it be used for Blobs (like an in-memory merged PDF) too.
 */
async function initiateResumableSessionInFolder(name, mimeType, folderId, token) {
  const metadata = { name, parents: [folderId] };
  const fields = "id,name,mimeType,size,webViewLink,webContentLink";
  const res = await fetch(`${UPLOAD_URL}?uploadType=resumable&fields=${fields}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": mimeType || "application/octet-stream"
    },
    body: JSON.stringify(metadata)
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("Drive sessiyası başladılmadı: " + res.status + " " + errText);
  }
  const location = res.headers.get("Location");
  if (!location) throw new Error("Drive upload sessiyası üçün ünvan alınmadı.");
  return location;
}

function putFileToSession(sessionUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUrl, true);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch (err) { reject(err); }
      } else {
        reject(new Error("Drive yükləməsi uğursuz oldu: " + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error("Drive yükləməsi zamanı şəbəkə xətası."));
    xhr.send(file);
  });
}

async function makePublic(fileId, token) {
  const res = await fetch(`${FILES_URL}/${fileId}/permissions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ role: "reader", type: "anyone" })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("Fayl paylaşıla bilmədi: " + res.status + " " + errText);
  }
}

/* ---------------------------------------------------------
   Public API
--------------------------------------------------------- */
export async function uploadToDrive(file, onProgress) {
  const token = await ensureAccessToken();
  const sessionUrl = await initiateResumableSession(file, token);
  const uploaded = await putFileToSession(sessionUrl, file, onProgress);
  await makePublic(uploaded.id, token);
  return {
    id: uploaded.id,
    name: uploaded.name,
    size: Number(uploaded.size) || file.size,
    mimeType: uploaded.mimeType || file.type,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${uploaded.id}`,
    viewUrl: `https://drive.google.com/file/d/${uploaded.id}/preview`
  };
}

/**
 * Upload an already-merged PDF (a Blob, not a File input) into the
 * shared "IstServices Merge Pdf" Drive folder. Requires an
 * interactive OAuth consent the first time it's used on a given
 * page/browser (same Google Identity flow as admin.html).
 */
export async function uploadMergedPdf(blob, fileName, onProgress) {
  const token = await ensureAccessToken();
  const folderId = await ensureMergeFolder(token);
  const sessionUrl = await initiateResumableSessionInFolder(fileName, "application/pdf", folderId, token);
  const uploaded = await putFileToSession(sessionUrl, blob, onProgress);
  return {
    id: uploaded.id,
    name: uploaded.name,
    size: Number(uploaded.size) || blob.size,
    mimeType: uploaded.mimeType || "application/pdf",
    webViewLink: uploaded.webViewLink || `https://drive.google.com/file/d/${uploaded.id}/view`,
    downloadUrl: `https://drive.google.com/uc?export=download&id=${uploaded.id}`
  };
}

export async function deleteFromDrive(fileId) {
  if (!fileId) return;
  try {
    const token = await ensureAccessToken(false);
    await fetch(`${FILES_URL}/${fileId}`, {
      method: "DELETE",
      headers: { "Authorization": `Bearer ${token}` }
    });
  } catch (err) {
    console.warn("Drive faylı silinmədi (davam edilir):", err);
  }
}

/* ---------------------------------------------------------
   Auto-load on module init
--------------------------------------------------------- */
if (loadSavedToken()) {
  setDriveStatus(true);
  scheduleRefresh();
  // Pre-warm the year-archive folder cache — admin.html only (this
  // module is also imported on index.html for the PDF merge feature,
  // which has no use for the archive folder).
  if (document.getElementById("drive-status-dot")) {
    ensureArchiveFolder(accessToken).catch(() => {});
  }
}

/* ==========================================================
   DUPLICATE FILE CHECK
   Search the archive folder for a file with the exact same name.
   Returns the existing file object if found, null otherwise.
   ========================================================== */
export async function checkDuplicateInDrive(fileName) {
  const token = await ensureAccessToken(false);
  if (!token) return null;
  const folderId = await ensureArchiveFolder(token);
  const q = `name='${encodeURIComponent(fileName)}' and '${folderId}' in parents and trashed=false`;
  const res = await fetch(`${FILES_URL}?q=${encodeURIComponent(q)}&fields=files(id,name,size,mimeType)`, {
    headers: { "Authorization": `Bearer ${token}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return (data.files && data.files.length > 0) ? data.files[0] : null;
}

/* ==========================================================
   RENAME FILE on Google Drive
   Uses the PATCH endpoint to update only the name field.
   ========================================================== */
export async function renameFileOnDrive(fileId, newName) {
  const token = await ensureAccessToken();
  const res = await fetch(`${FILES_URL}/${fileId}`, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ name: newName })
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error("Drive-da fayl adı dəyişdirilə bilmədi: " + res.status + " " + errText);
  }
  return await res.json();
}
