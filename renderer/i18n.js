(function () {
  const state = {
    lang: 'zh-TW',
    dict: {},
  };

  function t(key, vars) {
    let str = state.dict[key];
    if (str === undefined) return key;
    if (vars) {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), vars[k]);
      });
    }
    return str;
  }

  function applyToDOM(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
  }

  async function loadDict(lang) {
    try {
      const res = await fetch(`./locales/${lang}.json`);
      state.dict = await res.json();
      state.lang = lang;
    } catch (err) {
      console.error('載入語言檔失敗:', lang, err);
    }
  }

  async function init() {
    const ui = await window.workspaceAPI.getUIState();
    await loadDict(ui.language || 'zh-TW');
    applyToDOM(document);

    window.workspaceAPI.onLanguageChanged(async (lang) => {
      await loadDict(lang);
      applyToDOM(document);
      document.dispatchEvent(new CustomEvent('i18n:updated'));
    });
  }

  async function setLanguage(lang) {
    await window.workspaceAPI.setLanguage(lang);
  }

  window.i18n = { t, applyToDOM, init, setLanguage, get lang() { return state.lang; } };
})();
