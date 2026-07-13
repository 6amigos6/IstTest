/* ===========================================================
   IST Trust Zone — Shared core
   Firebase init, realtime DB refs, and utilities shared by
   the User Panel (index.html / user.js) and the Admin Panel
   (admin.html / admin.js). Keeping this in one place is what
   makes the two independently-coded pages stay perfectly in
   sync: they both read/write the exact same Firebase Realtime
   Database, so any change made on one page is pushed to the
   other instantly, with no page reload.
=========================================================== */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getDatabase, ref, push, onValue, child
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { firebaseConfig, googleDriveConfig } from "./firebase-config.js";

/* ---------------------------------------------------------
   Firebase init (single shared connection per page)
--------------------------------------------------------- */
export const fbApp = initializeApp(firebaseConfig);
export const db = getDatabase(fbApp);
export const itemsRef = ref(db, "items");
export const authConfigRef = ref(db, "config/auth");
export const mergesRef = ref(db, "merges");

/* Record a completed PDF merge (Drive fileId/link + which listeners
   were merged, in selection order) so Drive and the DB stay in sync. */
export function saveMergeRecord(record) {
  return push(mergesRef, { ...record, createdAt: Date.now() });
}

export function uid() {
  return push(itemsRef).key;
}

/* Subscribe to realtime updates. Every page (user or admin)
   that calls this gets pushed the latest data the instant it
   changes anywhere — this is the realtime sync mechanism. */
export function subscribeItems(callback) {
  return onValue(itemsRef, (snapshot) => callback(snapshot.val() || {}));
}

export function getSortedItems(itemsData) {
  return Object.entries(itemsData)
    .map(([id, val]) => ({ id, ...val }))
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "az"));
}

export function getFilesOf(itemsData, itemId) {
  const files = (itemsData[itemId] && itemsData[itemId].files) || {};
  return Object.entries(files)
    .map(([id, val]) => ({ id, ...val }))
    .sort((a, b) => (b.date || 0) - (a.date || 0));
}

/* ---------------------------------------------------------
   Formatting utilities
--------------------------------------------------------- */
export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return bytes + " B";
  const units = ["KB", "MB", "GB"];
  let val = bytes / 1024, i = 0;
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++; }
  return val.toFixed(val < 10 ? 1 : 0) + " " + units[i];
}

export function formatDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleDateString("az-AZ", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " + d.toLocaleTimeString("az-AZ", { hour: "2-digit", minute: "2-digit" });
}

export function getExtension(filename) {
  const m = /\.([a-z0-9]+)$/i.exec(filename || "");
  return m ? m[1].toUpperCase() : "FAYL";
}

export const PREVIEWABLE_IMAGE = ["JPG", "JPEG", "PNG", "WEBP", "GIF"];
export const PREVIEWABLE_VIDEO = ["MP4"];
export const PREVIEWABLE_PDF = ["PDF"];
export const PREVIEWABLE_OFFICE = ["DOCX", "DOC", "XLSX", "XLS", "PPTX", "PPT", "ODT", "ODS", "ODP"];

export function getPreviewKind(ext) {
  if (PREVIEWABLE_IMAGE.includes(ext)) return "image";
  if (PREVIEWABLE_VIDEO.includes(ext)) return "video";
  if (PREVIEWABLE_PDF.includes(ext)) return "pdf";
  if (PREVIEWABLE_OFFICE.includes(ext)) return "office";
  return "none";
}

export const FILE_COLOR_MAP = {
  "PDF": "#e74c3c", "DOCX": "#2b7ce9", "DOC": "#2b7ce9",
  "XLSX": "#27ae60", "XLS": "#27ae60",
  "PPTX": "#e67e22", "PPT": "#e67e22",
  "JPG": "#9b59b6", "JPEG": "#9b59b6", "PNG": "#9b59b6", "WEBP": "#9b59b6", "GIF": "#9b59b6",
  "MP4": "#e91e63"
};

/* ---------------------------------------------------------
   Toast
--------------------------------------------------------- */
export function showToast(message, type = "") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const el = document.createElement("div");
  el.className = "toast" + (type ? " " + type : "");
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => {
    el.style.transition = "opacity 200ms ease";
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, 2600);
}

/* ---------------------------------------------------------
   Promise-based confirm dialog (admin.html only)
--------------------------------------------------------- */
export function askConfirm(message) {
  const confirmDialog = document.getElementById("confirm-dialog");
  const confirmMessage = document.getElementById("confirm-message");
  const confirmOk = document.getElementById("confirm-ok");
  const confirmCancel = document.getElementById("confirm-cancel");
  if (!confirmDialog) return Promise.resolve(window.confirm(message));

  return new Promise((resolve) => {
    confirmMessage.textContent = message;
    confirmDialog.classList.remove("hidden");
    const cleanup = (result) => {
      confirmDialog.classList.add("hidden");
      confirmOk.removeEventListener("click", onOk);
      confirmCancel.removeEventListener("click", onCancel);
      resolve(result);
    };
    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);
    confirmOk.addEventListener("click", onOk);
    confirmCancel.addEventListener("click", onCancel);
  });
}

/* Promise-based rename/prompt dialog (admin.html only) */
export function askRename(label, initialValue) {
  const renameDialog = document.getElementById("rename-dialog");
  const renameLabel = document.getElementById("rename-label");
  const renameInput = document.getElementById("rename-input");
  const renameOk = document.getElementById("rename-ok");
  const renameCancel = document.getElementById("rename-cancel");
  if (!renameDialog) return Promise.resolve(window.prompt(label, initialValue || ""));

  return new Promise((resolve) => {
    renameLabel.textContent = label;
    renameInput.value = initialValue || "";
    renameDialog.classList.remove("hidden");
    setTimeout(() => { renameInput.focus(); renameInput.select(); }, 30);
    const cleanup = (result) => {
      renameDialog.classList.add("hidden");
      renameOk.removeEventListener("click", onOk);
      renameCancel.removeEventListener("click", onCancel);
      renameInput.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onOk = () => {
      const val = renameInput.value.trim();
      if (!val) { renameInput.focus(); return; }
      cleanup(val);
    };
    const onCancel = () => cleanup(null);
    const onKey = (e) => {
      if (e.key === "Enter") onOk();
      if (e.key === "Escape") onCancel();
    };
    renameOk.addEventListener("click", onOk);
    renameCancel.addEventListener("click", onCancel);
    renameInput.addEventListener("keydown", onKey);
  });
}

/* ---------------------------------------------------------
   Preview / download (shared overlay markup on both pages)
--------------------------------------------------------- */
export function openPreview(file) {
  const previewOverlay = document.getElementById("preview-overlay");
  const previewTitle = document.getElementById("preview-title");
  const previewBody = document.getElementById("preview-body");
  if (!previewOverlay) return;

  const ext = getExtension(file.name);
  const kind = getPreviewKind(ext);
  previewTitle.textContent = file.name || "";
  previewBody.innerHTML = "";

  // Google Drive has one universal embeddable preview endpoint that
  // handles images, video, PDFs, and office documents itself — no
  // need for separate <img>/<video>/gview branches like before.
  if (kind !== "none" && file.viewUrl) {
    const iframe = document.createElement("iframe");
    iframe.src = file.viewUrl;
    iframe.style.width = "100%";
    iframe.style.height = "75vh";
    iframe.style.border = "none";
    iframe.style.borderRadius = "8px";
    iframe.allow = "autoplay";
    previewBody.appendChild(iframe);
  } else {
    previewBody.innerHTML = `
      <div class="preview-fallback">
        <p>Bu fayl növü üçün ön baxış brauzerdə mümkün deyil.</p>
        <p style="margin-top:14px;">
          <a href="${file.url}" target="_blank" rel="noopener" class="btn btn-outline" style="color:#fff;border-color:rgba(255,255,255,0.4);">Yeni səkmədə aç / Yüklə</a>
        </p>
      </div>`;
  }
  previewOverlay.classList.remove("hidden");
}

export function closePreview() {
  const previewOverlay = document.getElementById("preview-overlay");
  const previewBody = document.getElementById("preview-body");
  if (!previewOverlay) return;
  previewOverlay.classList.add("hidden");
  previewBody.innerHTML = "";
}

export function initPreviewOverlay() {
  const previewOverlay = document.getElementById("preview-overlay");
  const previewClose = document.getElementById("preview-close");
  if (!previewOverlay) return;
  previewClose.addEventListener("click", closePreview);
  previewOverlay.addEventListener("click", (e) => { if (e.target === previewOverlay) closePreview(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !previewOverlay.classList.contains("hidden")) closePreview();
  });
}

export async function triggerDownload(file) {
  /* Try Drive API fetch first — works on mobile, bypasses popup blockers */
  if (file.driveFileId) {
    try {
      const url = "https://www.googleapis.com/drive/v3/files/" + file.driveFileId + "?alt=media&key=" + googleDriveConfig.apiKey;
      const resp = await fetch(url);
      if (resp.ok) {
        const blob = await resp.blob();
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(blobUrl); }, 5000);
        return;
      }
    } catch (_) { /* fall through */ }
  }
  /* Fallback: Google Drive direct download */
  window.open(file.url, "_blank", "noopener");
}


