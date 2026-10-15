'use strict';

/**
 * test/docx-sanitize.test.js
 *
 * M-2：.docx 預覽 HTML 淨化（白名單）。這裡收的是資安報告裡重現過的繞過字串，
 * 以及一些常見的變形，確保輸出裡不會出現可執行的標籤、屬性或網址。
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDocxHtml, markdownToHtml } = require('../lib/utils');

/** 輸出裡不該出現的東西（小寫比對）。 */
function assertNoActiveContent(out, label) {
  const lower = out.toLowerCase();
  assert.ok(!/<\s*script/.test(lower), `${label}: script`);
  assert.ok(!/<\s*(iframe|object|embed|svg|math|form|meta|link|base|style|template|input|button)/.test(lower), `${label}: tag`);
  // 屬性只在真正的標籤內才有意義；被跳脫成文字（&lt;）的內容不會執行
  const realTags = (lower.match(/<[^>]*>/g) || []).join('');
  assert.ok(!/\son[a-z]+\s*=/.test(realTags), `${label}: on* attr`);
  assert.ok(!/javascript:/.test(realTags.replace(/\s|&#\d+;|&#x[0-9a-f]+;/g, '')), `${label}: javascript:`);
  assert.ok(!/\sstyle\s*=/.test(realTags), `${label}: style attr`);
}

const BYPASSES = {
  unquoted_attr: '<img src=x onerror=alert(1)>',
  single_quote_attr: "<p onclick='alert(1)'>x</p>",
  slash_separator: '<img/src=x/onerror=alert(1)>',
  tab_in_scheme: '<a href="java&#9;script:alert(1)">x</a>',
  newline_in_scheme: '<a href="jav&#x0A;ascript:alert(1)">x</a>',
  entity_scheme: '<a href="&#106;avascript:alert(1)">x</a>',
  entity_scheme_nosemi: '<a href="&#106avascript:alert(1)">x</a>',
  named_colon: '<a href="javascript&colon;alert(1)">x</a>',
  upper_case: '<A HREF="JaVaScRiPt:alert(1)">x</A>',
  leading_space: '<a href="  javascript:alert(1)">x</a>',
  control_char: '<a href="\u0001javascript:alert(1)">x</a>',
  vbscript: '<a href="vbscript:msgbox(1)">x</a>',
  data_html_href: '<a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">x</a>',
  svg_img: '<img src="data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+">',
  form_action: '<form action="https://evil.example"><input name=a><button formaction="javascript:alert(1)">go</button></form>',
  meta_refresh: '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  base_tag: '<base href="https://evil.example/">',
  link_tag: '<link rel="stylesheet" href="https://evil.example/x.css">',
  svg_script: '<svg><script>alert(1)</script></svg>',
  svg_onload: '<svg onload=alert(1)></svg>',
  math: '<math><mi xlink:href="javascript:alert(1)">x</mi></math>',
  nested_script: '<scr<script>ipt>alert(1)</scr</script>ipt>',
  template: '<template><script>alert(1)</script></template>',
  comment_hide: '<!--><script>alert(1)</script>-->',
  cdata: '<![CDATA[<script>alert(1)</script>]]>',
  style_tag: '<style>*{background:url(javascript:alert(1))}</style>',
  object_tag: '<object data="javascript:alert(1)"></object>',
  embed_tag: '<embed src="javascript:alert(1)">',
  iframe_srcdoc: '<iframe srcdoc="<script>alert(1)</script>"></iframe>',
  textarea_break: '<textarea></textarea><script>alert(1)</script>',
  attr_gt_in_quote: '<a title=">" onclick="alert(1)" href="#">x</a>',
  unclosed_tag: '<img src="x" onerror="alert(1)"',
  unclosed_quote: '<a href="x onclick=alert(1)>x</a>',
  event_in_td: '<table><tr><td onmouseover="alert(1)" colspan="2">x</td></tr></table>',
  img_no_space: '<img src="data:image/png;base64,AAAA"onerror="alert(1)">',
};

for (const [name, html] of Object.entries(BYPASSES)) {
  test(`sanitizeDocxHtml 繞過字串：${name}`, () => {
    assertNoActiveContent(sanitizeDocxHtml(html), name);
  });
}

test('sanitizeDocxHtml：<script> 內容整段消失，不會變成可見文字', () => {
  const out = sanitizeDocxHtml('<p>a</p><script>alert(1)</script><p>b</p>');
  assert.equal(out, '<p>a</p><p>b</p>');
});

test('sanitizeDocxHtml：href 只剩 http(s)／mailto／錨點，其餘變成 #', () => {
  assert.equal(sanitizeDocxHtml('<a href="https://example.com/a?b=1&amp;c=2">x</a>'), '<a href="https://example.com/a?b=1&amp;c=2">x</a>');
  assert.equal(sanitizeDocxHtml('<a href="mailto:a@b.co">x</a>'), '<a href="mailto:a@b.co">x</a>');
  assert.equal(sanitizeDocxHtml('<a href="#sec1">x</a>'), '<a href="#sec1">x</a>');
  assert.equal(sanitizeDocxHtml('<a href="//evil.example/x">x</a>'), '<a href="#">x</a>');
  assert.equal(sanitizeDocxHtml('<a href="file:///etc/passwd">x</a>'), '<a href="#">x</a>');
  assert.equal(sanitizeDocxHtml('<a href="./relative.html">x</a>'), '<a href="#">x</a>');
});

test('sanitizeDocxHtml：img 只接受 data:image 的點陣圖；alt 保留；svg／其他 data: 被拿掉', () => {
  const ok = sanitizeDocxHtml('<img src="data:image/png;base64,iVBORw0KGgo=" alt="pic">');
  assert.equal(ok, '<img src="data:image/png;base64,iVBORw0KGgo=" alt="pic">');
  assert.equal(sanitizeDocxHtml('<img src="data:image/jpeg;base64,/9j/4AAQ">'), '<img src="data:image/jpeg;base64,/9j/4AAQ">');
  assert.equal(sanitizeDocxHtml('<img src="https://evil.example/track.gif">'), '<img>');
  assert.equal(sanitizeDocxHtml('<img src="data:image/svg+xml;base64,AAAA">'), '<img>');
  assert.equal(sanitizeDocxHtml('<img src="data:text/html,<b>x</b>">'), '<img>');
});

test('sanitizeDocxHtml：正常的 mammoth 結構保持不變（標題、清單、粗斜底線、表格、合併儲存格）', () => {
  const html =
    '<h1>T</h1><p><strong>b</strong><em>i</em><u>u</u><s>s</s>x<sub>2</sub><sup>3</sup></p>' +
    '<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol><blockquote>q</blockquote><pre><code>c</code></pre>' +
    '<table><tbody><tr><td colspan="2">x</td><th rowspan="2">y</th></tr></tbody></table><br><hr>';
  assert.equal(sanitizeDocxHtml(html), html);
});

test('sanitizeDocxHtml：colspan 只接受數字', () => {
  assert.equal(sanitizeDocxHtml('<td colspan="2;evil">x</td>'), '<td>x</td>');
  assert.equal(sanitizeDocxHtml('<td colspan="2">x</td>'), '<td colspan="2">x</td>');
});

test('sanitizeDocxHtml：不成形的 < 與文字裡的 > 被跳脫；class／id／style 不輸出', () => {
  assert.equal(sanitizeDocxHtml('a < b > c'), 'a &lt; b &gt; c');
  assert.equal(sanitizeDocxHtml('<p class="x" id="y" style="color:red" data-a="1">t</p>'), '<p>t</p>');
});

test('sanitizeDocxHtml：非字串輸入不會丟例外', () => {
  assert.equal(sanitizeDocxHtml(undefined), '');
  assert.equal(sanitizeDocxHtml(null), '');
  assert.equal(sanitizeDocxHtml(12), '12');
});

test('safeUrl（Markdown 連結）：tab／換行拆開的協定與協定相對網址都被擋', () => {
  const link = (u) => markdownToHtml(`[x](${u})`);
  assert.ok(!/javascript:/i.test(link('java\tscript:alert(1)')));
  assert.ok(link('//evil.example/x').includes('href="#"'));
  assert.ok(link('\\\\evil.example/x').includes('href="#"'));
  assert.ok(link('https://ok.example/').includes('href="https://ok.example/"'));
  assert.ok(link('./a.md').includes('href="./a.md"'));
});
