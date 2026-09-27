const fs = require('fs');
const mammoth = require('mammoth');
const {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
} = require('docx');
const { sanitizeDocxHtml } = require('./utils');

/**
 * `.docx` 預覽用 mammoth 把檔案轉成 HTML（語意化標籤：p/h1-6/strong/
 * em/u/ul/ol/li/table/img，圖片預設內嵌成 base64 data URI），淨化過
 * 再回傳給渲染層直接 innerHTML（見 lib/utils.js 的 sanitizeDocxHtml）。
 * hasComplexContent 用來提示「這份文件含表格或圖片，編輯後存檔會
 * 遺失/被轉成純文字」——判斷要用**淨化前**的原始 HTML（淨化只拿掉
 * 危險標籤/屬性，不會拿掉 table/img，這裡單純檢查有沒有這兩種標籤）。
 */
async function getDocxPreviewHtml(filePath) {
  // mammoth 預設不會把底線轉成 <u>（官方文件說底線通常只是視覺效果、
  // 語意不大），但這裡的 HTML 是要拿來編輯後存回 .docx 的，底線遺失
  // 會讓「編輯後存檔」在使用者沒動過底線文字的情況下也把底線洗掉，
  // 所以額外加一條 styleMap 規則把底線找回來。
  const result = await mammoth.convertToHtml(
    { path: filePath },
    { styleMap: ['u => u'] }
  );
  const rawHtml = result.value || '';
  return {
    html: sanitizeDocxHtml(rawHtml),
    hasComplexContent: /<table[\s>]|<img[\s>]/i.test(rawHtml),
  };
}

const NUMBERED_LIST_REF = 'platter-docx-editor-numbered-list';

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html) {
  return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// 表格沒辦法跟其他區塊用同一套簡單的行內 tokenizer 處理（列/欄是二維
// 結構），所以在主要解析之前先單獨抽出來，換成攤平的純文字段落——
// 保留表格「裡面寫了什麼」，但欄位/框線/合併格這些排版資訊都會遺失，
// 這是刻意的取捨（見 getDocxPreviewHtml() 的 hasComplexContent，
// 呼叫端會先跟使用者說清楚才讓他存檔）。
function flattenTables(html) {
  return html.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (match, body) => {
    const rows = [];
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRe.exec(body))) {
      const cells = [];
      const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch;
      while ((cellMatch = cellRe.exec(rowMatch[1]))) {
        cells.push(stripTags(cellMatch[1]));
      }
      if (cells.length > 0) rows.push(cells.join(' | '));
    }
    const notice = '<p>[表格內容，已轉換為純文字，原表格格式未保留]</p>';
    return (
      notice +
      rows
        .map(
          (r) =>
            `<p>${r.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])}</p>`
        )
        .join('')
    );
  });
}

/**
 * 把（已經淨化過、來自預覽畫面 contenteditable 編輯結果的）HTML
 * 解析成 docx.js 的 Paragraph/TextRun 陣列。用一個簡單的 tokenizer +
 * 堆疊追蹤目前的行內格式（粗體/斜體/底線）跟目前在哪個清單類型
 * （ul/ol）裡，不是完整的 HTML parser——只認得 mammoth 輸出跟一般
 * contenteditable 編輯器（execCommand）會產生的標籤集合：
 * p/div/h1-6/br/ul/ol/li/strong/b/em/i/u/span。圖片（<img>）會被
 * 拿掉、換成一行提示文字（見下方 IMAGE_PLACEHOLDER），因為要把
 * data URI 圖片正確嵌回 .docx 需要先解出圖片的實際尺寸，這個版本
 * 刻意不做，避免用猜的尺寸把版面弄得更奇怪。
 */
const IMAGE_PLACEHOLDER = '[圖片，儲存後不會保留]';

function htmlToParagraphs(html) {
  const withoutImages = html.replace(/<img\b[^>]*>/gi, `${IMAGE_PLACEHOLDER}`);
  const flat = flattenTables(withoutImages);

  const tokenRe = /<\/?[a-zA-Z0-9]+[^>]*>|[^<]+/g;
  const tokens = flat.match(tokenRe) || [];

  const paragraphs = [];
  let runs = [];
  let bold = 0;
  let italics = 0;
  let underline = 0;
  let listStack = []; // 'ul' | 'ol' 的堆疊，支援巢狀清單但一律用 level 0 顯示
  let pendingBreak = false;
  let blockType = null; // 目前段落的類型：null（尚未進入任何區塊）、'p'、'h1'..'h6'、'li'

  function pushText(text) {
    const decoded = decodeEntities(text);
    if (decoded === '') return;
    runs.push(
      new TextRun({
        text: decoded,
        bold: bold > 0,
        italics: italics > 0,
        underline: underline > 0 ? {} : undefined,
        break: pendingBreak ? 1 : undefined,
      })
    );
    pendingBreak = false;
  }

  function flushParagraph() {
    if (blockType === null && runs.length === 0) return; // 還沒進入任何區塊、也沒有文字，不用輸出空段落
    const heading = /^h[1-6]$/.test(blockType || '')
      ? HeadingLevel['HEADING_' + blockType[1]]
      : undefined;
    const inList = listStack[listStack.length - 1];
    const paraOptions = {
      children: runs.length > 0 ? runs : [new TextRun('')],
      heading,
      alignment: AlignmentType.LEFT,
    };
    if (blockType === 'li' && inList === 'ul') {
      paraOptions.bullet = { level: Math.max(0, listStack.length - 1) };
    } else if (blockType === 'li' && inList === 'ol') {
      paraOptions.numbering = {
        reference: NUMBERED_LIST_REF,
        level: Math.max(0, listStack.length - 1),
      };
    }
    paragraphs.push(new Paragraph(paraOptions));
    runs = [];
    blockType = null;
  }

  tokens.forEach((token) => {
    const closeMatch = /^<\/([a-zA-Z0-9]+)\s*>$/.exec(token);
    const openMatch = /^<([a-zA-Z0-9]+)([^>]*)>$/.exec(token);

    if (openMatch) {
      const tag = openMatch[1].toLowerCase();
      const selfClosing = /\/>\s*$/.test(token);
      if (tag === 'br') {
        pendingBreak = true;
      } else if (tag === 'p' || tag === 'div') {
        flushParagraph();
        blockType = 'p';
      } else if (/^h[1-6]$/.test(tag)) {
        flushParagraph();
        blockType = tag;
      } else if (tag === 'li') {
        flushParagraph();
        blockType = 'li';
      } else if (tag === 'ul' || tag === 'ol') {
        listStack.push(tag);
      } else if (tag === 'strong' || tag === 'b') {
        bold += 1;
      } else if (tag === 'em' || tag === 'i') {
        italics += 1;
      } else if (tag === 'u') {
        underline += 1;
      }
      // span/其他不認得的標籤：忽略（不影響格式狀態），selfClosing 的
      // 非 br 標籤（理論上淨化後不該出現）也直接忽略內容
      void selfClosing;
    } else if (closeMatch) {
      const tag = closeMatch[1].toLowerCase();
      if (tag === 'p' || tag === 'div' || /^h[1-6]$/.test(tag) || tag === 'li') {
        flushParagraph();
      } else if (tag === 'ul' || tag === 'ol') {
        listStack.pop();
      } else if (tag === 'strong' || tag === 'b') {
        bold = Math.max(0, bold - 1);
      } else if (tag === 'em' || tag === 'i') {
        italics = Math.max(0, italics - 1);
      } else if (tag === 'u') {
        underline = Math.max(0, underline - 1);
      }
    } else {
      // 純文字 token：如果還沒進入任何區塊（例如淨化後開頭就是文字，
      // 沒有外層 <p>），當成一般段落處理
      if (blockType === null) blockType = 'p';
      pushText(token);
    }
  });
  flushParagraph();

  return paragraphs;
}

async function saveHtmlAsDocx(html, filePath) {
  const paragraphs = htmlToParagraphs(sanitizeDocxHtml(html));
  const doc = new Document({
    numbering: {
      config: [
        {
          reference: NUMBERED_LIST_REF,
          levels: [
            {
              level: 0,
              format: 'decimal',
              text: '%1.',
              alignment: AlignmentType.START,
            },
          ],
        },
      ],
    },
    sections: [{ children: paragraphs.length > 0 ? paragraphs : [new Paragraph('')] }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(filePath, buffer);
}

module.exports = {
  getDocxPreviewHtml,
  saveHtmlAsDocx,
  htmlToParagraphs, // 匯出方便寫單元測試
  IMAGE_PLACEHOLDER,
};
