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
   Parse a Drive API error response body into a human-readable reason.
--------------------------------------------------------- */
function parseDriveErrorReason(status, body, authLabel) {
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = j.error?.message || j.error?.errors?.[0]?.message || "";
  } catch (_) {}

  console.warn(`[Drive Check] ${authLabel} uğursuz: HTTP ${status}`, detail || body?.slice(0, 300));

  if (status === 400) {
    if (detail.includes("not found") || detail.includes("File not found")) return "File ID tapılmadı — Google Drive-da bu ID ilə fayl mövcud deyil";
    if (detail.includes("API key not valid")) return "API açarı etibarsızdır — Google Cloud Console-da Drive API-nin aktiv olduğunu yoxlayın";
    if (detail.includes("API key expired")) return "API açarının vaxtı keçib";
    if (detail.includes("Bad Request")) return `Google Drive API sorğusu səhvdir (400): ${detail.slice(0, 200)}`;
    if (detail.includes("shared drive") || detail.includes("share drive") || detail.includes("supportsAllDrives")) return "Fayl paylaşılan drive-dadır və supportsAllDrives=true tələb olunur";
    return `Google Drive API xətası (400): ${detail || "sorğu parametrlərini yoxlayın"}`;
  }
  if (status === 403) {
    if (detail.includes("not been enabled")) return "Google Drive API bu proyekt üçün aktiv deyil — Google Cloud Console-da Drive API-ni aktivləşdirin";
    if (detail.includes("permission")) return "Fayl üçün icazə yoxdur (paylaşım ayarları düzgün deyil)";
    if (detail.includes("rate limit") || detail.includes("quota")) return "Google Drive API limiti aşıldı — bir az gözləyin";
    return "Fayl üçün icazə yoxdur (paylaşım ayarları düzgün deyil)";
  }
  if (status === 404) {
    return "Fayl Google Drive-da tapılmadı (silinib və ya ID yanlışdır)";
  }
  if (status === 410) {
    return "Fayl silinib (Gone)";
  }
  return `Google Drive API xətası (${status}): ${detail || "cavab gözlənilməzdir"}`;
}

/* ---------------------------------------------------------
   Pre-flight check: does this Drive file actually exist,
   belong to this id, and is it readable?
   Tries API key first, then OAuth fallback.
   Returns { ok: true, meta } or { ok: false, reason }.
--------------------------------------------------------- */
async function checkDriveFile(driveFileId) {
  if (!driveFileId) {
    console.warn("[Drive Check] fileId boşdur");
    return { ok: false, reason: "Bazada Google Drive ID tapılmadı" };
  }
  if (driveFileId === "null" || driveFileId === "undefined") {
    console.warn("[Drive Check] fileId etibarsızdır:", driveFileId);
    return { ok: false, reason: "Google Drive ID etibarsızdır" };
  }

  console.log(`[Drive Check] Yoxlanılır: fileId=${driveFileId}`);

  // Helper: try a single Drive API request with given auth params
  async function tryCheck(authParams, label) {
    const params = new URLSearchParams({
      fields: "id,name,mimeType,trashed,size",
      supportsAllDrives: "true",
      ...authParams
    });
    const url = `${DRIVE_API}/${driveFileId}?${params.toString()}`;
    console.log(`[Drive Check] ${label}: HTTP sorğusu göndərilir`);
    const res = await fetch(url);
    const body = await res.text().catch(() => "");
    console.log(`[Drive Check] ${label}: HTTP ${res.status}`, body.slice(0, 500));
    return { res, body, status: res.status };
  }

  // Try 1: API key (works for publicly shared files)
  let result = await tryCheck({ key: googleDriveConfig.apiKey }, "API Key");

  if (result.status === 200) {
    const meta = JSON.parse(result.body);
    if (meta.trashed) {
      console.warn(`[Drive Check] Fayl səbətdə: ${driveFileId}`);
      return { ok: false, reason: "Fayl silinib (səbətdədir)" };
    }
    if (meta.mimeType && meta.mimeType !== "application/pdf" && meta.mimeType !== "application/octet-stream") {
      return { ok: false, reason: `Fayl PDF formatında deyil (${meta.mimeType})` };
    }
    console.log(`[Drive Check] ✓ API Key ilə təsdiqləndi: ${meta.name} (${meta.mimeType})`);
    return { ok: true, meta };
  }

  // Try 2: OAuth Bearer token fallback (for non-public files / shared drives)
  const token = await getSilentAccessToken().catch(() => null);
  if (token) {
    console.log("[Drive Check] API Key uğursuz oldu, OAuth ilə cəhd edilir...");
    const params = new URLSearchParams({
      fields: "id,name,mimeType,trashed,size",
      supportsAllDrives: "true"
    });
    const oauthRes = await fetch(`${DRIVE_API}/${driveFileId}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const oauthBody = await oauthRes.text().catch(() => "");
    console.log(`[Drive Check] OAuth: HTTP ${oauthRes.status}`, oauthBody.slice(0, 500));

    if (oauthRes.status === 200) {
      const meta = JSON.parse(oauthBody);
      if (meta.trashed) {
        return { ok: false, reason: "Fayl silinib (səbətdədir)" };
      }
      if (meta.mimeType && meta.mimeType !== "application/pdf" && meta.mimeType !== "application/octet-stream") {
        return { ok: false, reason: `Fayl PDF formatında deyil (${meta.mimeType})` };
      }
      console.log(`[Drive Check] ✓ OAuth ilə təsdiqləndi: ${meta.name}`);
      return { ok: true, meta };
    }

    // Both API key and OAuth failed
    const reason = parseDriveErrorReason(oauthRes.status, oauthBody, "OAuth");
    return { ok: false, reason };
  }

  // No OAuth token — report based on API key error
  const reason = parseDriveErrorReason(result.status, result.body, "API Key");
  return { ok: false, reason };
}

/* ---------------------------------------------------------
   Fetch a PDF's bytes from Google Drive.
   Strategy: OAuth Bearer token first (alt=media requires auth),
   then API key fallback for publicly shared files.
   Returns ArrayBuffer of PDF bytes.
--------------------------------------------------------- */
async function fetchPdfFromDrive(driveFileId) {
  const attempts = [];

  // Attempt 1: OAuth Bearer token (alt=media REQUIRES authentication)
  const token = await getSilentAccessToken().catch(() => null);
  if (token) {
    console.log(`[Drive Fetch] OAuth ilə cəhd edilir: ${driveFileId}`);
    attempts.push({
      url: `${DRIVE_API}/${driveFileId}?alt=media&supportsAllDrives=true`,
      headers: { Authorization: `Bearer ${token}` }
    });
  }

  // Attempt 2: API key (only works for publicly shared files)
  console.log(`[Drive Fetch] API Key ilə cəhd edilir: ${driveFileId}`);
  attempts.push({
    url: `${DRIVE_API}/${driveFileId}?alt=media&supportsAllDrives=true&key=${googleDriveConfig.apiKey}`,
    headers: {}
  });

  let lastError = null;
  for (const attempt of attempts) {
    try {
      const res = await fetch(attempt.url, { headers: attempt.headers });
      console.log(`[Drive Fetch] HTTP ${res.status}`, res.ok ? "OK" : "FAILED");
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        let detail = "";
        try { const j = JSON.parse(body); detail = j.error?.message || ""; } catch (_) {}
        console.warn(`[Drive Fetch] HTTP ${res.status}: ${detail || body?.slice(0, 200)}`);
        lastError = new Error(detail
          ? `Drive-dan endirilə bilmədi (HTTP ${res.status}: ${detail})`
          : `Drive-dan endirilə bilmədi (HTTP ${res.status})`);
        continue;
      }
      const buffer = await res.arrayBuffer();
      if (isValidPdf(buffer)) {
        console.log(`[Drive Fetch] ✓ PDF uğurla endirildi (${buffer.byteLength} bayt)`);
        return buffer;
      }
      console.warn(`[Drive Fetch] Alınan fayl PDF formatında deyil (${buffer.byteLength} bayt)`);
      lastError = new Error("Alınan fayl PDF formatında deyil");
    } catch (err) {
      console.warn(`[Drive Fetch] Şəbəkə xətası:`, err);
      lastError = err;
    }
  }

  console.error(`[Drive Fetch] Bütün cəhdlər uğursuz oldu`);
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

  console.log(`[Merge] ${files.length} fayl birləşdirilir:`, files.map(f => `${f.listenerName} (${f.driveFileId})`));

  // Selection order is preserved because we iterate `files` in place —
  // page ranges land in the merged PDF in exactly the order listeners
  // were selected in (e.g. Arif then Qasım => Arif's pages first).
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const label = file.listenerName || file.name;
    if (onProgress) onProgress(i, files.length, label);

    // Step 1: does the referenced Drive file actually exist / belong
    // to this listener / is readable?
    console.log(`[Merge] Yoxlanılır (${i + 1}/${files.length}): ${label} — fileId=${file.driveFileId}`);
    const check = await checkDriveFile(file.driveFileId);
    if (!check.ok) {
      console.warn(`[Merge] ➜ Atlanır (${label}): ${check.reason}`);
      skipped.push({ name: label, reason: check.reason });
      continue;
    }

    try {
      console.log(`[Merge] Endirilir: ${label} (${file.driveFileId})`);
      const pdfBytes = await fetchPdfFromDrive(file.driveFileId);
      const pdf = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
      const pageIndices = pdf.getPageIndices();
      console.log(`[Merge] ✓ ${label}: ${pageIndices.length} səhifə əlavə edilir`);
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
      console.warn(`[Merge] ➜ Atlanır (${label}):`, err);
      skipped.push({ name: label, reason });
    }
  }

  if (onProgress) onProgress(files.length, files.length, "");

  if (mergedPdf.getPageCount() === 0) {
    console.error(`[Merge] Bütün fayllar uğursuz oldu:`, skipped);
    const details = skipped.map((s) => `${s.name} — ${s.reason}`).join("; ");
    throw new Error(
      "Birləşdirilə bilən PDF sənədi tapılmadı." + (details ? ` (${details})` : "")
    );
  }

  const mergedBytes = await mergedPdf.save();
  console.log(`[Merge] ✓ ${mergedPdf.getPageCount()} səhifə, ${mergedBytes.length} bayt. Atlanan: ${skipped.length}`);
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
