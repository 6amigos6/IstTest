/* ===========================================================
   IST Trust Zone — PDF Merge (client-side)
   Uses pdf-lib to merge multiple PDFs without any server.

   ROOT-CAUSE NOTES (why "Birləşdirilə bilən PDF sənədi tapılmadı"
   happened, and how this file fixes it):

   1. The old code tried 3 "strategies" to fetch each PDF, but
      strategies #2 and #3 (raw https://drive.google.com/uc?...
      URLs) can NEVER succeed from browser JS: drive.google.com
      does not send Access-Control-Allow-Origin headers, so the
      fetch() call is blocked by CORS before it even reaches the
      network tab. They were dead code that only added latency.
      The only strategy that can ever work from a browser is the
      official Drive REST API (googleapis.com), which does
      support CORS — this is also exactly what shared.js's
      triggerDownload() already relies on elsewhere in this app.

   2. Every failure (missing DB record, deleted file, revoked
      share permission, corrupted PDF, wrong mime type, etc.) was
      collapsed into one generic "skipped" bucket with no reason,
      so there was no way to tell *why* zero pages got merged.
      This file now runs an explicit pre-flight check per file
      (checkDriveFile) and keeps a human-readable reason for
      every skipped listener.

   3. There was no fallback for the case where the file's public
      share permission failed to apply at upload time. This file
      adds an authenticated OAuth fallback (via drive.js) when an
      access token already exists in this browser.
========================================================== */
import { googleDriveConfig } from "./firebase-config.js";
import { getSilentAccessToken, uploadMergedPdf } from "./drive.js";

const DRIVE_API = "https://www.googleapis.com/drive/v3/files";

/* ---------------------------------------------------------
   Lazy-load pdf-lib from CDN (only when merge is triggered)
--------------------------------------------------------- */
let pdfLibPromise = null;
function loadPdfLib() {
  if (!pdfLibPromise) {
    pdfLibPromise = new Promise((resolve, reject) => {
      if (window.PDFLib) { resolve(window.PDFLib); return; }
      const script = document.createElement("script");
      script.src = "https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js";
      script.onload = () => {
        if (window.PDFLib) resolve(window.PDFLib);
        else reject(new Error("pdf-lib yüklənə bilmədi"));
      };
      script.onerror = () => reject(new Error("pdf-lib CDN-dən yüklənə bilmədi. İnternet bağlantısını yoxlayın."));
      document.head.appendChild(script);
    });
  }
  return pdfLibPromise;
}

/* ---------------------------------------------------------
   Validate PDF by checking magic bytes (%PDF)
--------------------------------------------------------- */
function isValidPdf(buffer) {
  if (!buffer || buffer.byteLength < 4) return false;
  const h = new Uint8Array(buffer.slice(0, 5));
  return h[0] === 0x25 && h[1] === 0x50 && h[2] === 0x44 && h[3] === 0x46;
}

/* ---------------------------------------------------------
   Pre-flight check: does this Drive file actually exist,
   belong to this id, and is it readable?
   Returns { ok: true, meta } or { ok: false, reason }.
--------------------------------------------------------- */
async function checkDriveFile(driveFileId) {
  if (!driveFileId) {
    return { ok: false, reason: "Bazada Google Drive ID tapılmadı" };
  }
  let res;
  try {
    res = await fetch(
      `${DRIVE_API}/${driveFileId}?fields=id,name,mimeType,trashed,size&key=${googleDriveConfig.apiKey}`
    );
  } catch (err) {
    return { ok: false, reason: "Şəbəkə xətası: fayl mövcudluğu yoxlanıla bilmədi" };
  }
  if (res.status === 404) {
    return { ok: false, reason: "Fayl Google Drive-da tapılmadı (silinib və ya ID yanlışdır)" };
  }
  if (res.status === 403) {
    return { ok: false, reason: "Fayl üçün icazə yoxdur (paylaşım ayarları düzgün deyil)" };
  }
  if (!res.ok) {
    return { ok: false, reason: `Google Drive API xətası (${res.status})` };
  }
  const meta = await res.json().catch(() => null);
  if (!meta) {
    return { ok: false, reason: "Fayl məlumatı oxuna bilmədi" };
  }
  if (meta.trashed) {
    return { ok: false, reason: "Fayl silinib (səbətdədir)" };
  }
  if (meta.mimeType && meta.mimeType !== "application/pdf" && meta.mimeType !== "application/octet-stream") {
    return { ok: false, reason: `Fayl PDF formatında deyil (${meta.mimeType})` };
  }
  return { ok: true, meta };
}

/* ---------------------------------------------------------
   Fetch a PDF's bytes from Google Drive.
   Attempt 1: Drive API v3 with the app's API key — this is
              the only endpoint that supports CORS for browser
              fetch(), and is proven to work elsewhere in this
              app (see shared.js -> triggerDownload).
   Attempt 2: If a Drive OAuth token already exists in this
              browser (admin previously connected Drive), retry
              authenticated as a fallback for files whose public
              share permission failed to apply.
--------------------------------------------------------- */
async function fetchPdfFromDrive(driveFileId) {
  const attempts = [
    { url: `${DRIVE_API}/${driveFileId}?alt=media&key=${googleDriveConfig.apiKey}`, headers: {} },
  ];

  const token = await getSilentAccessToken().catch(() => null);
  if (token) {
    attempts.push({
      url: `${DRIVE_API}/${driveFileId}?alt=media`,
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: attempt.headers });
      if (!res.ok) {
        lastError = new Error(`Drive-dan endirilə bilmədi (HTTP ${res.status})`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (isValidPdf(buffer)) return buffer;
      lastError = new Error("Alınan fayl PDF formatında deyil");
    } catch (err) {
      lastError = err;
    }
  }

  throw lastError || new Error("PDF yüklənə bilmədi");
}

/* ---------------------------------------------------------
   Merge multiple PDFs into one, preserving selection order.
   files: Array of { driveFileId, name, listenerName }, already
          in the order the user selected the listeners in.
   onProgress: callback(current, total, fileName)
   Returns: { mergedBytes, skipped: [{ name, reason }] }
   Throws with a detailed, itemised message if nothing merged.
--------------------------------------------------------- */
export async function mergePdfs(files, onProgress) {
  const PDFLib = await loadPdfLib();
  const { PDFDocument } = PDFLib;

  const mergedPdf = await PDFDocument.create();
  const skipped = [];

  // Selection order is preserved because we iterate `files` in place —
  // page ranges land in the merged PDF in exactly the order listeners
  // were selected in (e.g. Arif then Qasım => Arif's pages first).
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = file.listenerName || file.name;
    if (onProgress) onProgress(i, files.length, label);

    // Step 1: does the referenced Drive file actually exist / belong
    // to this listener / is readable? (fixes silent generic failures)
    const check = await checkDriveFile(file.driveFileId);
    if (!check.ok) {
      console.warn(`Merge-ə daxil edilmədi (${label}): ${check.reason}`);
      skipped.push({ name: label, reason: check.reason });
      continue;
    }

    try {
      const pdfBytes = await fetchPdfFromDrive(file.driveFileId);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageIndices = pdf.getPageIndices();
      if (pageIndices.length === 0) {
        skipped.push({ name: label, reason: "PDF-də səhifə yoxdur" });
        continue;
      }
      const copiedPages = await mergedPdf.copyPages(pdf, pageIndices);
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    } catch (err) {
      const reason = /encrypt/i.test(err.message || "")
        ? "PDF şifrələnib və açıla bilmədi"
        : (err.message || "PDF oxuna bilmədi (zədələnmiş fayl?)");
      console.warn(`Merge-ə daxil edilmədi (${label}):`, err);
      skipped.push({ name: label, reason });
    }
  }

  if (onProgress) onProgress(files.length, files.length, "");

  if (mergedPdf.getPageCount() === 0) {
    const details = skipped.map((s) => `${s.name} — ${s.reason}`).join("; ");
    throw new Error(
      "Birləşdirilə bilən PDF sənədi tapılmadı." + (details ? ` (${details})` : "")
    );
  }

  const mergedBytes = await mergedPdf.save();
  return { mergedBytes, skipped };
}

/* ---------------------------------------------------------
   Trigger download of a merged PDF
--------------------------------------------------------- */
export function downloadMergedPdf(pdfBytes, fileName) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.endsWith(".pdf") ? fileName : fileName + ".pdf";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* ---------------------------------------------------------
   Build a blob: URL for the merged PDF, for in-app preview
   (native browser PDF viewer — gives paging + zoom for free).
   Caller is responsible for calling URL.revokeObjectURL later.
--------------------------------------------------------- */
export function createMergedPdfPreviewUrl(pdfBytes) {
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  return URL.createObjectURL(blob);
}

/* ---------------------------------------------------------
   Upload the merged PDF into the shared "IstServices Merge Pdf"
   Drive folder (auto-created if missing) and return its Drive
   file info, ready to be written into the database.
--------------------------------------------------------- */
export async function uploadMergedPdfToDrive(pdfBytes, fileName, onProgress) {
  const name = fileName.endsWith(".pdf") ? fileName : fileName + ".pdf";
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  return uploadMergedPdf(blob, name, onProgress);
}
