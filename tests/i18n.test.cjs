const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '../extension');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const languages = ['zh', 'en', 'ja', 'ko', 'la'];
const catalogs = Object.fromEntries(languages.map((locale) => [locale, JSON.parse(read(`locales/${locale}.json`))]));
const placeholders = (s) => [...s.matchAll(/\{\d+\}/g)].map((m) => m[0]).sort();

test('every locale translates the complete catalog and preserves placeholders', () => {
  const keys = Object.keys(catalogs.zh).sort();
  for (const locale of languages) {
    assert.deepEqual(Object.keys(catalogs[locale]).sort(), keys, locale);
    for (const key of keys) {
      const text = catalogs[locale][key];
      assert.ok(typeof text === 'string' && text.trim(), `${locale}: ${key}`);
      assert.deepEqual(placeholders(text), placeholders(key), `${locale}: ${key}`);
      if (locale === 'en' || locale === 'la') {
        if (!['藏','签'].includes(key)) assert.ok(!/\p{Script=Han}/u.test(text), `${locale}: untranslated ${key}`);
      }
    }
  }
});

test('all static markup and dynamic message calls reference shipped translations', () => {
  const html = read('popup.html');
  for (const [,key] of html.matchAll(/data-i18n(?:-title|-placeholder|-aria-label)?="([^"]+)"/g)) {
    const decoded = key.replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&amp;/g,'&');
    assert.ok(Object.hasOwn(catalogs.zh, decoded), decoded);
  }
  for (const script of ['popup.js', 'i18n.js']) {
    for (const [,literal] of read(script).matchAll(/\b(?:tr|t)\(((?:"(?:\\.|[^"\\])*"|'[^']*'))/g)) {
      const key = literal[0] === '"' ? JSON.parse(literal) : literal.slice(1,-1);
      assert.ok(Object.hasOwn(catalogs.zh, key), `${script}: ${key}`);
    }
  }
  assert.ok(html.indexOf('src="i18n.js"') < html.indexOf('src="popup.js"'));
  for (const l of languages) assert.ok(html.includes(`value="${l}"`));
});

test('manifest locale placeholders resolve without extra permissions', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.default_locale, 'en');
  assert.deepEqual(manifest.permissions, ['tabs','tabGroups','bookmarks','storage']);
  for (const locale of ['en','zh_CN','zh_TW','ja','ko']) {
    const messages = JSON.parse(read(`_locales/${locale}/messages.json`));
    for (const value of [manifest.name, manifest.description, manifest.action.default_title]) {
      const key = value.match(/^__MSG_(.+)__$/)[1];
      assert.ok(messages[key]?.message);
    }
    assert.ok(messages.extensionDescription.message.length <= 132);
  }
  assert.ok(fs.existsSync(path.join(root, 'locales/la.json')));
});
