/**
 * selectorPicker.js
 *
 * 這段腳本會被 main.js 讀成字串後注入到目前帳號的 WebContentsView，
 * 讓使用者在頁面上用滑鼠點選一則「範例訊息」。
 * 回傳一個 Promise，resolve 出來的物件會被 executeJavaScript() 的呼叫端拿到。
 *
 * 回傳格式：
 *   { cancelled: false, tagName, className, id, attrs: {...}, sampleText }
 *   或使用者按 Esc 取消時： { cancelled: true }
 */
function startSelectorPicker() {
  return new Promise((resolve) => {
    // 避免重複注入時殘留舊的 overlay / listener
    if (window.__wsAggPickerActive) {
      window.__wsAggPickerCancel && window.__wsAggPickerCancel();
    }
    window.__wsAggPickerActive = true;

    const style = document.createElement('style');
    style.id = '__ws_agg_picker_style';
    style.textContent = `
      .__ws-agg-picker-hover {
        outline: 2px solid #4f8cff !important;
        outline-offset: 2px !important;
        cursor: crosshair !important;
      }
    `;
    document.head.appendChild(style);

    let currentHover = null;

    function onMouseOver(e) {
      if (currentHover) currentHover.classList.remove('__ws-agg-picker-hover');
      currentHover = e.target;
      currentHover.classList.add('__ws-agg-picker-hover');
    }

    function buildSelectorInfo(el) {
      const attrs = {};
      Array.from(el.attributes || []).forEach((a) => {
        attrs[a.name] = a.value;
      });
      return {
        cancelled: false,
        tagName: el.tagName ? el.tagName.toLowerCase() : '',
        className: el.className && typeof el.className === 'string' ? el.className : '',
        id: el.id || '',
        attrs,
        sampleText: (el.innerText || '').slice(0, 200),
      };
    }

    function onClick(e) {
      e.preventDefault();
      e.stopPropagation();
      const el = e.target;
      cleanup();
      resolve(buildSelectorInfo(el));
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        cleanup();
        resolve({ cancelled: true });
      }
    }

    function cleanup() {
      window.__wsAggPickerActive = false;
      document.removeEventListener('mouseover', onMouseOver, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      if (currentHover) currentHover.classList.remove('__ws-agg-picker-hover');
      const s = document.getElementById('__ws_agg_picker_style');
      if (s) s.remove();
    }

    window.__wsAggPickerCancel = () => {
      cleanup();
      resolve({ cancelled: true });
    };

    document.addEventListener('mouseover', onMouseOver, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKeyDown, true);
  });
}

startSelectorPicker();
