/* Local-only UI catalogs. Custom catalogs also support Latin, independently of
 * Chrome's supported _locales list. Keys use Chinese source text for readability.
 * Never pass page titles, URLs or user bookmark names through translation.
 */
const KoiI18n = (() => {
  const locales = ['zh', 'en', 'ja', 'ko', 'la'];
  const storageKey = 'koiLanguage';
  let locale = 'zh';
  let preference = 'auto';
  let messages = {};
  const cache = new Map();

  function resolve(value) {
    const base = String(value || '').toLowerCase().replace(/_/g, '-').split('-')[0];
    return locales.includes(base) ? base : 'en';
  }
  function browserLocale() {
    return resolve(chrome.i18n?.getUILanguage?.() || navigator.language || 'en');
  }
  function t(key, ...values) {
    const template = Object.hasOwn(messages, key) ? messages[key] : key;
    // Callback replacement treats $, braces and markup in user text literally.
    return template.replace(/\{(\d+)\}/g, (match, index) =>
      index < values.length ? String(values[index]) : match);
  }
  async function catalog(target) {
    if (!cache.has(target)) {
      const response = await fetch(chrome.runtime.getURL(`locales/${target}.json`));
      if (!response.ok) throw new Error('Cannot load language catalog');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)
          || Object.values(data).some((v) => typeof v !== 'string')) {
        throw new Error('Invalid language catalog');
      }
      cache.set(target, data);
    }
    return cache.get(target);
  }
  function apply(root = document) {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : locale;
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    for (const attr of ['title', 'placeholder', 'aria-label']) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
      });
    }
    const selector = document.getElementById('language');
    if (selector) {
      selector.value = preference;
      selector.title = t('语言设置');
      selector.setAttribute('aria-label', t('语言设置'));
    }
    if (chrome.action?.setTitle) {
      chrome.action.setTitle({ title: `KoiTab · ${t('一键整理')}` }).catch(() => {});
    }
  }
  async function init() {
    try {
      const stored = await chrome.storage.local.get(storageKey);
      if (stored[storageKey] === 'auto' || locales.includes(stored[storageKey])) {
        preference = stored[storageKey];
      }
    } catch { /* Browser language is usable even if settings cannot be read. */ }
    const target = preference === 'auto' ? browserLocale() : preference;
    try {
      messages = await catalog(target);
      locale = target;
    } catch {
      // Chinese source keys are a usable offline fallback if a package is damaged.
      locale = 'zh';
      preference = 'zh';
    }
    apply();
  }
  async function setLanguage(value) {
    if (value !== 'auto' && !locales.includes(value)) throw new Error('Unsupported language');
    const target = value === 'auto' ? browserLocale() : value;
    const next = await catalog(target);
    // Persist before applying: a failed write must not falsely promise persistence.
    await chrome.storage.local.set({ [storageKey]: value });
    preference = value;
    locale = target;
    messages = next;
    apply();
  }
  return { init, setLanguage, t, resolve, get locale() { return locale; }, get preference() { return preference; } };
})();
const tr = (key, ...values) => KoiI18n.t(key, ...values);
