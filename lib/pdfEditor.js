const fs = require('fs');
const { PDFDocument, StandardFonts, degrees, rgb } = require('pdf-lib');

/**
 * PDF 編輯功能（旋轉/刪除頁面、加水印、合併、擷取頁面範圍），全部用
 * pdf-lib 在 main process 直接操作檔案。刻意只做「基本頁面管理」這個
 * 範疇——不做文字內容編輯（那需要重新排版整份 PDF，超出這個功能的
 * 範圍）。除了 extractPdfPages()（產生一份新檔案，不動原檔）以外，
 * 其他操作都是直接覆寫原檔，沒有版本歷史／復原機制，見
 * `renderer/documents.js` 呼叫端在動作前都會跳確認對話框。
 */

async function loadPdf(filePath) {
  const bytes = fs.readFileSync(filePath);
  return PDFDocument.load(bytes);
}

async function getPdfPageCount(filePath) {
  const doc = await loadPdf(filePath);
  return doc.getPageCount();
}

async function rotatePdfPage(filePath, pageIndex, deltaDegrees) {
  const doc = await loadPdf(filePath);
  const pages = doc.getPages();
  if (pageIndex < 0 || pageIndex >= pages.length) throw new Error('PAGE_OUT_OF_RANGE');
  const page = pages[pageIndex];
  const current = page.getRotation().angle;
  page.setRotation(degrees((((current + deltaDegrees) % 360) + 360) % 360));
  fs.writeFileSync(filePath, await doc.save());
}

async function deletePdfPage(filePath, pageIndex) {
  const doc = await loadPdf(filePath);
  if (doc.getPageCount() <= 1) throw new Error('LAST_PAGE');
  if (pageIndex < 0 || pageIndex >= doc.getPageCount())
    throw new Error('PAGE_OUT_OF_RANGE');
  doc.removePage(pageIndex);
  fs.writeFileSync(filePath, await doc.save());
}

// 對角、半透明的文字戳章，蓋在每一頁的正中央，字級依頁面大小自動縮放。
async function addWatermarkToPdf(filePath, text) {
  const doc = await loadPdf(filePath);
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach((page) => {
    const { width, height } = page.getSize();
    const fontSize = Math.max(18, Math.min(width, height) / 10);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - textWidth / 2,
      y: height / 2,
      size: fontSize,
      font,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.35,
      rotate: degrees(-30),
    });
  });
  fs.writeFileSync(filePath, await doc.save());
}

// 把另一個 PDF 檔案的所有頁面接到這份文件的最後面。
async function mergePdfInto(filePath, otherFilePath) {
  const doc = await loadPdf(filePath);
  const otherDoc = await loadPdf(otherFilePath);
  const copiedPages = await doc.copyPages(otherDoc, otherDoc.getPageIndices());
  copiedPages.forEach((p) => doc.addPage(p));
  fs.writeFileSync(filePath, await doc.save());
}

/**
 * 解析「1-3,5,7-8」這種頁碼範圍字串（1-based、使用者看到的頁碼），
 * 回傳 0-based 索引陣列，依輸入順序展開（允許跳頁，不允許重複驗證，
 * 因為「同一頁擷取兩次」是合理需求，例如想把某頁重複放兩次）。
 */
function parsePageRange(rangeStr, pageCount) {
  const indices = [];
  const parts = String(rangeStr || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) throw new Error('INVALID_RANGE');
  for (const part of parts) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new Error('INVALID_RANGE');
    const start = parseInt(m[1], 10);
    const end = m[2] ? parseInt(m[2], 10) : start;
    if (start < 1 || end < start || end > pageCount) throw new Error('INVALID_RANGE');
    for (let n = start; n <= end; n += 1) indices.push(n - 1);
  }
  return indices;
}

// 擷取指定頁面範圍，回傳新 PDF 的 bytes（Uint8Array）——刻意不寫回
// 原檔，呼叫端（lib/ipc/documents.js）負責存成新檔案、註冊成新文件，
// 這樣「擷取」是非破壞性操作，原檔完全不受影響。
async function extractPdfPages(filePath, rangeStr) {
  const doc = await loadPdf(filePath);
  const indices = parsePageRange(rangeStr, doc.getPageCount());
  const newDoc = await PDFDocument.create();
  const copiedPages = await newDoc.copyPages(doc, indices);
  copiedPages.forEach((p) => newDoc.addPage(p));
  return newDoc.save();
}

module.exports = {
  getPdfPageCount,
  rotatePdfPage,
  deletePdfPage,
  addWatermarkToPdf,
  mergePdfInto,
  extractPdfPages,
  parsePageRange,
};
