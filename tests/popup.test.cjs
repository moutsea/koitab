const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped popup source; Chrome and DOM are isolated in memory.
const source = fs.readFileSync(path.join(__dirname, '../extension/i18n.js'), 'utf8') + '\n'
  + fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8');
const DAY = 86400000;
const NOW = 1800000000000;
const copy = (value) => structuredClone(value);
const tab = (id, url, extra = {}) => ({
  id, url, title: url, windowId: 1, index: id - 1, groupId: -1,
  active: false, pinned: false, lastAccessed: NOW - 10 * DAY, ...extra,
});
const favorite = (id, url) => ({ id, url, title: url, domain: new URL(url).hostname });
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
function setup(tabs = [], saved = [], options = {}) {
  const state = { tabs: copy(tabs), saved: copy(saved), removed: [], writes: 0, confirms: [], confirmResult: true };
  state.preferences = copy(options.preferences || {});
  const elements = new Map();
  const created = [];
  function element() {
    const e = {
      style: {}, dataset: {}, children: [], listeners: {}, textContent: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      attributes: {},
      setAttribute(k, v) { this.attributes[k] = v; },
      getAttribute(k) { return this.attributes[k]; },
      addEventListener(event, cb) { this.listeners[event] = cb; },
    };
    return e;
  }
  const settings = ['scope', 'days', 'auto'].map(() => element());
  let init;
  const document = {
    documentElement: {},
    addEventListener(event, cb) { if (event === 'DOMContentLoaded') init = cb; },
    createElement() { const e = element(); created.push(e); return e; },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelector() { return element(); },
    querySelectorAll(selector) {
      if (selector.includes('#seg-scope button')) return [...settings, document.getElementById('language'), document.getElementById('grouping-mode'), document.getElementById('group-scope'), ...created.filter((e) => /koi-close|koi-fav-openall|koi-ungroup/.test(e.className || ''))];
      return [];
    },
  };
  const timers = new Map();
  let timerId = 0;
  const events = {};
  const event = (name) => ({ addListener(cb) { events[name] = cb; } });
  class Clock extends Date { static now() { return NOW; } }
  const context = vm.createContext({
    URL, Date: Clock, navigator: { language: options.browserLanguage || 'zh-CN' },
    fetch: async (url) => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname, '../extension', url), 'utf8')) }),
    console: { warn() {}, error() {} },
    setTimeout(cb) { timers.set(++timerId, cb); return timerId; }, clearTimeout(id) { timers.delete(id); }, document,
    window: { confirm(msg) { state.confirms.push(msg); return state.confirmResult; } },
    chrome: {
      i18n: { getUILanguage: () => options.browserLanguage || 'zh-CN' },
      action: { setTitle: async ({title}) => { state.actionTitle = title; } },
      tabs: {
        query: async (q) => copy(state.tabs.filter((t) => !q.currentWindow || t.windowId === 1)),
        get: async (id) => { const t = state.tabs.find((t) => t.id === id); if (!t) throw Error('No tab'); return copy(t); },
        remove: async (ids) => { const list = [].concat(ids); state.removed.push(...list); state.tabs = state.tabs.filter((t) => !list.includes(t.id)); },
        ungroup: async () => {}, group: async () => 7, move: async () => {},
        onCreated: event('created'), onRemoved: event('removed'), onUpdated: event('updated'),
        onMoved: event('moved'), onAttached: event('attached'), onDetached: event('detached'),
      },
      tabGroups: { update: async () => {} },
      windows: { getCurrent: async () => ({ id: 1 }), onRemoved: event('windowRemoved') },
      storage: { local: {
        get: async () => ({ ...copy(state.preferences), koiArchived: copy(state.saved) }),
        set: async (obj) => { if ('koiArchived' in obj) { state.writes++; state.saved = copy(obj.koiArchived); } else { Object.assign(state.preferences, copy(obj)); } },
      } },
      bookmarks: { getTree: async () => [] },
      runtime: { getManifest: () => ({ version: '5.3.0' }), getURL: (url) => url },
    }, fixture: copy(tabs),
  });
  vm.runInContext(source, context);
  const run = (script) => vm.runInContext(script, context);
  run('allTabs = fixture; currentWindowId = 1');
  return { state, context, run, elements, settings, events, timers, created, init: () => init() };
}

test('dedupe preserves hash routes, path slashes and query slashes; exact copies still close', async () => {
  const urls = ['https://app.example/#/one', 'https://app.example/#/two',
    'https://app.example/a', 'https://app.example/a/',
    'https://app.example/?path=a', 'https://app.example/?path=a/'];
  const x = setup([...urls.map((url, i) => tab(i + 1, url)), tab(7, urls[0])]);
  await x.run('closeDuplicatesCore()');
  assert.deepEqual(x.state.removed, [7]);
});

test('archive saves every distinct route before closing all eligible tabs', async () => {
  const urls = ['https://app.example/#/one', 'https://app.example/#/two'];
  const x = setup([...urls.map((url, i) => tab(i + 1, url)), tab(3, urls[0])]);
  const remove = x.context.chrome.tabs.remove;
  x.context.chrome.tabs.remove = async (id) => {
    assert.equal(x.state.saved.length, 2, 'all destinations must be saved before the first close');
    return remove(id);
  };
  const result = await x.run('archiveCore()');
  assert.deepEqual(x.state.saved.map((r) => r.url), urls);
  assert.deepEqual(x.state.removed, [1, 2, 3]);
  assert.equal(result.archived, 2);
});

test('search deletion preserves hidden results and favorites added after the view was loaded', async () => {
  const a = favorite('a', 'https://example.com/a');
  const b = favorite('b', 'https://example.com/b');
  const c = favorite('c', 'https://example.com/c');
  const x = setup([], [a, b]);
  await x.run('loadFavorites()');
  x.state.saved.push(c);
  await x.run('clearKoiFolder({...favData[0], items: [favData[0].items[0]]})');
  assert.match(x.state.confirms[0], /当前显示的 1 条/);
  assert.deepEqual(x.state.saved.map((r) => r.id), ['b', 'c']);
});

test('cancelled deletion and browser bookmarks leave storage unchanged', async () => {
  const a = favorite('a', 'https://example.com/a');
  const x = setup([], [a]);
  x.context.chrome.bookmarks.getTree = async () => [{ id: '0', children: [{ id: '1', title: 'Bookmarks', children: [{ id: 'browser', title: 'Browser', url: 'https://browser.example/' }] }] }];
  await x.run('loadFavorites()');
  x.state.confirmResult = false;
  await x.run('clearKoiFolder(favData.find(g => g.kind === "koi"))');
  assert.equal(x.state.writes, 0);
  await x.run('removeFavorite(favData.find(g => g.kind === "koi").items[0])');
  assert.equal(x.run('favData.find(g => g.kind === "browser").items[0].id'), 'browser');
});

test('deletion with invalidated view cache only deletes requested IDs', async () => {
  const x = setup([], [favorite('a', 'https://a.example/'), favorite('b', 'https://b.example/')]);
  await x.run('removeFavorite({id: "a"})');
  assert.deepEqual(x.state.saved.map((r) => r.id), ['b']);
});

for (const failure of ['read', 'write', 'corrupt']) {
  test(`archive ${failure} failure never overwrites old data or closes tabs`, async () => {
    const saved = failure === 'corrupt' ? { broken: true } : [favorite('old', 'https://old.example/')];
    const x = setup([tab(1, 'https://new.example/')], saved);
    if (failure === 'read') x.context.chrome.storage.local.get = async () => { throw Error('read failure'); };
    if (failure === 'write') x.context.chrome.storage.local.set = async () => { throw Error('quota'); };
    const result = await x.run('archiveCore()');
    assert.ok(result.error);
    assert.deepEqual(x.state.saved, saved);
    assert.deepEqual(x.state.removed, []);
    assert.equal(x.state.writes, 0);
  });
}

test('failed deletion preserves both stored data and visible favorites', async () => {
  const saved = [favorite('a', 'https://a.example/')];
  const x = setup([], saved);
  await x.run('loadFavorites()');
  x.context.chrome.storage.local.set = async () => { throw Error('disk failure'); };
  await x.run('removeFavorite(favData[0].items[0])');
  assert.deepEqual(x.state.saved, saved);
  assert.equal(x.run('favTotal()'), 1);
  assert.equal(x.run('operationBusy'), false);
});

for (const [name, changes] of Object.entries({
  navigation: { url: 'https://new.example/' },
  active: { active: true }, pinned: { pinned: true },
  pendingNavigation: { pendingUrl: 'https://next.example/' },
  movedWindow: { windowId: 2 }, revisited: { lastAccessed: NOW },
})) {
  test(`archive skips a tab whose ${name} changes while saving`, async () => {
    const x = setup([tab(1, 'https://old.example/')]);
    const set = x.context.chrome.storage.local.set;
    x.context.chrome.storage.local.set = async (obj) => {
      await set(obj);
      Object.assign(x.state.tabs[0], changes);
    };
    const result = await x.run('archiveCore()');
    assert.deepEqual(x.state.removed, []);
    assert.equal(result.skippedChanged, 1);
    assert.equal(x.state.saved[0].url, 'https://old.example/');
  });
}

test('archive tolerates disappeared tabs and still processes other safe tabs', async () => {
  const x = setup([tab(1, 'https://a.example/'), tab(2, 'https://b.example/')]);
  const set = x.context.chrome.storage.local.set;
  x.context.chrome.storage.local.set = async (obj) => { await set(obj); x.state.tabs.shift(); };
  const result = await x.run('archiveCore()');
  assert.equal(result.failed, 1);
  assert.deepEqual(x.state.removed, [2]);
});

for (const action of ['tidyAll', 'archiveAll']) {
  test(`${action} remains locked across refreshes and prevents other mutations`, async () => {
    const x = setup([tab(1, 'https://a.example/'), tab(2, 'https://a.example/')]);
    await x.init();
    const entered = deferred();
    const gate = deferred();
    let calls = 0;
    if (action === 'tidyAll') {
      x.context.chrome.tabs.remove = async () => { calls++; entered.resolve(); await gate.promise; };
    } else {
      x.context.chrome.storage.local.set = async () => { calls++; entered.resolve(); await gate.promise; };
    }
    const running = x.run(`${action}()`);
    await entered.promise;
    await x.run('loadTabs()');
    assert.equal(x.elements.get('btn-tidy').disabled, true);
    assert.equal(x.elements.get('btn-archive').disabled, true);
    assert.ok(x.settings.every((e) => e.disabled));
    await x.run('tidyAll()');
    await x.run('archiveAll()');
    await x.run('removeFavorite({id:"a"})');
    await x.run('setView("fav")');
    for (const [id, dataset] of [['seg-scope', { scope: 'all' }], ['seg-days', { days: '30' }], ['seg-auto', { auto: '0' }]]) {
      await x.elements.get(id).listeners.click({ target: { closest: () => ({ dataset }) } });
    }
    assert.equal(x.run('scope'), 'window');
    assert.equal(x.run('archiveDays'), 7);
    assert.equal(x.run('autoCollapseN'), 8);
    assert.equal(x.run('view'), 'ops');
    assert.equal(calls, 1);
    gate.resolve();
    await running;
    assert.equal(x.run('operationBusy'), false);
    assert.ok(x.settings.every((e) => !e.disabled));
  });
}

test('execution lock releases after an unexpected failure', async () => {
  const x = setup();
  await assert.rejects(x.run('runExclusive(async () => { throw new Error("failure"); })'), /failure/);
  assert.equal(x.run('operationBusy'), false);
  assert.equal(await x.run('runExclusive(async () => 42)'), 42);
});

for (const locale of ['zh', 'en', 'ja', 'ko', 'la']) {
  test(`${locale}: language persists, diagnostics translate, and user data stays intact`, async () => {
    const x = setup([
      tab(1, 'chrome://extensions/', { title: '用户自定义标签' }),
      tab(2, 'https://example.org/#one'), tab(3, 'https://example.org/#one'),
    ], [favorite('saved', 'https://saved.example/')]);
    await x.init();
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, `../extension/locales/${locale}.json`)));
    await x.run(`KoiI18n.setLanguage('${locale}')`);
    x.run('diagnosed = true; render()');
    assert.equal(x.run('KoiI18n.locale'), locale);
    assert.equal(x.state.preferences.koiLanguage, locale);
    assert.equal(x.context.document.documentElement.lang, locale === 'zh' ? 'zh-CN' : locale);
    assert.equal(x.state.actionTitle, `KoiTab · ${catalog['一键整理']}`);
    assert.equal(x.run('metricRows(computeMetrics())[0].label'), catalog['重复网页']);
    assert.equal(x.run('displayDomain(normalizeDomain("chrome://extensions/"))'), catalog['浏览器页面']);
    assert.equal(x.run('normalizeDomain("chrome://extensions/")'), '浏览器页面');
    assert.equal(x.run('favoriteLabel({kind:"browser", label:"浏览器页面"})'), '浏览器页面');
    assert.equal(x.run('allTabs[0].title'), '用户自定义标签');
    assert.equal(x.state.writes, 0);
    assert.deepEqual(x.state.removed, []);
    assert.equal(x.state.saved.length, 1);
    const reopened = setup([], [], { preferences: x.state.preferences, browserLanguage: 'de-DE' });
    await reopened.init();
    assert.equal(reopened.run('KoiI18n.locale'), locale);
    // Safety rules are independent of the displayed language.
    const plan = x.run('planCollect(allTabs, currentWindowId)');
    assert.ok(!JSON.stringify(plan).includes('chrome://extensions/'));
  });
}

test('automatic language uses browser language, unsupported languages fall back to English', async () => {
  for (const [browserLanguage, expected] of [['zh-TW','zh'],['en-GB','en'],['ja-JP','ja'],['ko_KR','ko'],['la','la'],['fr-FR','en']]) {
    const x = setup([], [], { browserLanguage });
    await x.init();
    assert.equal(x.run('KoiI18n.locale'), expected);
    assert.equal(x.run('KoiI18n.preference'), 'auto');
  }
  const x = setup([], [], { browserLanguage: 'ja-JP', preferences: { koiLanguage: '../../invalid' } });
  await x.init();
  assert.equal(x.run('KoiI18n.locale'), 'ja');
  await x.run('KoiI18n.setLanguage("en")');
  await x.run('KoiI18n.setLanguage("auto")');
  assert.equal(x.run('KoiI18n.locale'), 'ja');
});

test('failed language load or persistence keeps current locale and data unchanged', async () => {
  const x = setup([], [favorite('saved', 'https://example.org')]);
  await x.init();
  x.context.fetch = async () => { throw Error('catalog unavailable'); };
  await assert.rejects(x.run('KoiI18n.setLanguage("la")'), /catalog unavailable/);
  assert.equal(x.run('KoiI18n.locale'), 'zh');
  x.context.fetch = async () => ({ok: true, json: async () => JSON.parse(fs.readFileSync(path.join(__dirname,'../extension/locales/en.json')))});
  x.context.chrome.storage.local.set = async () => { throw Error('storage unavailable'); };
  x.elements.get('language').value = 'en';
  await x.elements.get('language').listeners.change({target: x.elements.get('language')});
  assert.equal(x.run('KoiI18n.locale'), 'zh');
  assert.equal(x.state.saved.length, 1);
  assert.equal(x.run('operationBusy'), false);
  assert.equal(x.elements.get('language').disabled, false);
  assert.equal(x.elements.get('toast').textContent, '语言设置失败,请重试');
});

test('translated placeholders preserve literal user text and localized confirmation protects hidden entries', async () => {
  const x = setup([], [favorite('visible','https://a.example/'), favorite('hidden','https://b.example/')]);
  await x.init();
  await x.run('KoiI18n.setLanguage("en")');
  const value = '<img src=x> $& {1}';
  x.context.titleFixture = value;
  assert.equal(x.run('tr("折叠 {0}", titleFixture)'), `Collapse ${value}`);
  await x.run('clearKoiFolder({kind:"koi",label:"a.example",items:[{id:"visible"}]})');
  assert.match(x.state.confirms[0], /Delete 1 visible KoiTab entries/);
  assert.match(x.state.confirms[0], /Hidden entries, browser bookmarks and open tabs will remain unchanged/);
  assert.deepEqual(x.state.saved.map((x) => x.id), ['hidden']);
});

test('language selector cannot run during a destructive operation', async () => {
  const x = setup();
  await x.init();
  const gate = deferred();
  x.context.languageGate = gate.promise;
  const running = x.run('runExclusive(() => languageGate)');
  assert.equal(x.elements.get('language').disabled, true);
  x.elements.get('language').value = 'en';
  await x.elements.get('language').listeners.change({target:x.elements.get('language')});
  assert.equal(x.run('KoiI18n.locale'), 'zh');
  assert.equal(x.elements.get('language').value, 'auto');
  gate.resolve();
  await running;
  assert.equal(x.elements.get('language').disabled, false);
});

test('grouping presets distinguish hosts, Google app routes and file suffixes without splitting document IDs', () => {
  const x = setup();
  const key = (url, mode) => x.run(`groupingKey(${JSON.stringify(url)}, '${mode}')`);
  assert.equal(key('https://mail.google.com/mail/u/0', 'site'), 'google.com');
  assert.equal(key('https://docs.google.com/document/d/a', 'site'), 'google.com');
  assert.equal(key('https://mail.google.com/mail/u/0', 'host'), 'mail.google.com');
  assert.equal(key('https://docs.google.com/spreadsheets/d/a', 'host'), 'docs.google.com');
  for (const [route, title] of [['document','Docs'], ['spreadsheets','Sheets'], ['presentation','Slides'], ['forms','Forms']]) {
    assert.equal(key(`https://docs.google.com/${route}/d/a?x=1#edit`, 'smart'), `docs.google.com · ${title}`);
    assert.equal(key(`https://docs.google.com/${route}/u/2/d/b`, 'smart'), `docs.google.com · ${title}`);
  }
  for (const [suffix, label] of [['XLSX','Excel'],['xls','Excel'],['docx','Docs'],['pdf','PDF'],['pptx','Slides'],['csv','CSV']]) {
    assert.equal(key(`https://files.example.com/a.${suffix}?download=1#page=3`, 'smart'), `files.example.com · ${label}`);
  }
  assert.equal(key('https://files.example.com/a%2Exlsx', 'smart'), 'files.example.com · Excel');
  assert.equal(key('https://files.example.com/view?file=a.xlsx#b.docx', 'smart'), 'files.example.com');
  assert.equal(key('https://docs.google.com/documentation/a', 'smart'), 'docs.google.com');
  assert.equal(key('https://app.example/a/123', 'smart'), key('https://app.example/b/456', 'smart'));
  assert.equal(key('chrome://extensions/', 'smart'), '浏览器页面');
  assert.equal(key('file:///tmp/test.xlsx', 'smart'), '本地文件 · Excel');
  assert.equal(key('https://a.example.co.uk/a', 'site'), 'example.co.uk');
  assert.notEqual(key('https://a.github.io/', 'site'), key('https://b.github.io/', 'site'));
});

test('grouping preference persists without mutating tabs or archives and rolls back a failed save', async () => {
  const x = setup([tab(1, 'https://mail.google.com/')], [favorite('old', 'https://docs.google.com/')]);
  await x.init();
  const selector = x.elements.get('grouping-mode');
  assert.equal(selector.value, 'site');
  selector.value = 'smart';
  await selector.listeners.change({target: selector});
  assert.equal(x.run('groupingMode'), 'smart');
  assert.equal(x.state.preferences.koiGrouping, 'smart');
  assert.equal(x.state.writes, 0);
  assert.deepEqual(x.state.removed, []);
  assert.equal(x.state.saved[0].domain, 'docs.google.com');
  const reopened = setup([], [], {preferences: x.state.preferences});
  await reopened.init();
  assert.equal(reopened.run('groupingMode'), 'smart');
  x.context.chrome.storage.local.set = async () => { throw Error('disk'); };
  selector.value = 'host';
  await selector.listeners.change({target:selector});
  assert.equal(x.run('groupingMode'), 'smart');
  assert.equal(selector.value, 'smart');
  assert.equal(x.elements.get('toast').textContent, '分组设置保存失败,请重试');
  const invalid = setup([], [], {preferences:{koiGrouping:'unknown'}});
  await invalid.init();
  assert.equal(invalid.run('groupingMode'), 'site');
});

test('grouping preference is locked throughout a running operation', async () => {
  const x = setup(); await x.init();
  const gate = deferred(); x.context.modeGate = gate.promise;
  const running = x.run('runExclusive(() => modeGate)');
  const selector = x.elements.get('grouping-mode');
  assert.equal(selector.disabled, true);
  selector.value = 'smart';
  await selector.listeners.change({target:selector});
  assert.equal(x.run('groupingMode'), 'site');
  assert.equal(selector.value, 'site');
  gate.resolve(); await running;
  assert.equal(selector.disabled, false);
});

// Model native grouping and ordered moves so assertions check final browser state,
// not only the grouping plan. No real browser tabs are touched.
function modelBrowser(x) {
  let groupId = 100;
  const calls = {move: [], group: [], query: 0, windows: [], titles: new Map()};
  const api = x.context.chrome.tabs;
  const query = api.query;
  api.query = async (q) => { calls.query++; return query(q); };
  api.ungroup = async (ids) => {
    for (const id of [].concat(ids)) x.state.tabs.find((t) => t.id === id).groupId = -1;
    x.events.updated?.(ids[0], {groupId:-1});
  };
  api.group = async ({tabIds, createProperties}) => {
    const members = tabIds.map((id) => x.state.tabs.find((t) => t.id === id));
    assert.ok(members.every((t) => t && !t.pinned && t.windowId === createProperties.windowId));
    const id = groupId++;
    for (const t of members) t.groupId = id;
    calls.group.push(copy(tabIds));
    x.events.updated?.(tabIds[0], {groupId:id});
    return id;
  };
  x.context.chrome.tabGroups.update = async (id, update) => { calls.titles.set(id, update.title); };
  api.move = async (ids, props) => {
    calls.move.push(copy([].concat(ids)));
    for (const id of [].concat(ids)) {
      const t = x.state.tabs.find((t) => t.id === id);
      assert.ok(t && !t.pinned);
      if (props.windowId != null) { t.windowId = props.windowId; t.groupId = -1; }
      t.index = 1 + Math.max(-1, ...x.state.tabs.filter((row) => row.windowId === t.windowId).map((row) => row.index));
      x.events.moved?.(id, {});
    }
  };
  x.context.chrome.windows.create = async ({tabId, focused}) => {
    assert.equal(focused, false);
    const t = x.state.tabs.find((t) => t.id === tabId);
    const id = 50 + calls.windows.length;
    t.windowId = id; t.index = 0; t.groupId = -1;
    calls.windows.push(id);
    return {id};
  };
  return calls;
}

for (const scope of ['window', 'all']) {
  test(`${scope}: changing granularity splits existing mixed groups, preserves pinned tabs and is repeatable`, async () => {
    const x = setup([
      tab(1, 'https://docs.google.com/document/d/a', {groupId:9}),
      tab(2, 'https://docs.google.com/document/d/b', {groupId:9}),
      tab(3, 'https://docs.google.com/spreadsheets/d/a', {groupId:9}),
      tab(4, 'https://docs.google.com/presentation/d/a', {groupId:9}),
      tab(5, 'https://mail.google.com/', {pinned:true}),
    ], [], {preferences:{koiGrouping:'smart', koiScope:scope}});
    const calls = modelBrowser(x); await x.init();
    assert.ok(x.run('computeMetrics().tidySteps.length') > 0);
    await x.run('tidyAll()');
    assert.equal(x.state.tabs.length, 5);
    assert.equal(x.state.tabs[0].groupId, x.state.tabs[1].groupId);
    assert.equal(calls.titles.get(x.state.tabs[0].groupId), 'docs.google.com · Docs');
    assert.equal(x.state.tabs[2].groupId, -1);
    assert.equal(x.state.tabs[3].groupId, -1);
    assert.equal(x.state.tabs[4].windowId, 1);
    assert.equal(x.state.tabs[4].pinned, true);
    const before = [calls.move.length, calls.group.length, calls.windows.length];
    await x.run('tidyAll()');
    assert.deepEqual([calls.move.length, calls.group.length, calls.windows.length], before);
  });
}

test('mixed singletons still enable organize and become independent ungrouped tabs', async () => {
  const x = setup([tab(1,'https://mail.google.com/',{groupId:9}),tab(2,'https://docs.google.com/',{groupId:9})]);
  modelBrowser(x); x.run("groupingMode = 'host'");
  assert.ok(x.run('computeMetrics().tidySteps.length') > 0);
  await x.run('tidyAll()');
  assert.ok(x.state.tabs.every((t) => t.groupId === -1));
});

test('400 cross-window tabs use one batch move and bounded queries/renders despite 400 move events', async () => {
  const x = setup(Array.from({length:401}, (_,i) => tab(i+1, `https://example.com/${i}`, {windowId:i ? 2 : 1})), [], {preferences:{koiScope:'all'}});
  const calls = modelBrowser(x); await x.init();
  x.run('let rendered = 0; const originalRender = render; render = () => { rendered++; originalRender(); };');
  const beforeQueries = calls.query;
  await x.run('tidyAll()');
  assert.equal(calls.move.length, 1);
  assert.equal(calls.move[0].length, 400);
  assert.ok(x.state.tabs.every((t) => t.windowId === 1));
  assert.ok(calls.query - beforeQueries <= 8);
  assert.equal(x.run('rendered'), 2);
  assert.equal(x.created.filter((e) => e.className === 'koi-row').length, 0, 'hidden tab list must not build 401 rows');
});

test('batch reorder preserves loose-tab order and never moves pinned or grouped tabs', async () => {
  const x = setup([tab(9,'https://a.example/',{index:0}),tab(8,'https://b.example/',{index:1,pinned:true}),
    tab(7,'https://c.example/',{index:2,groupId:10}),tab(6,'https://c.example/b',{index:3,groupId:10}),
    tab(3,'https://d.example/',{index:4})]);
  const calls = modelBrowser(x);
  await x.run('reorderCore()');
  assert.deepEqual(calls.move, [[9,3]]);
  assert.ok(x.state.tabs.find((t)=>t.id===9).index < x.state.tabs.find((t)=>t.id===3).index);
});

test('a partially failed batch retries in order and leaves unavailable tabs out of the target group', async () => {
  const x = setup([tab(1,'https://a.example/1'),tab(2,'https://a.example/2',{windowId:2}),tab(3,'https://a.example/3',{windowId:2})]);
  x.run("scope='all'");
  const calls = modelBrowser(x);
  const move = x.context.chrome.tabs.move;
  x.context.chrome.tabs.move = async (ids, props) => {
    if (Array.isArray(ids)) { await move(ids[0], props); throw Error('batch interrupted'); }
    if (ids === 3) throw Error('cannot move');
    return move(ids, props);
  };
  await x.run('collectCore()');
  assert.deepEqual(calls.group, [[1,2]]);
  assert.equal(x.state.tabs[2].windowId, 2);
});

test('a burst of external events produces one refresh and an older read cannot overwrite a newer snapshot', async () => {
  const x = setup(); await x.init();
  let queries = 0;
  x.context.chrome.tabs.query = async () => { queries++; return []; };
  for (let i=0; i<500; i++) x.events.moved(i, {});
  assert.equal(x.timers.size, 1);
  const callback = [...x.timers.values()][0]; x.timers.clear(); callback();
  await new Promise(setImmediate);
  assert.equal(queries, 1);
  const old = deferred(); const recent = deferred(); let count = 0;
  x.context.chrome.tabs.query = () => ++count === 1 ? old.promise : recent.promise;
  const first = x.run('loadTabs()'); const second = x.run('loadTabs()');
  recent.resolve([tab(2,'https://new.example/')]); await second;
  old.resolve([tab(1,'https://old.example/')]); await first;
  assert.equal(x.run('allTabs[0].id'), 2);
});

test('a pure group gets its generated title updated on mode change, while custom titles remain intact', async () => {
  for (const title of ['google.com', 'My research']) {
    const x = setup([tab(1,'https://docs.google.com/document/d/a',{groupId:9}),tab(2,'https://docs.google.com/document/d/b',{groupId:9})],[],{preferences:{koiGrouping:'smart'}});
    const calls = modelBrowser(x); calls.titles.set(9, title);
    x.context.chrome.tabGroups.query = async () => [...calls.titles].map(([id,title]) => ({id,title}));
    await x.init();
    assert.equal(x.run('computeMetrics().tidySteps.length > 0'), title === 'google.com');
    await x.run('tidyAll()');
    assert.equal(calls.group.length, 0, 'title-only changes must not move or regroup tabs');
    assert.equal(calls.titles.get(9), title === 'google.com' ? 'docs.google.com · Docs' : title);
    assert.equal(x.run('computeMetrics().tidySteps.length'), 0);
  }
});

for (const scope of ['window','all']) {
  test(`ungroup all in ${scope} scope preserves tabs, URLs, windows, positions, pins and archives`, async () => {
    const x = setup([tab(1,'https://a.example/1',{groupId:8}),tab(2,'https://b.example/2',{groupId:8}),
      tab(3,'https://c.example/',{groupId:9,windowId:2}),tab(4,'https://a.example/1',{pinned:true}),
      tab(5,'https://a.example/1')], [favorite('saved','https://saved.example/')], {preferences:{koiScope:scope}});
    const calls = modelBrowser(x); await x.init();
    const before = copy(x.state.tabs);
    await x.run('removeBrowserGroups()');
    assert.deepEqual(x.state.tabs.map(({groupId,...rest})=>rest), before.map(({groupId,...rest})=>rest));
    assert.deepEqual(x.state.tabs.map((t)=>t.groupId), [-1,-1,scope==='all'?-1:9,-1,-1]);
    assert.equal(x.state.writes,0); assert.deepEqual(x.state.removed,[]);
    assert.deepEqual(calls.move,[]); assert.deepEqual(calls.group,[]); assert.deepEqual(calls.windows,[]);
    assert.equal(x.elements.get('toast').textContent,'已取消分组，所有标签页保持打开');
  });
}

test('single group cancellation uses native ID, includes search-hidden/new members, and preserves same-domain groups', async () => {
  const x = setup([tab(1,'https://a.example/visible',{groupId:8}),tab(2,'https://b.example/hidden',{groupId:8}),
    tab(3,'https://a.example/other',{groupId:9})]);
  modelBrowser(x); await x.init(); x.run("query='visible'; view='tabs'; render()");
  x.state.tabs.push(tab(4,'https://c.example/new',{groupId:8}));
  await x.run('removeBrowserGroups(8)');
  assert.deepEqual(x.state.tabs.map((t)=>t.groupId), [-1,-1,9,-1]);
  assert.deepEqual(x.state.removed,[]);
  await x.run('removeBrowserGroups(1234)');
  assert.equal(x.state.tabs[2].groupId,9);
  assert.equal(x.elements.get('toast').textContent,'此范围内没有浏览器分组');
});

test('ungroup fallback skips closed or reassigned tabs and reports partial failures', async () => {
  const x = setup([1,2,3,4].map((id)=>tab(id,`https://a.example/${id}`,{groupId:8})));
  modelBrowser(x); await x.init();
  const ungroup = x.context.chrome.tabs.ungroup;
  x.context.chrome.tabs.ungroup = async (ids) => {
    if (Array.isArray(ids)) {
      x.state.tabs = x.state.tabs.filter((t)=>t.id!==1);
      x.state.tabs.find((t)=>t.id===2).groupId=99;
      throw Error('stale batch');
    }
    if(ids===3) throw Error('browser refused');
    return ungroup(ids);
  };
  await x.run('removeBrowserGroups(8)');
  assert.deepEqual(x.state.tabs.map((t)=>[t.id,t.groupId]), [[2,99],[3,8],[4,-1]]);
  assert.match(x.elements.get('toast').textContent,/有 1 个标签页未能取消分组/);
  assert.deepEqual(x.state.removed,[]);
});

test('ungroup lock prevents overlapping organize, archive, scope changes and repeated clicks', async () => {
  const x = setup([tab(1,'https://a.example/',{groupId:8}),tab(2,'https://a.example/',{groupId:8})],[],{preferences:{koiView:'tabs'}});
  modelBrowser(x); await x.init();
  const gate=deferred(), entered=deferred(); let calls=0;
  x.context.chrome.tabs.ungroup=async()=>{calls++;entered.resolve();await gate.promise;};
  const running=x.run('removeBrowserGroups(8)');await entered.promise;
  assert.equal(x.elements.get('btn-ungroup-all').disabled,true);
  await x.run('tidyAll()'); await x.run('archiveAll()'); await x.run('removeBrowserGroups()');
  const selector=x.elements.get('group-scope');selector.value='all';
  await selector.listeners.change({target:selector});
  assert.equal(x.run('scope'),'window'); assert.equal(selector.value,'window');
  assert.equal(calls,1); assert.deepEqual(x.state.removed,[]); assert.equal(x.state.writes,0);
  gate.resolve();await running;assert.equal(x.run('operationBusy'),false);
});

test('native group list is distinct from virtual site categories and accurately disables ungroup after removal', async () => {
  const x=setup([tab(1,'https://a.example/',{groupId:8}),tab(2,'https://a.example/2',{groupId:8})],[],{preferences:{koiView:'tabs'}});
  modelBrowser(x);x.context.chrome.tabGroups.query=async()=>[{id:8,title:'My custom group'}];await x.init();
  const button=x.created.find((e)=>e.className==='koi-link-btn koi-ungroup');
  assert.equal(button.attributes['aria-label'],'取消分组：My custom group');
  await button.listeners.click();
  assert.equal(x.elements.get('native-group-summary').textContent,'浏览器分组（0）');
  assert.equal(x.elements.get('btn-ungroup-all').disabled,true);
  assert.equal(x.run('groupTabsByDomain(allTabs).length'),1);
});


test('ungroup keeps an immutable membership snapshot even when query results are shared objects', async () => {
  const x=setup([tab(1,'https://example.com/',{groupId:8})]);
  modelBrowser(x); x.context.chrome.tabs.query=async()=>x.state.tabs;
  await x.init(); await x.run('removeBrowserGroups(8)');
  assert.equal(x.elements.get('toast').textContent,'已取消分组，所有标签页保持打开');
});
