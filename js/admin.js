/* ===========================================================
   IST Trust Zone — Admin Panel logic (admin.html)
   Talks to Firebase Realtime Database via shared.js.
   Every change here is pushed to the User Panel instantly.
=========================================================== */
import {
  itemsRef, uid, subscribeItems, getSortedItems, getFilesOf,
  escapeHtml, formatBytes, formatDate, getExtension, FILE_COLOR_MAP,
  showToast, askConfirm, askRename,
  openPreview, initPreviewOverlay, triggerDownload, closePreview,
  db
} from "./shared.js";
import { uploadToDrive, deleteFromDrive, ensureAccessToken, isDriveConnected, signOutDrive, checkDuplicateInDrive, renameFileOnDrive } from "./drive.js";
import { set, update, remove, child, onValue, ref as dbRef } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { initThemeSwitch } from "./theme.js";
import { hasValidSession, changePassword, getCurrentAuthVersion } from "./auth.js";

const mergesRef = dbRef(db, "merges");

initThemeSwitch("theme-switch");

/* ---------------------------------------------------------
   Auth guard
--------------------------------------------------------- */
(async function guardAuth() {
  const authScreen = document.getElementById("auth-check-screen");
  let valid = false;
  try { valid = await hasValidSession(); } catch (err) { console.error(err); }
  if (!valid) { window.location.replace("index.html"); return; }
  document.body.classList.remove("auth-pending");
  if (authScreen) authScreen.classList.add("splash-hidden");
})();

/* ---------------------------------------------------------
   State
--------------------------------------------------------- */
let itemsData = {};
let adminActiveItemId = null;
let adminMergeData = {};
let adminSearchTerm = "";

/* ---------------------------------------------------------
   DOM refs
--------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const adminExitBtn = $("admin-exit");
const adminItemsView = $("admin-items-view");
const adminFilesView = $("admin-files-view");
const adminSettingsView = $("admin-settings-view");
const adminSettingsBtn = $("admin-settings-btn");
const adminSettingsBack = $("admin-settings-back");
const adminMergesBtn = $("admin-merges-btn");
const adminMergesView = $("admin-merges-view");
const adminMergesBack = $("admin-merges-back");
const adminMergesList = $("admin-merges-list");
const adminMergesEmpty = $("admin-merges-empty");
const adminMergesLoading = $("admin-merges-loading");
const changePasswordForm = $("change-password-form");
const newPassword1 = $("new-password-1");
const newPassword2 = $("new-password-2");
const adminSearchInput = $("admin-search");
const adminSearchClear = $("admin-search-clear");
const adminItemsTable = $("admin-items-table");
const adminItemsEmpty = $("admin-items-empty");
const adminItemsEmptyText = $("admin-items-empty-text");
const adminListCount = $("admin-list-count");
const adminBackToItems = $("admin-back-to-items");
const adminFilesTitle = $("admin-files-title");
const adminItemPhoneInput = $("admin-item-phone");
const adminItemEmailInput = $("admin-item-email");
const dropzone = $("dropzone");
const fileUploadInput = $("file-upload-input");
const uploadProgressList = $("upload-progress-list");
const adminFilesTable = $("admin-files-table");
const adminFilesEmpty = $("admin-files-empty");
const driveStatusBtn = $("drive-status-btn");
const driveSignoutBtn = $("drive-signout-btn");

/* New quick-add elements */
const quickAddCard = $("quick-add-card");
const manualAddCard = $("manual-add-card");
const quickAddPanel = $("quick-add-panel");
const manualAddPanel = $("manual-add-panel");
const quickDropzone = $("quick-dropzone");
const quickFileInput = $("quick-file-input");
const quickUploadProgress = $("quick-upload-progress");
const manualAddForm = $("manual-add-form");
const manualAddName = $("manual-add-name");
const manualAddPhone = $("manual-add-phone");
const manualAddEmail = $("manual-add-email");
const manualAddSubmit = $("manual-add-submit");

/* Settings elements */
const authStatusDot = $("auth-status-dot");
const authStatusText = $("auth-status-text");

initPreviewOverlay();

/* ---------------------------------------------------------
   Drive connection
--------------------------------------------------------- */
function updateDriveSignoutVisibility() {
  if (driveSignoutBtn) {
    driveSignoutBtn.classList.toggle("hidden", !isDriveConnected());
  }
}

if (driveStatusBtn) {
  driveStatusBtn.addEventListener("click", async () => {
    if (isDriveConnected()) return;
    try {
      await ensureAccessToken();
      showToast("Google Drive qoşuldu", "success");
      updateDriveSignoutVisibility();
    } catch (err) {
      console.error(err);
      showToast(err.message || "Google Drive qoşula bilmədi", "error");
    }
  });
}

if (driveSignoutBtn) {
  driveSignoutBtn.addEventListener("click", async () => {
    const ok = await askConfirm("Google Drive-dan çıxış etmək istədiyinizə əminsiniz?");
    if (!ok) return;
    signOutDrive();
    showToast("Google Drive-dan çıxışıldı", "success");
    updateDriveSignoutVisibility();
  });
}

updateDriveSignoutVisibility();

/* ---------------------------------------------------------
   Settings view
--------------------------------------------------------- */
adminSettingsBtn.addEventListener("click", () => {
  adminItemsView.classList.add("hidden");
  adminFilesView.classList.add("hidden");
  adminSettingsView.classList.remove("hidden");
  refreshAuthStatus();
});

adminSettingsBack.addEventListener("click", () => {
  adminSettingsView.classList.add("hidden");
  adminItemsView.classList.remove("hidden");
});

/* ---------------------------------------------------------
   Merges view navigation
--------------------------------------------------------- */
adminMergesBtn.addEventListener("click", () => {
  adminItemsView.classList.add("hidden");
  adminFilesView.classList.add("hidden");
  adminSettingsView.classList.add("hidden");
  adminMergesView.classList.remove("hidden");
  loadMerges();
});

adminMergesBack.addEventListener("click", () => {
  adminMergesView.classList.add("hidden");
  adminItemsView.classList.remove("hidden");
});

async function refreshAuthStatus() {
  try {
    const v = await getCurrentAuthVersion();
    if (v) {
      if (authStatusDot) authStatusDot.classList.add("active");
      if (authStatusText) authStatusText.textContent = "Şifrə təyin edilib";

    } else {
      if (authStatusDot) authStatusDot.classList.remove("active");
      if (authStatusText) authStatusText.textContent = "Şifrə təyin edilməyib — giriş açıq rejimdir";

    }
  } catch (err) {
    console.error(err);
    if (authStatusText) authStatusText.textContent = "Vəziyyət yoxlanıla bilmədi";
  }
}

changePasswordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const p1 = newPassword1.value;
  const p2 = newPassword2.value;
  if (p1 !== p2) {
    showToast("Şifrələr uyğun gəlmir", "error");
    newPassword2.select();
    return;
  }
  try {
    await changePassword(p1);
    newPassword1.value = "";
    newPassword2.value = "";
    showToast("Şifrə yeniləndi", "success");
    refreshAuthStatus();
  } catch (err) {
    console.error(err);
    showToast("Şifrə yenilənərkən xəta baş verdi", "error");
  }
});



/* ---------------------------------------------------------
   Realtime data subscription
--------------------------------------------------------- */
subscribeItems((data) => {
  itemsData = data;
  if (!adminActiveItemId) {
    renderItemsGrid();
  } else {
    renderFilesView();
  }
});

/* ---------------------------------------------------------
   ADMIN — Items grid (main view)
--------------------------------------------------------- */
function renderItemsGrid() {
  const all = getSortedItems(itemsData);
  const term = adminSearchTerm.trim().toLowerCase();
  const filtered = term ? all.filter((it) => (it.name || "").toLowerCase().includes(term)) : all;

  if (adminListCount) {
    adminListCount.textContent = filtered.length + " dinləyici";
  }

  adminItemsTable.innerHTML = filtered.map((it) => {
    const count = it.files ? Object.keys(it.files).length : 0;
    return `
      <div class="item-card" data-id="${it.id}">
        <div class="item-card-icon">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <div class="item-card-body">
          <div class="item-card-name">${escapeHtml(it.name)}</div>
          <div class="item-card-count">${count} sənəd</div>
        </div>
        <div class="item-card-right">
          <button class="item-action-btn" data-action="rename" data-id="${it.id}" title="Adı dəyiş">
            <svg viewBox="0 0 24 24" fill="none"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <button class="item-action-btn danger" data-action="delete" data-id="${it.id}" title="Sil">
            <svg viewBox="0 0 24 24" fill="none"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="item-card-arrow">
            <svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
        </div>
      </div>`;
  }).join("");

  /* Open item on card body/arrow click (not on action buttons) */
  adminItemsTable.querySelectorAll(".item-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".item-action-btn")) return;
      openFilesView(card.dataset.id);
    });
  });

  /* Rename buttons */
  adminItemsTable.querySelectorAll('[data-action="rename"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = itemsData[id];
      if (!item) return;
      const newName = await askRename("Yeni ad", item.name || "");
      if (newName && newName !== item.name) {
        try {
          await update(child(itemsRef, id), { name: newName });
          showToast("Ad yeniləndi", "success");
        } catch (err) {
          console.error(err);
          showToast("Ad yenilənərkən xəta baş verdi", "error");
        }
      }
    });
  });

  /* Delete buttons */
  adminItemsTable.querySelectorAll('[data-action="delete"]').forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = btn.dataset.id;
      const item = itemsData[id];
      if (!item) return;
      const ok = await askConfirm(`"${item.name}" dinləyicini silmək istədiyinizə əminsiniz? Bütün sənədlər də silinəcək.`);
      if (!ok) return;
      try {
        /* Delete all files from Drive first */
        const files = getFilesOf(itemsData, id);
        for (const f of files) {
          if (f.driveFileId) deleteFromDrive(f.driveFileId);
        }
        /* Delete from Firebase */
        await remove(child(itemsRef, id));
        showToast(`"${item.name}" silindi`, "success");
      } catch (err) {
        console.error(err);
        showToast("Silinərkən xəta baş verdi", "error");
      }
    });
  });

  /* Empty state */
  const hasAny = all.length > 0;
  if (!hasAny && !term) {
    adminItemsEmpty.classList.remove("hidden");
    if (adminItemsEmptyText) adminItemsEmptyText.textContent = "Hələ heç bir dinləyici əlavə edilməyib";
  } else if (hasAny && filtered.length === 0) {
    adminItemsEmpty.classList.remove("hidden");
    if (adminItemsEmptyText) adminItemsEmptyText.textContent = "Nəticə tapılmadı";
  } else {
    adminItemsEmpty.classList.add("hidden");
  }
  adminItemsTable.classList.toggle("hidden", filtered.length === 0);
}

/* ---------------------------------------------------------
   ADMIN — Files management view (per-item)
--------------------------------------------------------- */
function openFilesView(itemId) {
  adminActiveItemId = itemId;
  adminItemsView.classList.add("hidden");
  adminSettingsView.classList.add("hidden");
  adminFilesView.classList.remove("hidden");
  adminMergesView.classList.add("hidden");
  renderFilesView();
}

function closeFilesView() {
  adminActiveItemId = null;
  adminFilesView.classList.add("hidden");
  adminItemsView.classList.remove("hidden");
  adminMergesView.classList.add("hidden");
  renderItemsGrid();
}

adminBackToItems.addEventListener("click", closeFilesView);

if (adminFilesTitle) {
  adminFilesTitle.addEventListener("click", closeFilesView);
}

function renderFilesView() {
  if (!adminActiveItemId) return;
  const item = itemsData[adminActiveItemId];
  if (!item) { closeFilesView(); return; }

  adminFilesTitle.textContent = item.name || "";
  adminItemPhoneInput.value = item.phone || "";
  adminItemEmailInput.value = item.email || "";

  const files = getFilesOf(itemsData, adminActiveItemId);
  adminFilesEmpty.classList.toggle("hidden", files.length > 0);
  adminFilesTable.classList.toggle("hidden", files.length === 0);

  adminFilesTable.innerHTML = files.map((f) => {
    const ext = getExtension(f.name);
    return `
      <div class="file-row" data-id="${f.id}">
        <div class="file-icon" style="background:${FILE_COLOR_MAP[ext] || '#4c7aa3'}">${ext.slice(0, 4)}</div>
        <div class="file-info">
          <div class="file-name">${escapeHtml(f.name)}</div>
          <div class="file-meta">${formatBytes(f.size)} · ${formatDate(f.date)}</div>
        </div>
        <div class="file-actions">
          <button class="btn btn-outline btn-sm" data-action="preview" data-id="${f.id}" title="Bax">Bax</button>
          <button class="btn btn-outline btn-sm" data-action="download" data-id="${f.id}" title="Yüklə">Yüklə</button>
          <button class="btn btn-outline btn-sm" data-action="rename" data-id="${f.id}" title="Adı dəyiş">Ad dəyiş</button>
          <button class="btn btn-outline btn-sm" data-action="replace" data-id="${f.id}" title="Dəyiş">Dəyiş</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="${f.id}" title="Sil">Sil</button>
        </div>
      </div>`;
  }).join("");

  adminFilesTable.querySelectorAll("[data-action]").forEach((btn) => {
    const file = files.find((f) => f.id === btn.dataset.id);
    if (!file) return;
    if (btn.dataset.action === "preview") btn.addEventListener("click", () => openPreview(file));
    if (btn.dataset.action === "download") btn.addEventListener("click", () => triggerDownload(file));
    if (btn.dataset.action === "replace") btn.addEventListener("click", () => replaceFilePrompt(file));
    if (btn.dataset.action === "delete") btn.addEventListener("click", () => deleteFilePrompt(file));
    if (btn.dataset.action === "rename") btn.addEventListener("click", () => renameFilePrompt(file));
  });
}

/* ---------------------------------------------------------
   ADMIN — Contact field save
--------------------------------------------------------- */
adminItemPhoneInput.addEventListener("change", () => saveContactField("phone", adminItemPhoneInput.value.trim()));
adminItemEmailInput.addEventListener("change", () => saveContactField("email", adminItemEmailInput.value.trim()));

async function saveContactField(field, value) {
  if (!adminActiveItemId) return;
  try {
    await update(child(itemsRef, adminActiveItemId), { [field]: value || null });
  } catch (err) {
    console.error(err);
    showToast("Yenilənərkən xəta baş verdi", "error");
  }
}

/* ---------------------------------------------------------
   ADMIN — File operations
--------------------------------------------------------- */
async function deleteFilePrompt(file) {
  const ok = await askConfirm(`"${file.name}" silmək istədiyinizə əminsiniz?`);
  if (!ok) return;
  try {
    await remove(child(itemsRef, `${adminActiveItemId}/files/${file.id}`));
    showToast("Fayl silindi", "success");
    if (file.driveFileId) deleteFromDrive(file.driveFileId);
  } catch (err) {
    console.error(err);
    showToast("Silinərkən xəta baş verdi", "error");
  }
}

async function replaceFilePrompt(oldFile) {
  const input = document.createElement("input");
  input.type = "file";
  input.onchange = async () => {
    const newFile = input.files[0];
    if (!newFile) return;
    const progressId = "replace-" + oldFile.id;
    addProgressRow(progressId, newFile.name, uploadProgressList);
    try {
      const uploaded = await uploadToDrive(newFile, (pct) => updateProgressRow(progressId, pct));
      await update(child(itemsRef, `${adminActiveItemId}/files/${oldFile.id}`), {
        name: newFile.name,
        size: uploaded.size,
        date: Date.now(),
        url: uploaded.downloadUrl,
        viewUrl: uploaded.viewUrl,
        driveFileId: uploaded.id,
        mimeType: uploaded.mimeType
      });
      removeProgressRow(progressId);
      showToast("Fayl yeniləndi", "success");
      if (oldFile.driveFileId) deleteFromDrive(oldFile.driveFileId);
    } catch (err) {
      console.error(err);
      removeProgressRow(progressId);
      showToast(err.message || "Fayl yenilənərkən xəta baş verdi", "error");
    }
  };
  input.click();
}

/* ---------------------------------------------------------
   ADMIN — Per-item file upload (click + drag & drop)
--------------------------------------------------------- */
fileUploadInput.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  e.target.value = "";
  if (!files.length || !adminActiveItemId) return;
  for (const f of files) uploadNewFile(f, uploadProgressList);
});

let dropzoneDragDepth = 0;
if (dropzone) {
  dropzone.addEventListener("dragenter", (e) => { e.preventDefault(); dropzoneDragDepth++; dropzone.classList.add("dropzone-active"); });
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); });
  dropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    dropzoneDragDepth = Math.max(0, dropzoneDragDepth - 1);
    if (dropzoneDragDepth === 0) dropzone.classList.remove("dropzone-active");
  });
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzoneDragDepth = 0;
    dropzone.classList.remove("dropzone-active");
    const files = Array.from(e.dataTransfer?.files || []);
    if (!files.length || !adminActiveItemId) return;
    for (const f of files) uploadNewFile(f, uploadProgressList);
  });
}

async function uploadNewFile(file, progressContainer) {
  const itemId = adminActiveItemId;

  /* ---- Duplicate check in Firebase ---- */
  const item = itemsData[itemId];
  if (item?.files) {
    const dup = Object.values(item.files).find((f) => f.name === file.name);
    if (dup) {
      showToast(`"${file.name}" adlı fayl artıq mövcuddur`, "warning");
      return;
    }
  }
  /* ---- Duplicate check in Google Drive ---- */
  try {
    const existing = await checkDuplicateInDrive(file.name);
    if (existing) {
      showToast(`"${file.name}" adlı fayl Drive-da artıq mövcuddur`, "warning");
      return;
    }
  } catch (_) { /* network issue — proceed anyway */ }

  const progressId = "new-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  addProgressRow(progressId, file.name, progressContainer);
  try {
    const uploaded = await uploadToDrive(file, (pct) => updateProgressRow(progressId, pct));
    const fileId = uid();
    await set(child(itemsRef, `${itemId}/files/${fileId}`), {
      name: file.name,
      size: uploaded.size,
      date: Date.now(),
      url: uploaded.downloadUrl,
      viewUrl: uploaded.viewUrl,
      driveFileId: uploaded.id,
      mimeType: uploaded.mimeType
    });
    removeProgressRow(progressId);
    showToast(`"${file.name}" yükləndi`, "success");
  } catch (err) {
    console.error(err);
    removeProgressRow(progressId);
    showToast(err.message || `"${file.name}" yüklənərkən xəta baş verdi`, "error");
  }
}

/* ---------------------------------------------------------
   ADMIN — Quick add (method card → file → auto-create listener)
--------------------------------------------------------- */
let quickActive = false;
let manualActive = false;

function toggleQuickPanel() {
  manualActive = false;
  if (manualAddPanel) manualAddPanel.classList.remove("open");
  if (manualAddCard) manualAddCard.classList.remove("active");
  quickActive = !quickActive;
  if (quickAddPanel) quickAddPanel.classList.toggle("open", quickActive);
  if (quickAddCard) quickAddCard.classList.toggle("active", quickActive);
}

function toggleManualPanel() {
  quickActive = false;
  if (quickAddPanel) quickAddPanel.classList.remove("open");
  if (quickAddCard) quickAddCard.classList.remove("active");
  manualActive = !manualActive;
  if (manualAddPanel) manualAddPanel.classList.toggle("open", manualActive);
  if (manualAddCard) manualAddCard.classList.toggle("active", manualActive);
}

if (quickAddCard) quickAddCard.addEventListener("click", toggleQuickPanel);
if (manualAddCard) manualAddCard.addEventListener("click", toggleManualPanel);

if (quickFileInput) {
  quickFileInput.addEventListener("change", async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    if (!files.length) return;
    for (const f of files) await quickAddFile(f);
  });
}

let quickDropDragDepth = 0;
if (quickDropzone) {
  quickDropzone.addEventListener("dragenter", (e) => { e.preventDefault(); quickDropDragDepth++; quickDropzone.classList.add("dropzone-active"); });
  quickDropzone.addEventListener("dragover", (e) => { e.preventDefault(); });
  quickDropzone.addEventListener("dragleave", (e) => {
    e.preventDefault();
    quickDropDragDepth = Math.max(0, quickDropDragDepth - 1);
    if (quickDropDragDepth === 0) quickDropzone.classList.remove("dropzone-active");
  });
  quickDropzone.addEventListener("drop", async (e) => {
    e.preventDefault();
    quickDropDragDepth = 0;
    quickDropzone.classList.remove("dropzone-active");
    const files = Array.from(e.dataTransfer?.files || []);
    for (const f of files) await quickAddFile(f);
  });
}

async function quickAddFile(file) {
  const name = file.name.replace(/\.[^.]+$/, "").trim();
  if (!name) {
    showToast("Fayl adı düzgün deyil", "error");
    return;
  }
  const progressId = "quick-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  addProgressRow(progressId, file.name, quickUploadProgress);
  try {
    // Check for duplicate in Google Drive (swallow errors — e.g. Drive not
    // yet connected — so the flow still proceeds to uploadToDrive, which
    // will itself trigger the Google sign-in prompt if needed).
    try {
      const existing = await checkDuplicateInDrive(file.name);
      if (existing) {
        removeProgressRow(progressId);
        showToast(`"${file.name}" adlı fayl artıq mövcuddur — dublikat yaradılmadı`, "warning");
        return;
      }
    } catch (_) { /* Drive not connected yet or network issue — proceed anyway */ }
    const uploaded = await uploadToDrive(file, (pct) => updateProgressRow(progressId, pct));
    const itemId = uid();
    await set(child(itemsRef, itemId), { name, phone: null, email: null, files: {} });
    const fileId = uid();
    await set(child(itemsRef, `${itemId}/files/${fileId}`), {
      name: file.name,
      size: uploaded.size,
      date: Date.now(),
      url: uploaded.downloadUrl,
      viewUrl: uploaded.viewUrl,
      driveFileId: uploaded.id,
      mimeType: uploaded.mimeType
    });
    removeProgressRow(progressId);
    showToast(`"${name}" dinləyici yaradıldı`, "success");
  } catch (err) {
    console.error(err);
    removeProgressRow(progressId);
    showToast(err.message || `"${file.name}" yüklənərkən xəta baş verdi`, "error");
  }
}

/* ---------------------------------------------------------
   ADMIN — Manual add (form → create listener)
--------------------------------------------------------- */
if (manualAddForm) {
  manualAddForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = manualAddName.value.trim();
    if (!name) { manualAddName.focus(); return; }
    manualAddSubmit.disabled = true;
    try {
      const itemId = uid();
      await set(child(itemsRef, itemId), {
        name,
        phone: manualAddPhone.value.trim() || null,
        email: manualAddEmail.value.trim() || null,
        files: {}
      });
      manualAddName.value = "";
      manualAddPhone.value = "";
      manualAddEmail.value = "";
      showToast(`"${name}" dinləyici yaradıldı`, "success");
    } catch (err) {
      console.error(err);
      showToast("Yaradılarkən xəta baş verdi", "error");
    } finally {
      manualAddSubmit.disabled = false;
    }
  });
}

/* ---------------------------------------------------------
   ADMIN — Search / filter
--------------------------------------------------------- */
if (adminSearchInput) {
  adminSearchInput.addEventListener("input", () => {
    adminSearchTerm = adminSearchInput.value;
    if (adminSearchClear) adminSearchClear.classList.toggle("visible", adminSearchTerm.length > 0);
    renderItemsGrid();
  });
}

if (adminSearchClear) {
  adminSearchClear.addEventListener("click", () => {
    adminSearchInput.value = "";
    adminSearchTerm = "";
    adminSearchClear.classList.remove("visible");
    renderItemsGrid();
    adminSearchInput.focus();
  });
}

/* ---------------------------------------------------------
   ADMIN — Exit to user panel
--------------------------------------------------------- */
adminExitBtn.addEventListener("click", () => {
  window.location.href = "index.html";
});

/* ---------------------------------------------------------
   ADMIN — Rename file (Drive + Firebase)
--------------------------------------------------------- */
async function renameFilePrompt(file) {
  const newName = await askRename("Faylın yeni adı", file.name);
  if (!newName || newName === file.name) return;
  try {
    // Rename on Google Drive
    if (file.driveFileId) {
      await renameFileOnDrive(file.driveFileId, newName);
    }
    // Update in Firebase
    await update(child(itemsRef, `${adminActiveItemId}/files/${file.id}`), { name: newName });
    showToast("Fayl adı dəyişdirildi", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Fayl adı dəyişdirilərkən xəta baş verdi", "error");
  }
}

/* ---------------------------------------------------------
   Progress helpers
--------------------------------------------------------- */
function addProgressRow(id, name, container) {
  const row = document.createElement("div");
  row.className = "upload-progress-row";
  row.id = "progress-" + id;
  row.innerHTML = `
    <span class="upload-progress-name">${escapeHtml(name)}</span>
    <div class="upload-progress-bar-track"><div class="upload-progress-bar-fill" style="width:0%"></div></div>
    <span class="progress-pct">0%</span>`;
  container.appendChild(row);
}
function updateProgressRow(id, pct) {
  const row = document.getElementById("progress-" + id);
  if (!row) return;
  row.querySelector(".upload-progress-bar-fill").style.width = pct + "%";
  row.querySelector(".progress-pct").textContent = pct + "%";
}
/* ---------------------------------------------------------
   MERGES — Load, render, and manage merged PDFs from Firebase
--------------------------------------------------------- */
let mergesUnsub = null;

function loadMerges() {
  if (adminMergesLoading) adminMergesLoading.classList.remove("hidden");
  if (adminMergesEmpty) adminMergesEmpty.classList.add("hidden");
  if (adminMergesList) adminMergesList.innerHTML = "";

  // Unsubscribe previous listener
  if (mergesUnsub) { mergesUnsub(); mergesUnsub = null; }

  // Real-time listener on Firebase merges ref using already-imported onValue
  mergesUnsub = onValue(mergesRef, (snapshot) => {
    const data = snapshot.val() || {};
    adminMergeData = data;
    renderMergesList(data);
    if (adminMergesLoading) adminMergesLoading.classList.add("hidden");
  });
}

function renderMergesList(data) {
  const entries = Object.entries(data)
    .map(([id, val]) => ({ id, ...val }))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  if (!adminMergesList || !adminMergesEmpty) return;

  if (entries.length === 0) {
    adminMergesList.innerHTML = "";
    adminMergesEmpty.classList.remove("hidden");
    return;
  }
  adminMergesEmpty.classList.add("hidden");

  adminMergesList.innerHTML = entries.map((m) => {
    const sizeStr = m.size ? formatBytes(m.size) : "Naməlum";
    const dateStr = m.createdAt ? formatDate(m.createdAt) : "Naməlum";
    return \`
      <div class="file-row merge-row" data-id="\${m.id}">
        <div class="file-icon" style="background:#e74c3c22;color:#e74c3c;">
          <svg viewBox="0 0 24 24" fill="none" width="20" height="20"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" stroke="currentColor" stroke-width="1.8"/><path d="M14 2v6h6M10 13l2 2 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
        <div class="file-info">
          <div class="file-name">\${escapeHtml(m.name || "Adsız PDF")}</div>
          <div class="file-meta">\${sizeStr} · \${dateStr}</div>
        </div>
        <div class="file-actions">
          <button class="btn btn-outline btn-sm" data-action="preview" data-id="\${m.id}" title="Bax">Bax</button>
          <button class="btn btn-outline btn-sm" data-action="rename" data-id="\${m.id}" title="Adı dəyiş">Ad dəyiş</button>
          <button class="btn btn-danger btn-sm" data-action="delete" data-id="\${m.id}" title="Sil">Sil</button>
        </div>
      </div>\`;
  }).join("");

  // Wire action buttons
  adminMergesList.querySelectorAll("[data-action]").forEach((btn) => {
    const entry = entries.find((e) => e.id === btn.dataset.id);
    if (!entry) return;
    if (btn.dataset.action === "preview") btn.addEventListener("click", () => previewMergePdf(entry));
    if (btn.dataset.action === "rename") btn.addEventListener("click", () => renameMergePdf(entry));
    if (btn.dataset.action === "delete") btn.addEventListener("click", () => deleteMergePdf(entry));
  });
}

/* ---------------------------------------------------------
   Preview a merged PDF using the preview overlay
--------------------------------------------------------- */
function previewMergePdf(entry) {
  if (!entry.driveFileId) {
    showToast("Bu merge qeydində Drive ID yoxdur", "warning");
    return;
  }
  const fileObj = {
    name: entry.name || "Merge PDF",
    driveFileId: entry.driveFileId,
    viewUrl: "https://drive.google.com/file/d/" + entry.driveFileId + "/preview",
    url: "https://drive.google.com/uc?export=download&id=" + entry.driveFileId
  };
  openPreview(fileObj);
}

/* ---------------------------------------------------------
   Rename a merged PDF (Drive + Firebase)
--------------------------------------------------------- */
async function renameMergePdf(entry) {
  const newName = await askRename("PDF-in yeni adı", entry.name || "");
  if (!newName || newName === entry.name) return;
  try {
    if (entry.driveFileId) {
      await renameFileOnDrive(entry.driveFileId, newName);
    }
    await update(child(mergesRef, entry.id), { name: newName });
    showToast("PDF adı dəyişdirildi", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Ad dəyişdirilərkən xəta baş verdi", "error");
  }
}

/* ---------------------------------------------------------
   Delete a merged PDF (Drive + Firebase)
--------------------------------------------------------- */
async function deleteMergePdf(entry) {
  const ok = await askConfirm(\`"\${entry.name || "Adsız PDF"}" silmək istədiyinizə əminsiniz?\`);
  if (!ok) return;
  try {
    if (entry.driveFileId) {
      await deleteFromDrive(entry.driveFileId);
    }
    await remove(child(mergesRef, entry.id));
    showToast("PDF silindi", "success");
  } catch (err) {
    console.error(err);
    showToast(err.message || "Silinərkən xəta baş verdi", "error");
  }
}

/* ---------------------------------------------------------
   Progress helpers
--------------------------------------------------------- */
function addProgressRow(id, name, container) {
  const row = document.createElement("div");
  row.className = "upload-progress-row";
  row.id = "progress-" + id;
  row.innerHTML = \`
    <span class="upload-progress-name">\${escapeHtml(name)}</span>
    <div class="upload-progress-bar-track"><div class="upload-progress-bar-fill" style="width:0%"></div></div>
    <span class="progress-pct">0%</span>\`;
  container.appendChild(row);
}
function updateProgressRow(id, pct) {
  const row = document.getElementById("progress-" + id);
  if (!row) return;
  row.querySelector(".upload-progress-bar-fill").style.width = pct + "%";
  row.querySelector(".progress-pct").textContent = pct + "%";
}
function removeProgressRow(id) {
  const row = document.getElementById("progress-" + id);
  if (row) row.remove();
}
