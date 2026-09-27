'use strict';

/**
 * test/pdfEditor.test.js
 *
 * 測試 lib/pdfEditor.js 的 PDF 頁面操作（旋轉/刪除/加水印/合併/擷取）。
 * 這個模組只依賴 pdf-lib 跟 Node 內建的 fs，不依賴 Electron，所以可以
 * 直接在一般 Node.js 環境下用真正的 PDF 檔案測試，不需要假 electron。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PDFDocument } = require('pdf-lib');

const {
  getPdfPageCount,
  rotatePdfPage,
  deletePdfPage,
  addWatermarkToPdf,
  mergePdfInto,
  extractPdfPages,
  parsePageRange,
} = require('../lib/pdfEditor');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-pdfeditor-'));

async function makeTestPdf(filePath, pageCount) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) doc.addPage([200, 200]);
  fs.writeFileSync(filePath, await doc.save());
}

test('getPdfPageCount：回傳正確頁數', async () => {
  const file = path.join(tmpDir, 'count.pdf');
  await makeTestPdf(file, 3);
  assert.equal(await getPdfPageCount(file), 3);
});

test('rotatePdfPage：旋轉會累加、超過 360 度會回捲到 0-359 之間', async () => {
  const file = path.join(tmpDir, 'rotate.pdf');
  await makeTestPdf(file, 1);
  await rotatePdfPage(file, 0, 90);
  let doc = await PDFDocument.load(fs.readFileSync(file));
  assert.equal(doc.getPages()[0].getRotation().angle, 90);

  await rotatePdfPage(file, 0, 90);
  await rotatePdfPage(file, 0, 90);
  await rotatePdfPage(file, 0, 90); // 90*4 = 360 -> 應該回捲成 0
  doc = await PDFDocument.load(fs.readFileSync(file));
  assert.equal(doc.getPages()[0].getRotation().angle, 0);
});

test('rotatePdfPage：頁碼超出範圍會丟錯，不動到檔案', async () => {
  const file = path.join(tmpDir, 'rotate-oob.pdf');
  await makeTestPdf(file, 2);
  await assert.rejects(() => rotatePdfPage(file, 5, 90), /PAGE_OUT_OF_RANGE/);
});

test('deletePdfPage：刪除指定頁面後總頁數少 1', async () => {
  const file = path.join(tmpDir, 'delete.pdf');
  await makeTestPdf(file, 3);
  await deletePdfPage(file, 1);
  assert.equal(await getPdfPageCount(file), 2);
});

test('deletePdfPage：只剩最後一頁時不能刪除', async () => {
  const file = path.join(tmpDir, 'delete-last.pdf');
  await makeTestPdf(file, 1);
  await assert.rejects(() => deletePdfPage(file, 0), /LAST_PAGE/);
  assert.equal(await getPdfPageCount(file), 1); // 確認真的沒被動到
});

test('addWatermarkToPdf：加完水印頁數不變、檔案仍然是合法的 PDF', async () => {
  const file = path.join(tmpDir, 'watermark.pdf');
  await makeTestPdf(file, 2);
  await addWatermarkToPdf(file, 'CONFIDENTIAL');
  assert.equal(await getPdfPageCount(file), 2);
  // 能重新用 pdf-lib load 回來，代表存出來的檔案結構是合法的
  await assert.doesNotReject(() => PDFDocument.load(fs.readFileSync(file)));
});

test('mergePdfInto：把另一份 PDF 的頁面接到後面，總頁數是兩者相加', async () => {
  const file = path.join(tmpDir, 'merge-a.pdf');
  const other = path.join(tmpDir, 'merge-b.pdf');
  await makeTestPdf(file, 2);
  await makeTestPdf(other, 3);
  await mergePdfInto(file, other);
  assert.equal(await getPdfPageCount(file), 5);
  assert.equal(await getPdfPageCount(other), 3); // 被合併進去的那份不受影響
});

test('parsePageRange：支援單頁、範圍、逗號混合，1-based 轉成 0-based', () => {
  assert.deepEqual(parsePageRange('1,3-4', 5), [0, 2, 3]);
  assert.deepEqual(parsePageRange('2', 5), [1]);
});

test('parsePageRange：超出頁數範圍、格式錯誤、空字串都會丟 INVALID_RANGE', () => {
  assert.throws(() => parsePageRange('1-10', 5), /INVALID_RANGE/);
  assert.throws(() => parsePageRange('abc', 5), /INVALID_RANGE/);
  assert.throws(() => parsePageRange('', 5), /INVALID_RANGE/);
  assert.throws(() => parsePageRange('3-1', 5), /INVALID_RANGE/); // 起始比結束大
});

test('extractPdfPages：擷取指定頁面存成新檔案，原檔完全不受影響', async () => {
  const file = path.join(tmpDir, 'extract-source.pdf');
  await makeTestPdf(file, 5);
  const bytes = await extractPdfPages(file, '1,3-4');
  const outFile = path.join(tmpDir, 'extract-out.pdf');
  fs.writeFileSync(outFile, bytes);
  assert.equal(await getPdfPageCount(outFile), 3);
  assert.equal(await getPdfPageCount(file), 5); // 原檔頁數不變
});
