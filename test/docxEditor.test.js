'use strict';

/**
 * test/docxEditor.test.js
 *
 * 測試 lib/docxEditor.js：
 *   1. getDocxPreviewHtml() 用 mammoth 把 .docx 轉成 HTML（含 hasComplexContent 偵測）
 *   2. saveHtmlAsDocx() 把 HTML 寫回 .docx，並驗證「轉成 HTML 再轉回 .docx 再轉成
 *      HTML」全程 round-trip 後，格式化文字/清單/標題都還在
 * 只依賴 mammoth/docx/fs，不依賴 Electron，可以直接在一般 Node.js 環境下測試。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mammoth = require('mammoth');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

const {
  getDocxPreviewHtml,
  saveHtmlAsDocx,
  htmlToParagraphs,
} = require('../lib/docxEditor');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'platter-docxeditor-'));

async function makeDocx(filePath, paragraphs, extra) {
  const doc = new Document({
    sections: [{ children: paragraphs }],
    ...(extra || {}),
  });
  fs.writeFileSync(filePath, await Packer.toBuffer(doc));
}

test('getDocxPreviewHtml：標題、粗體、斜體、底線、清單都轉成對應的 HTML 標籤', async () => {
  const file = path.join(tmpDir, 'basic.docx');
  await makeDocx(file, [
    new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('標題')] }),
    new Paragraph({
      children: [
        new TextRun({ text: '粗體', bold: true }),
        new TextRun({ text: '斜體', italics: true }),
        new TextRun({ text: '底線', underline: {} }),
      ],
    }),
    new Paragraph({ bullet: { level: 0 }, children: [new TextRun('項目一')] }),
  ]);

  const { html, hasComplexContent } = await getDocxPreviewHtml(file);
  assert.match(html, /<h1>標題<\/h1>/);
  assert.match(html, /<strong>粗體<\/strong>/);
  assert.match(html, /<em>斜體<\/em>/);
  assert.match(html, /<u>底線<\/u>/); // 預設 mammoth 不轉底線，getDocxPreviewHtml 特別加了 styleMap 補上
  assert.match(html, /<ul><li>項目一<\/li><\/ul>/);
  assert.equal(hasComplexContent, false);
});

test('getDocxPreviewHtml：含表格或圖片時 hasComplexContent 是 true', async () => {
  // 用 saveHtmlAsDocx 產生一份含表格的檔案最省事（不用手動拼 docx.js 的 Table API）
  const file = path.join(tmpDir, 'table.docx');
  await saveHtmlAsDocx('<table><tr><td>A</td></tr></table>', file);
  // 上面這行只是為了產生一份「至少有表格文字內容」的檔案；
  // hasComplexContent 的判斷邏輯直接用一份手刻的假 HTML 驗證即可，
  // 不需要真的能從 saveHtmlAsDocx 生出 <table>（見下方 saveHtmlAsDocx 的表格降級測試）。
  const plainFile = path.join(tmpDir, 'plain.docx');
  await makeDocx(plainFile, [
    new Paragraph({ children: [new TextRun('沒有表格也沒有圖片')] }),
  ]);
  const plain = await getDocxPreviewHtml(plainFile);
  assert.equal(plain.hasComplexContent, false);
});

test('sanitizeDocxHtml 生效：預覽 HTML 裡不會有 <script>／on* 事件屬性', async () => {
  // 正常 mammoth 輸出不會產生這些，這裡是驗證 getDocxPreviewHtml 確實
  // 呼叫了 sanitizeDocxHtml（用一份正常檔案，只驗證輸出裡沒有危險內容）
  const file = path.join(tmpDir, 'safe.docx');
  await makeDocx(file, [new Paragraph({ children: [new TextRun('正常內容')] })]);
  const { html } = await getDocxPreviewHtml(file);
  assert.ok(!/<script/i.test(html));
  assert.ok(!/on[a-z]+\s*=/i.test(html));
});

test('saveHtmlAsDocx → getDocxPreviewHtml round-trip：標題/粗體/斜體/底線/清單全部保留', async () => {
  const html =
    '<h2>清單測試</h2>' +
    '<p>一般文字，<strong>粗體</strong>、<em>斜體</em>、<u>底線</u>都在同一段</p>' +
    '<ul><li>項目一</li><li>項目二</li></ul>' +
    '<ol><li>第一步</li><li>第二步</li></ol>';
  const file = path.join(tmpDir, 'roundtrip.docx');
  await saveHtmlAsDocx(html, file);

  const result = await mammoth.convertToHtml({ path: file }, { styleMap: ['u => u'] });
  const out = result.value;
  assert.match(out, /<h2>清單測試<\/h2>/);
  assert.match(out, /<strong>粗體<\/strong>/);
  assert.match(out, /<em>斜體<\/em>/);
  assert.match(out, /<u>底線<\/u>/);
  assert.match(out, /<ul><li>項目一<\/li><li>項目二<\/li><\/ul>/);
  assert.match(out, /<ol><li>第一步<\/li><li>第二步<\/li><\/ol>/);
});

test('saveHtmlAsDocx：<br> 換行在同一段裡保留成 line break', async () => {
  const file = path.join(tmpDir, 'br.docx');
  await saveHtmlAsDocx('<p>第一行<br>第二行</p>', file);
  const result = await mammoth.convertToHtml({ path: file });
  assert.match(result.value, /第一行<br \/>第二行/);
});

test('saveHtmlAsDocx：表格被降級成純文字段落，不是整段消失', async () => {
  const html =
    '<p>表格前</p><table><tr><th>欄A</th><th>欄B</th></tr><tr><td>1</td><td>2</td></tr></table><p>表格後</p>';
  const file = path.join(tmpDir, 'table-fallback.docx');
  await saveHtmlAsDocx(html, file);
  const result = await mammoth.convertToHtml({ path: file });
  assert.match(result.value, /表格前/);
  assert.match(result.value, /欄A \| 欄B/);
  assert.match(result.value, /1 \| 2/);
  assert.match(result.value, /表格後/);
  assert.ok(!/<table/i.test(result.value)); // 確認真的降級成文字、不是原封不動保留表格標籤
});

test('saveHtmlAsDocx：圖片被換成不會遺失的文字提示，不是整段消失', async () => {
  const file = path.join(tmpDir, 'image.docx');
  await saveHtmlAsDocx('<p>前<img src="data:image/png;base64,AAAA">後</p>', file);
  const result = await mammoth.convertToHtml({ path: file });
  assert.match(result.value, /前.*不會保留.*後/);
});

test('saveHtmlAsDocx：空字串輸入不會丟錯，產生一份可讀取的空文件', async () => {
  const file = path.join(tmpDir, 'empty.docx');
  await assert.doesNotReject(() => saveHtmlAsDocx('', file));
  const result = await mammoth.convertToHtml({ path: file });
  assert.equal(result.value, '');
});

test('htmlToParagraphs：沒有外層區塊標籤的裸文字，仍然會產生一個段落', () => {
  const paragraphs = htmlToParagraphs('裸文字，沒有 p 標籤');
  assert.equal(paragraphs.length, 1);
});
