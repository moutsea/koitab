const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the shipped popup source; Chrome and DOM are isolated in memory.
const source = fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8');
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
function setup(tabs = [], saved = []) {
  const state = { tabs: copy(tabs), saved: copy(saved), removed: [], writes: 0, confirms: [], confirmResult: true };
  const elements = new Map();
  const created = [];
  function element() {
    const e = {
      style: {}, dataset: {}, children: [], listeners: {}, textContent: '', disabled: false,
      classList: { add() {}, remove() {}, toggle() {} },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); },
      setAttribute() {},
      addEventListener(event, cb) { this.listeners[event] = cb; },
    };
    return e;
  }
  const settings = ['scope', 'days', 'auto'].map(() => element());
  let init;
  const document = {
    addEventListener(event, cb) { if (event === 'DOMContentLoaded') init = cb; },
    createElement() { const e = element(); created.push(e); return e; },
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    querySelector() { return element(); },
    querySelectorAll(selector) {
      if (selector.includes('#seg-scope button')) return [...settings, ...created.filter((e) => /koi-close|koi-fav-openall/.test(e.className || ''))];
      return [];
    },
  };
  const event = { addListener() {} };
  class Clock extends Date { static now() { return NOW; } }
  const context = vm.createContext({
    URL, Date: Clock, console: { warn() {}, error() {} },
    setTimeout() {}, clearTimeout() {}, document,
    window: { confirm(msg) { state.confirms.push(msg); return state.confirmResult; } },
    chrome: {
      tabs: {
        query: async (q) => copy(state.tabs.filter((t) => !q.currentWindow || t.windowId === 1)),
        get: async (id) => { const t = state.tabs.find((t) => t.id === id); if (!t) throw Error('No tab'); return copy(t); },
        remove: async (ids) => { const list = [].concat(ids); state.removed.push(...list); state.tabs = state.tabs.filter((t) => !list.includes(t.id)); },
        ungroup: async () => {}, group: async () => 7, move: async () => {},
        onCreated: event, onRemoved: event, onUpdated: event,
      },
      tabGroups: { update: async () => {} },
      windows: { getCurrent: async () => ({ id: 1 }), onRemoved: event },
      storage: { local: {
        get: async () => ({ koiArchived: copy(state.saved) }),
        set: async (obj) => { if ('koiArchived' in obj) { state.writes++; state.saved = copy(obj.koiArchived); } },
      } },
      bookmarks: { getTree: async () => [] },
      runtime: { getManifest: () => ({ version: '5.1.1' }) },
    }, fixture: copy(tabs),
  });
  vm.runInContext(source, context);
  const run = (script) => vm.runInContext(script, context);
  run('allTabs = fixture; currentWindowId = 1');
  return { state, context, run, elements, settings, init: () => init() };
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
