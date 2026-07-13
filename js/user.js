/* ===========================================================
   IST Trust Zone — User Panel logic (index.html)
   Coded and shipped completely separately from the Admin
   Panel (admin.html / js/admin.js). Both pages talk to the
   same Firebase Realtime Database via js/shared.js, so any
   change an admin makes shows up here instantly, with no
   page reload — and vice versa.
=========================================================== */
import { ADMIN_TRIGGER_CODE } from "./firebase-config.js";
import {
  subscribeItems, getSortedItems, getFilesOf,
  escapeHtml, formatBytes, formatDate, getExtension,
  FILE_COLOR_MAP, openPreview, initPreviewOverlay, triggerDownload, showToast,
  saveMergeRecord
} from "./shared.js";
import { initThemeSwitch } from "./theme.js";
import { hasValidSession, login } from "./auth.js";

import { mergePdfs, downloadMergedPdf, createMergedPdfPreviewUrl, uploadMergedPdfToDrive } from "./pdf-merge.js";
initThemeSwitch("theme-switch");

/* ---------------------------------------------------------
   Splash screen + site login gate
   The splash always shows for a minimum, pleasant duration;
   once it's done we either reveal the User Panel directly
   (valid session already stored) or show the login screen.
--------------------------------------------------------- */
const splashScreen = document.getElementById("splash-screen");
const loginScreen = document.getElementById("login-screen");
const loginCard = document.getElementById("login-card");
const loginForm = document.getElementById("login-form");
const loginPassword = document.getElementById("login-password");
const loginSubmit = document.getElementById("login-submit");
const loginError = document.getElementById("login-error");
const userPanel = document.getElementById("user-panel");

const SPLASH_MIN_MS = 1300;

function revealApp() {
  loginScreen.classList.add("hidden");
  userPanel.classList.remove("hidden");
}

function showLoginScreen() {
  loginScreen.classList.remove("hidden");
  setTimeout(() => loginPassword.focus(), 350);
}

(async function bootAuth() {
  const splashStart = Date.now();
  let sessionValid = false;
  try {
    sessionValid = await hasValidSession();
  } catch (err) {
    console.error(err);
  }
  const elapsed = Date.now() - splashStart;
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    splashScreen.classList.add("splash-hidden");
    if (sessionValid) {
      revealApp();
    } else {
      showLoginScreen();
    }
  }, wait);
})();

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = loginPassword.value;
  if (!password) return;
  loginSubmit.disabled = true;
  loginError.textContent = "";
  try {
    const ok = await login(password);
    if (ok) {
      loginPassword.value = "";
      revealApp();
    } else {
      loginError.textContent = "Yanlış şifrə. Yenidən cəhd edin.";
      loginCard.classList.remove("shake");
      void loginCard.offsetWidth;
      loginCard.classList.add("shake");
      loginPassword.select();
    }
  } catch (err) {
    console.error(err);
    loginError.textContent = "Giriş zamanı xəta baş verdi. Yenidən cəhd edin.";
  } finally {
    loginSubmit.disabled = false;
  }
});

/* ---------------------------------------------------------
   State
--------------------------------------------------------- */
let itemsData = {};
let activeItemId = null;
let userSearchTerm = "";

/* ---------------------------------------------------------
   DOM references
--------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

const userSearchInput = $("user-search");
const searchContainer = $("search-wrap");
const userSearchClear = $("user-search-clear");
const itemsGrid = $("items-grid");
const itemsEmpty = $("items-empty");
const itemsEmptyInitial = $("items-empty-initial");

const itemDetail = $("item-detail");
const itemDetailTitle = $("item-detail-title");
const itemDetailContact = $("item-detail-contact");
const itemDetailFiles = $("item-detail-files");
const itemDetailEmpty = $("item-detail-empty");
const itemDetailClose = $("item-detail-close");

function phoneIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.5 3 4 5.4 6.9 6.9l2.3-2.3c.3-.3.7-.4 1.1-.2 1.2.4 2.5.6 3.8.6.6 0 1 .4 1 1V20.5c0 .6-.4 1-1 1C10.5 21.5 2.5 13.5 2.5 3.3c0-.6.4-1 1-1H7.2c.6 0 1 .4 1 1 0 1.3.2 2.6.6 3.8.1.4 0 .8-.3 1.1L6.6 10.8Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}
function mailIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none"><rect x="2.5" y="4.5" width="19" height="15" rx="2.2" stroke="currentColor" stroke-width="1.6"/><path d="M3.5 6.5l8.5 6.5 8.5-6.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

initPreviewOverlay();

/* ---------------------------------------------------------
   Realtime data subscription — this is what keeps this page
   perfectly synced with the Admin Panel in realtime.
--------------------------------------------------------- */
subscribeItems((data) => {
  itemsData = data;
  renderUserGrid();
  renderItemDetailIfOpen();
});

/* ---------------------------------------------------------
   Items grid
--------------------------------------------------------- */
function itemIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M14 3v5h5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
}

function renderUserGrid() {
  const all = getSortedItems(itemsData);
  const term = userSearchTerm.trim().toLowerCase();
  const filtered = term ? all.filter((it) => (it.name || "").toLowerCase().includes(term)) : all;

  itemsGrid.innerHTML = filtered.map((it) => {
    const count = it.files ? Object.keys(it.files).length : 0;
    return `
      <button class="item-card" data-id="${it.id}">
        <div class="item-card-icon">${itemIconSvg()}</div>
        <div class="item-card-name">${escapeHtml(it.name)}</div>
        <div class="item-card-count">${count} sənəd</div>
      </button>`;
  }).join("");

  itemsGrid.querySelectorAll(".item-card").forEach((btn) => {
    btn.addEventListener("click", () => openItemDetail(btn.dataset.id));
  });

  const hasAny = all.length > 0;
  itemsEmptyInitial.classList.toggle("hidden", hasAny);
  itemsEmpty.classList.toggle("hidden", !(hasAny && term && filtered.length === 0));
  itemsGrid.classList.toggle("hidden", filtered.length === 0);
}

/* ---------------------------------------------------------
   Item detail overlay
--------------------------------------------------------- */
function fileRowHtml(file) {
  const ext = getExtension(file.name);
  const bgColor = FILE_COLOR_MAP[ext] || "#4c7aa3";
  return `
    <div class="file-row" data-id="${file.id}">
      <div class="file-icon" style="background:${bgColor}">${ext.slice(0, 4)}</div>
      <div class="file-info">
        <div class="file-name">${escapeHtml(file.name)}</div>
        <div class="file-meta">${formatBytes(file.size)} · ${formatDate(file.date)}</div>
      </div>
      <div class="file-actions">
        <button class="btn btn-outline btn-sm" data-action="preview" data-id="${file.id}">Bax</button>
        <button class="btn btn-primary btn-sm" data-action="download" data-id="${file.id}">Yüklə</button>
      </div>
    </div>`;
}

function openItemDetail(itemId) {
  activeItemId = itemId;
  itemDetail.classList.remove("hidden");
  renderItemDetailIfOpen();
}

function closeItemDetail() {
  itemDetail.classList.add("hidden");
  activeItemId = null;
}

function renderItemDetailIfOpen() {
  if (!activeItemId) return;
  const item = itemsData[activeItemId];
  if (!item) { closeItemDetail(); return; }
  itemDetailTitle.textContent = item.name || "";
  const pills = [];
  if (item.phone) pills.push(`<span class="contact-pill">${phoneIconSvg()}${escapeHtml(item.phone)}</span>`);
  if (item.email) pills.push(`<span class="contact-pill">${mailIconSvg()}${escapeHtml(item.email)}</span>`);
  itemDetailContact.innerHTML = pills.join("");
  const files = getFilesOf(itemsData, activeItemId);
  itemDetailFiles.innerHTML = files.map((f) => fileRowHtml(f)).join("");
  itemDetailEmpty.classList.toggle("hidden", files.length > 0);

  itemDetailFiles.querySelectorAll("[data-action]").forEach((btn) => {
    const file = files.find((f) => f.id === btn.dataset.id);
    if (!file) return;
    if (btn.dataset.action === "preview") btn.addEventListener("click", () => openPreview(file));
    if (btn.dataset.action === "download") btn.addEventListener("click", () => triggerDownload(file));
  });
}

/* Click-to-copy for contact pills */
itemDetailContact.addEventListener("click", (e) => {
  const pill = e.target.closest(".contact-pill");
  if (!pill) return;
  const text = pill.textContent.trim();
  if (text && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      showToast("Kopyalandı: " + text, "success");
    }).catch(() => {});
  }
});

itemDetailClose.addEventListener("click", closeItemDetail);
itemDetail.addEventListener("click", (e) => { if (e.target === itemDetail) closeItemDetail(); });

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !itemDetail.classList.contains("hidden")) closeItemDetail();
});

/* ---------------------------------------------------------
   Search + secret admin trigger
   Typing the code and pressing Enter takes the user to the
   separately-coded admin.html — a full navigation, not just
   a hidden panel toggle.
--------------------------------------------------------- */
userSearchInput.addEventListener("input", () => {
  userSearchTerm = userSearchInput.value;
  if (userSearchClear) userSearchClear.classList.toggle("visible", userSearchTerm.length > 0);
  renderUserGrid();
});

if (userSearchClear) {
  userSearchClear.addEventListener("click", () => {
    userSearchInput.value = "";
    userSearchTerm = "";
    if (userSearchClear) userSearchClear.classList.remove("visible");
    renderUserGrid();
    userSearchInput.focus();
  });
}

userSearchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && userSearchInput.value.trim() === ADMIN_TRIGGER_CODE) {
    userSearchInput.value = "";
    userSearchInput.blur();
    window.location.href = "admin.html";
  }
});

/* ==========================================================
   MERGE PDF — Client-side PDF merge feature
   ========================================================== */

const mergeBtn = $("merge-pdf-btn");
const mergeOverlay = $("merge-pdf-overlay");
const mergeClose = $("merge-pdf-close");
const mergeStep1 = $("merge-step-1");
const mergeStep2 = $("merge-step-2");
const mergeStep3 = $("merge-step-3");
const mergeStep4 = $("merge-step-4");
const mergeStep5 = $("merge-step-5");
const mergeSearch = $("merge-search");
const mergeListenersList = $("merge-listeners-list");
const mergeSelectedCount = $("merge-selected-count");
const mergeNextBtn = $("merge-next-btn");
const mergeOutputName = $("merge-output-name");
const mergeBackBtn = $("merge-back-btn");
const mergeStartBtn = $("merge-start-btn");
const mergeProgressBar = $("merge-progress-bar");
const mergeProgressText = $("merge-progress-text");
const mergePreviewFrame = $("merge-preview-frame");
const mergePreviewWarning = $("merge-preview-warning");
const mergePreviewBackBtn = $("merge-preview-back-btn");
const mergeDownloadBtn = $("merge-download-btn");
const mergeUploadStatus = $("merge-upload-status");
const mergeDoneText = $("merge-done-text");
const mergeCloseDoneBtn = $("merge-close-done-btn");

let mergeSelectedIds = new Set();
let mergeSearchTerm = "";

// Holds the merged PDF between the "Preview" and "Yüklə" steps.
let pendingMerge = null; // { bytes, outputName, previewUrl, listenerIds, listenerNames, skipped }

function openMergeOverlay() {
  mergeSelectedIds.clear();
  mergeSearchTerm = "";
  if (mergeSearch) mergeSearch.value = "";
  discardPendingMerge();
  showMergeStep(1);
  renderMergeListeners();
  mergeOverlay.classList.remove("hidden");
}

function closeMergeOverlay() {
  mergeOverlay.classList.add("hidden");
  discardPendingMerge();
}

function discardPendingMerge() {
  if (pendingMerge?.previewUrl) URL.revokeObjectURL(pendingMerge.previewUrl);
  pendingMerge = null;
  if (mergePreviewFrame) mergePreviewFrame.src = "about:blank";
}

function showMergeStep(step) {
  [mergeStep1, mergeStep2, mergeStep3, mergeStep4, mergeStep5].forEach((el, i) => {
    if (el) el.classList.toggle("hidden", i + 1 !== step);
  });
}

function renderMergeListeners() {
  const all = getSortedItems(itemsData);
  const term = mergeSearchTerm.trim().toLowerCase();
  const filtered = term ? all.filter((it) => (it.name || "").toLowerCase().includes(term)) : all;

  mergeListenersList.innerHTML = filtered.map((it) => {
    const count = it.files ? Object.keys(it.files).length : 0;
    const hasPdfs = it.files ? Object.values(it.files).some((f) => (f.name || "").toLowerCase().endsWith(".pdf") && f.driveFileId) : false;
    const checked = mergeSelectedIds.has(it.id);
    return `
      <label class="merge-listener-item ${checked ? 'selected' : ''} ${!hasPdfs ? 'no-pdf' : ''}" data-id="${it.id}">
        <input type="checkbox" class="merge-checkbox" data-id="${it.id}" ${checked ? 'checked' : ''} ${!hasPdfs ? 'disabled title="Bu dinləyicidə PDF yoxdur"' : ''}>
        <div class="merge-listener-info">
          <span class="merge-listener-name">${escapeHtml(it.name)}</span>
          <span class="merge-listener-count">${count} sənəd${hasPdfs ? '' : ' (PDF yoxdur)'}</span>
        </div>
        ${checked ? '<span class="merge-check-icon">✔</span>' : ''}
      </label>`;
  }).join("");

  // Toggle selection on item click (not just checkbox)
  mergeListenersList.querySelectorAll(".merge-listener-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      if (e.target.tagName === "INPUT") return; // Let checkbox handle itself
      const cb = item.querySelector(".merge-checkbox");
      if (cb && !cb.disabled) {
        cb.checked = !cb.checked;
        toggleMergeSelection(cb.dataset.id, cb.checked);
      }
    });
  });

  // Checkbox change handler
  mergeListenersList.querySelectorAll(".merge-checkbox").forEach((cb) => {
    cb.addEventListener("change", () => {
      toggleMergeSelection(cb.dataset.id, cb.checked);
    });
  });

  updateMergeSelectedCount();
}

function toggleMergeSelection(id, checked) {
  if (checked) mergeSelectedIds.add(id);
  else mergeSelectedIds.delete(id);
  updateMergeSelectedCount();
  // Re-render to update visual state
  renderMergeListeners();
}

function updateMergeSelectedCount() {
  const count = mergeSelectedIds.size;
  if (mergeSelectedCount) {
    mergeSelectedCount.textContent = count > 0 ? `${count} dinləyici seçildi` : "";
  }
  if (mergeNextBtn) {
    mergeNextBtn.disabled = count === 0;
  }
}

// Search handler
if (mergeSearch) {
  mergeSearch.addEventListener("input", () => {
    mergeSearchTerm = mergeSearch.value;
    renderMergeListeners();
  });
}

// Next button → step 2
if (mergeNextBtn) {
  mergeNextBtn.addEventListener("click", () => {
    if (mergeSelectedIds.size === 0) return;
    // Suggest a default name
    if (mergeOutputName) {
      const names = [...mergeSelectedIds].map((id) => itemsData[id]?.name || "").filter(Boolean);
      mergeOutputName.value = names.length === 1 ? names[0] + " - Birləşmiş" : "Birləşmiş PDF";
    }
    showMergeStep(2);
    if (mergeOutputName) mergeOutputName.focus();
  });
}

// Back button → step 1
if (mergeBackBtn) {
  mergeBackBtn.addEventListener("click", () => showMergeStep(1));
}

// Start merge → step 3 (progress) → step 4 (preview)
if (mergeStartBtn) {
  mergeStartBtn.addEventListener("click", async () => {
      const outputName = mergeOutputName?.value.trim();
      if (!outputName) {
        showToast("PDF adı daxil edin", "error");
        return;
      }

      showMergeStep(3);
      if (mergeProgressBar) mergeProgressBar.style.width = "0%";
      if (mergeProgressText) mergeProgressText.textContent = "Hazırlanır...";

      // Collect ONE PDF per selected listener, preserving the exact
      // order the user selected them in (this order is what decides
      // the page order of the final merged PDF).
      const pdfFiles = [];
      const listenerIds = [];
      const listenerNames = [];
      const missingPdfListeners = [];

      // === PRE-MERGE DIAGNOSTICS ===
      // Log all selected listeners and their PDF file details to console
      // so Google Drive API errors can be traced back to specific files.
      console.group("[Merge] Seçilmiş dinləyicilərin PDF yoxlanışı");
      console.log("Seçilmiş ID-lər:", mergeSelectedIds);

      for (const itemId of mergeSelectedIds) {
        const item = itemsData[itemId];
        if (!item) {
          console.warn(`[Merge] Dinləyici tapılmadı: ${itemId}`);
          missingPdfListeners.push("Naməlum (ID: " + itemId + ")");
          continue;
        }
        console.log(`[Merge] ${item.name} (${itemId})`);

        if (!item.files || Object.keys(item.files).length === 0) {
          console.warn(`[Merge]   ➜ Fayl yoxdur`);
          missingPdfListeners.push(item.name);
          continue;
        }

        // Get files sorted by date (most recent first), find the first PDF
        const files = getFilesOf(itemsData, itemId);
        console.log(`[Merge]   Cəmi fayl: ${files.length}`);

        const pdf = files.find((f) => (f.name || "").toLowerCase().endsWith(".pdf") && f.driveFileId);
        if (pdf) {
          console.log(`[Merge]   ✓ PDF tapıldı: "${pdf.name}"`);
          console.log(`[Merge]     driveFileId: ${pdf.driveFileId}`);
          console.log(`[Merge]     mimeType: ${pdf.mimeType || "bilinmir"}`);
          console.log(`[Merge]     size: ${pdf.size || "bilinmir"} bayt`);
          console.log(`[Merge]     tarix: ${new Date(pdf.date).toLocaleString("az-AZ")}`);
          pdfFiles.push({
            driveFileId: pdf.driveFileId,
            name: pdf.name,
            listenerName: item.name,
          });
          listenerIds.push(itemId);
          listenerNames.push(item.name);
        } else {
          const hasPdfName = files.some(f => (f.name || "").toLowerCase().endsWith(".pdf"));
          const hasDriveId = files.some(f => f.driveFileId);
          console.warn(`[Merge]   ✗ PDF tapılmadı`);
          if (!hasPdfName) console.warn(`[Merge]     Səbəb: heç bir fayl .pdf uzantılı deyil`);
          if (!hasDriveId) console.warn(`[Merge]     Səbəb: heç bir faylın driveFileId-si yoxdur`);
          if (hasPdfName && !files.find(f => (f.name || "").toLowerCase().endsWith(".pdf") && f.driveFileId)) {
            console.warn(`[Merge]     Səbəb: PDF faylları var, lakin driveFileId boşdur (köhnə yükləmələr)`);
          }
          missingPdfListeners.push(item.name || "Naməlum");
        }
      }
      console.log("[Merge] Birləşdiriləcək fayllar:", pdfFiles.length);
      console.groupEnd();

      // Warn about listeners without PDFs
      if (missingPdfListeners.length > 0) {
        showToast(
          `${missingPdfListeners.length} dinləyicidə PDF tapılmadı: ${missingPdfListeners.join(", ")}`,
          "warning"
        );
      }

      if (pdfFiles.length === 0) {
        showToast("Seçilmiş dinləyicilərdə PDF sənədi tapılmadı", "error");
        showMergeStep(1);
        return;
      }

      try {
        const { mergedBytes, skipped } = await mergePdfs(pdfFiles, (current, total, fileName) => {
          if (mergeProgressBar) mergeProgressBar.style.width = Math.round((current / total) * 100) + "%";
          if (mergeProgressText) {
            if (current < total) {
              mergeProgressText.textContent = `Yoxlanılır və endirilir: ${fileName} (${current + 1}/${total})`;
            } else {
              mergeProgressText.textContent = "PDF birləşdirilir...";
            }
          }
        });

        // Every listener whose PDF couldn't be merged, and *why* —
        // shown to the user before they confirm the download.
        if (skipped.length > 0) {
          showToast(
            `${skipped.length} fayl birləşdirilmədi: ` +
              skipped.map((s) => `${s.name} (${s.reason})`).join(", "),
            "warning"
          );
        }

        discardPendingMerge();
        const previewUrl = createMergedPdfPreviewUrl(mergedBytes);
        pendingMerge = { bytes: mergedBytes, outputName, previewUrl, listenerIds, listenerNames, skipped };

        if (mergePreviewFrame) mergePreviewFrame.src = previewUrl;
        if (mergePreviewWarning) {
          if (skipped.length > 0) {
            mergePreviewWarning.textContent =
              `Diqqət: ${skipped.length} dinləyicinin sənədi əlavə olunmadı — ` +
              skipped.map((s) => `${s.name}: ${s.reason}`).join("; ");
            mergePreviewWarning.classList.remove("hidden");
          } else {
            mergePreviewWarning.classList.add("hidden");
          }
        }
        if (mergeUploadStatus) mergeUploadStatus.classList.add("hidden");
        if (mergeDownloadBtn) { mergeDownloadBtn.disabled = false; mergeDownloadBtn.textContent = "Yüklə"; }

        showMergeStep(4);
      } catch (err) {
        console.error("Merge xətası:", err);
        showToast(err.message || "PDF birləşdirilməsində xəta baş verdi", "error");
        showMergeStep(1);
      }
    });
}

// Preview step "Geri" → back to naming step (merge already computed
// in-memory; nothing is lost, user can just retry with a new name)
if (mergePreviewBackBtn) {
  mergePreviewBackBtn.addEventListener("click", () => {
    discardPendingMerge();
    showMergeStep(2);
  });
}

// "Yüklə" in the preview step: download locally, upload the same
// PDF to the "IstServices Merge Pdf" Drive folder, then write the
// Drive fileId/link + listener metadata into the database so Drive
// and the DB stay in sync.
if (mergeDownloadBtn) {
  mergeDownloadBtn.addEventListener("click", async () => {
    if (!pendingMerge) return;
    const { bytes, outputName, listenerIds, listenerNames } = pendingMerge;

    mergeDownloadBtn.disabled = true;
    mergeDownloadBtn.textContent = "Yüklənir...";

    // 1) Local download — always happens, regardless of Drive outcome.
    downloadMergedPdf(bytes, outputName);

    // 2) Upload the same bytes to Google Drive + sync the database.
    if (mergeUploadStatus) {
      mergeUploadStatus.classList.remove("hidden");
      mergeUploadStatus.textContent = "Google Drive-a yüklənir...";
    }
    try {
      const uploaded = await uploadMergedPdfToDrive(bytes, outputName, (pct) => {
        if (mergeUploadStatus) mergeUploadStatus.textContent = `Google Drive-a yüklənir... ${pct}%`;
      });

      await saveMergeRecord({
        name: uploaded.name,
        driveFileId: uploaded.id,
        driveLink: uploaded.webViewLink,
        size: uploaded.size,
        listenerIds,
        listenerNames,
      });

      if (mergeUploadStatus) mergeUploadStatus.textContent = "Google Drive ilə sinxronlaşdırıldı ✓";
      if (mergeDoneText) mergeDoneText.textContent = "PDF uğurla birləşdirildi və Google Drive-a yükləndi!";
    } catch (err) {
      console.warn("Merge Drive sinxronizasiyası uğursuz oldu:", err);
      if (mergeUploadStatus) mergeUploadStatus.textContent = "";
      showToast("Fayl endirildi, lakin Google Drive-a yüklənmədi: " + (err.message || ""), "warning");
      if (mergeDoneText) mergeDoneText.textContent = "PDF endirildi (Google Drive sinxronizasiyası olmadan).";
    }

    mergeDownloadBtn.disabled = false;
    mergeDownloadBtn.textContent = "Yüklə";
    showMergeStep(5);
  });
}

// Close handlers
if (mergeClose) mergeClose.addEventListener("click", closeMergeOverlay);
if (mergeOverlay) mergeOverlay.addEventListener("click", (e) => { if (e.target === mergeOverlay) closeMergeOverlay(); });
if (mergeCloseDoneBtn) mergeCloseDoneBtn.addEventListener("click", closeMergeOverlay);

// Open on button click
if (mergeBtn) mergeBtn.addEventListener("click", openMergeOverlay);
