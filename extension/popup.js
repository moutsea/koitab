/* KoiTab popup logic */

const GROUP_COLORS = [
  'blue', 'cyan', 'green', 'yellow', 'orange',
  'red', 'pink', 'purple', 'grey',
];

const SCOPE_KEY = 'koiScope';
const GROUP_PREFS_KEY = 'koiGroupPrefs';
const LEGACY_COLLAPSED_KEY = 'koiCollapsed';   // 1.0.0 用的旧字段,做一次兼容迁移
const ARCHIVE_DAYS_KEY = 'koiArchiveDays';     // 归档阈值:几天没用
const FAV_COLLAPSE_KEY = 'koiFavCollapsed';    // 收藏夹各文件夹的折叠状态
// 收藏夹的两个分区:KoiTab 自己的收藏(可增删) / 浏览器书签(只读展示,可搜索)
const SEC_KOI = '@section:koi';
const SEC_BROWSER = '@section:browser';
const AUTO_COLLAPSE_KEY = 'koiAutoCollapse';   // 折叠阈值:一组达到几个标签页就自动收起
const GROUPING_KEY = 'koiGrouping';
const GROUPING_MODES = ['site', 'host', 'smart'];
let groupingMode = 'site';
let refreshTimer = null;
let refreshPending = false;
let loadRevision = 0;

const VIEW_KEY = 'koiView';                    // 记住上次停留的 tab
// KoiTab 收藏存在自己的存储里,和浏览器书签完全无关 ——
// 归档不再写 chrome.bookmarks,也就躲开了「书签树容器 id 各家不同」那整类环境病
const ARCHIVE_STORE_KEY = 'koiArchived';
const DAY_MS = 24 * 60 * 60 * 1000;

// 自动折叠阈值的默认值与档位(可在「操作」tab 里配置;0 = 从不自动折叠)
const AUTO_COLLAPSE_DEFAULT = 8;
const AUTO_COLLAPSE_OPTIONS = [5, 8, 12, 0];

let allTabs = [];
let nativeGroupTitles = new Map();
let query = '';
let scope = 'window';        // 'window' = 仅当前窗口,'all' = 所有窗口
let windowChips = new Map(); // windowId -> 徽标文案('本' / '2' / '3' …)
let windowCount = 1;
let currentWindowId = null;  // 弹窗所在窗口,用于并列时优先选它
// 站点折叠偏好:domain -> 'collapsed' | 'expanded'(只记录用户明确操作过的站点)
let groupPrefs = {};
// 归档阈值(天):多久没用算「长期未用」
let archiveDays = 7;
// 自动折叠阈值(个):达到就收起,0 = 从不
let autoCollapseN = AUTO_COLLAPSE_DEFAULT;
// 当前停留的 tab:'ops' | 'tabs' | 'fav'(首次打开停在「诊断」,与 HTML 初始高亮一致)
let view = 'ops';
// 是否已经点过「开始诊断」(本次弹窗会话内)
let diagnosed = false;
// 收藏夹数据:null = 还没加载过
let favData = null;
let favLoading = false;
let favQuery = '';         // 「收藏夹」tab 自己的搜索词
// 文件夹折叠偏好:label -> 'collapsed' | 'expanded'(只记录明确点过的)
let favPrefs = {};
// 整理、归档和删除共用执行锁;render 和事件刷新不能解除它。
let operationBusy = false;

async function runExclusive(action) {
  if (operationBusy) return;
  operationBusy = true;
  ++loadRevision; // Invalidate reads started before the operation.
  clearTimeout(refreshTimer);
  refreshTimer = null;
  try {
    render();
    return await action();
  } finally {
    try {
      if (refreshPending) await loadTabs();
    } finally {
      operationBusy = false;
      render();
      if (refreshPending) scheduleTabRefresh();
    }
  }
}

/** 缺少存储键代表尚未归档;读取失败或数据损坏不能当作空收藏覆盖。 */
async function readArchived() {
  const got = await chrome.storage.local.get(ARCHIVE_STORE_KEY);
  const rows = got[ARCHIVE_STORE_KEY];
  if (rows === undefined) return [];
  if (!Array.isArray(rows) || rows.some((r) => !r || typeof r.url !== 'string')) {
    throw new Error(tr("收藏数据格式异常,已保留原数据"));
  }
  return rows;
}

/* ---------- helpers ---------- */

/**
 * 常见的「多段公共后缀」。扩展拿不到公共后缀列表(PSL),所以用
 * 「最后两段 + 这份兜底表」来取可注册域名,避免把 a.com.cn 与 b.com.cn
 * 误判成同一个站点。
 *
 * 其中 github.io / blogspot.com 这类是"私有后缀":每个子域都是独立站点,
 * 所以列进来让它们保留三段(user1.github.io ≠ user2.github.io)。
 */
const MULTI_LABEL_SUFFIXES = new Set([
  // 国家/地区二级域名
  'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn', 'ac.cn',
  'com.hk', 'com.tw', 'com.sg', 'com.my', 'com.ph', 'com.vn', 'com.tr',
  'com.au', 'net.au', 'org.au', 'co.nz', 'co.uk', 'org.uk', 'ac.uk', 'gov.uk',
  'co.jp', 'ne.jp', 'or.jp', 'co.kr', 'or.kr', 'co.in', 'co.th', 'co.id',
  'com.br', 'com.mx', 'com.ar', 'com.co', 'com.pe', 'com.ua', 'com.sa',
  // 私有后缀:每个子域是独立站点
  'github.io', 'gitee.io', 'gitlab.io', 'pages.dev', 'vercel.app', 'netlify.app',
  'herokuapp.com', 'blogspot.com', 'wordpress.com', 'sites.google.com',
]);

/** 取「可注册域名」(eTLD+1):zhuanlan.zhihu.com 与 www.zhihu.com 都归为 zhihu.com */
function registrableDomain(hostname) {
  const host = String(hostname || '').replace(/\.$/, '').toLowerCase();
  if (!host) return '';
  if (/^\d+(\.\d+){3}$/.test(host)) return host;        // IP 地址原样返回
  const labels = host.split('.');
  if (labels.length <= 2) return host.replace(/^www\./, '');
  const lastTwo = labels.slice(-2).join('.');
  const keep = MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3) : labels.slice(-2);
  return keep.join('.').replace(/^www\./, '');
}

function normalizeDomain(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' ||
        u.protocol === 'about:' || u.protocol === 'chrome-extension:') {
      return '浏览器页面';
    }
    if (u.protocol === 'file:') return '本地文件';
    return registrableDomain(u.hostname) || u.origin || '其他';
  } catch {
    return '其他';
  }
}

// Only live tabs use this preference. Saved archives keep their original domain keys.
function groupingKey(url, mode = groupingMode) {
  const domain = normalizeDomain(url);
  if (mode === 'site') return domain;
  try {
    const u = new URL(url);
    if (!['http:', 'https:', 'file:'].includes(u.protocol)) return domain;
    const host = u.hostname.toLowerCase().replace(/\.$/, '') || domain;
    if (mode === 'host') return host;
    // Match known app routes, not arbitrary path segments or document IDs.
    const path = u.pathname.toLowerCase();
    const route = host === 'docs.google.com'
      ? path.match(/^\/(document|spreadsheets|presentation|forms)(?:\/|$)/)?.[1]
      : null;
    const app = { document: 'Docs', spreadsheets: 'Sheets', presentation: 'Slides', forms: 'Forms' }[route];
    if (app) return `${host} · ${app}`;
    // Query parameters and hashes do not decide a file type. Decode only the basename.
    let filename = path.slice(path.lastIndexOf('/') + 1);
    try { filename = decodeURIComponent(filename).toLowerCase(); } catch { /* Keep malformed names intact. */ }
    const ext = filename.match(/\.([a-z0-9]+)$/)?.[1];
    const kind = { xls: 'Excel', xlsx: 'Excel', xlsm: 'Excel', xlsb: 'Excel',
      ods: 'Sheets', csv: 'CSV', doc: 'Docs', docx: 'Docs', odt: 'Docs',
      ppt: 'Slides', pptx: 'Slides', odp: 'Slides', pdf: 'PDF' }[ext];
    return kind ? `${host} · ${kind}` : host;
  } catch { return domain; }
}

async function loadGrouping() {
  try {
    const saved = (await chrome.storage.local.get(GROUPING_KEY))[GROUPING_KEY];
    if (GROUPING_MODES.includes(saved)) groupingMode = saved;
  } catch { /* Default to the existing site grouping behavior. */ }
}

function syncGroupingUI() {
  document.getElementById('grouping-mode').value = groupingMode;
  document.getElementById('grouping-hint').textContent = groupingMode === 'site'
    ? tr('粗分：Gmail 和 Google 文档归入 google.com。')
    : groupingMode === 'host'
      ? tr('适中：mail.google.com 与 docs.google.com 分开。')
      : tr('细分：再区分 Google 文档、表格、幻灯片及 .xlsx、.docx、.pdf 等后缀；其他页面按子域名分组。');
}

// Internal group keys stay stable across locale changes and existing installs.
function displayDomain(domain) {
  if (domain.startsWith('本地文件 · ')) return tr('本地文件') + domain.slice('本地文件'.length);
  return ['浏览器页面', '本地文件', '其他'].includes(domain) ? tr(domain) : domain;
}
function favoriteLabel(group) {
  return group.kind === 'koi' ? displayDomain(group.label)
    : group.defaultLabel ? tr('书签') : group.label;
}

function faviconLetter(domain) {
  const ch = domain.replace(/^www\./, '')[0] || '?';
  return ch.toUpperCase();
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * 国画色(石色为主,色相沉稳不扎眼),替换原来的彩虹 hsl,
 * 让色点、印签底纹与水墨版面同调。同一站点恒定一色。
 */
const INK_PALETTE = [
  '#46586e', // 黛蓝
  '#3e6157', // 青黛
  '#4d6b52', // 松绿
  '#8f5e3f', // 赭石
  '#a63b2a', // 朱砂
  '#6b4a63', // 绛紫
  '#b08a3e', // 藤黄
  '#3c4a52', // 花青
  '#7a5c43', // 茶褐
  '#8892a6', // 月白
];

function domainColor(domain) {
  return INK_PALETTE[hashString(domain) % INK_PALETTE.length];
}

/** 同一站点在所有窗口使用同一个分组颜色,便于一眼对应 */
function colorForDomain(domain) {
  return GROUP_COLORS[hashString(domain) % GROUP_COLORS.length];
}

function normalizeUrlForDedupe(url) {
  try {
    // hash 可能是应用路由,路径及查询参数的末尾斜杠也可能有含义。
    return new URL(url).href;
  } catch {
    return url;
  }
}

function showToast(text) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => el.classList.remove('show'), 3600);
}

/* ---------- 配置:归档阈值 / 折叠阈值 / 当前 tab ---------- */

async function loadArchiveDays() {
  try {
    const stored = await chrome.storage.local.get(ARCHIVE_DAYS_KEY);
    const v = Number(stored && stored[ARCHIVE_DAYS_KEY]);
    if (v === 3 || v === 7 || v === 30) archiveDays = v;
  } catch { /* 用默认值 */ }
}

async function saveArchiveDays() {
  try {
    await chrome.storage.local.set({ [ARCHIVE_DAYS_KEY]: archiveDays });
  } catch { /* 忽略 */ }
}

async function loadAutoCollapse() {
  try {
    const stored = await chrome.storage.local.get(AUTO_COLLAPSE_KEY);
    const v = Number(stored && stored[AUTO_COLLAPSE_KEY]);
    if (AUTO_COLLAPSE_OPTIONS.includes(v)) autoCollapseN = v;
  } catch { /* 用默认值 */ }
}

async function saveAutoCollapse() {
  try {
    await chrome.storage.local.set({ [AUTO_COLLAPSE_KEY]: autoCollapseN });
  } catch { /* 忽略 */ }
}

async function loadView() {
  try {
    const stored = await chrome.storage.local.get(VIEW_KEY);
    const v = stored && stored[VIEW_KEY];
    if (v === 'ops' || v === 'tabs' || v === 'fav') view = v;
  } catch { /* 用默认值 */ }
}

function saveView() {
  try {
    chrome.storage.local.set({ [VIEW_KEY]: view });
  } catch { /* 忽略 */ }
}

/* ---------- scope ---------- */

async function loadScope() {
  try {
    const stored = await chrome.storage.local.get(SCOPE_KEY);
    if (stored && (stored[SCOPE_KEY] === 'all' || stored[SCOPE_KEY] === 'window')) {
      scope = stored[SCOPE_KEY];
    }
  } catch { /* 没有 storage 权限时用默认值 */ }
  syncScopeUI();
}

function saveScope() {
  try {
    chrome.storage.local.set({ [SCOPE_KEY]: scope });
  } catch { /* 忽略 */ }
}

function syncScopeUI() {
  document.querySelectorAll('.koi-scope-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.scope === scope);
  });
}

/* ---------- 站点折叠偏好(记忆到本地) ---------- */

async function loadCollapsed() {
  try {
    const stored = await chrome.storage.local.get([GROUP_PREFS_KEY, LEGACY_COLLAPSED_KEY]);
    const prefs = stored && stored[GROUP_PREFS_KEY];
    if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
      groupPrefs = { ...prefs };
    } else if (Array.isArray(stored && stored[LEGACY_COLLAPSED_KEY])) {
      // 兼容 1.0.0 的 koiCollapsed 数组,迁移成偏好表
      groupPrefs = Object.fromEntries(
        stored[LEGACY_COLLAPSED_KEY].map((d) => [d, 'collapsed']),
      );
    }
  } catch { /* 没有 storage 权限时用默认值 */ }
}

function saveCollapsed() {
  try {
    // 顺手清理已经不在当前标签列表里的站点,避免记录无限增长
    const alive = new Set(allTabs.map((t) => groupingKey(t.url)));
    const kept = {};
    for (const [domain, pref] of Object.entries(groupPrefs)) {
      if (alive.has(domain)) kept[domain] = pref;
    }
    groupPrefs = kept;
    chrome.storage.local.set({ [GROUP_PREFS_KEY]: kept });
  } catch { /* 忽略 */ }
}

/* 收藏夹各文件夹的折叠状态:与站点分组同一套「明确偏好」模型,单独存储互不串台 */
async function loadFavPrefs() {
  try {
    const stored = await chrome.storage.local.get(FAV_COLLAPSE_KEY);
    const prefs = stored && stored[FAV_COLLAPSE_KEY];
    if (prefs && typeof prefs === 'object' && !Array.isArray(prefs)) {
      favPrefs = { ...prefs };
    }
  } catch { /* 默认全部展开 */ }
}

function saveFavPrefs() {
  try {
    // 书签挪动/删除后,失效的文件夹名顺手清掉,不让记录无限增长
    const alive = new Set([
      ...(favData || []).map((f) => f.label),
      SEC_KOI, SEC_BROWSER,         // 分区键永远算"还活着"
    ]);
    const kept = {};
    for (const [label, pref] of Object.entries(favPrefs)) {
      if (alive.has(label)) kept[label] = pref;
    }
    favPrefs = kept;
    chrome.storage.local.set({ [FAV_COLLAPSE_KEY]: kept });
  } catch { /* 忽略 */ }
}

/** 当前有内容的分区(归档夹了就不显示空的「全部折叠」目标) */
function favSectionKeys() {
  const groups = favData || [];
  const keys = [];
  if (groups.some((f) => f.kind === 'koi')) keys.push(SEC_KOI);
  if (groups.some((f) => f.kind !== 'koi')) keys.push(SEC_BROWSER);
  return keys;
}

function allFavCollapsed() {
  const keys = favSectionKeys();
  return keys.length > 0 && keys.every((k) => favPrefs[k] === 'collapsed');
}

function syncFavToggleAllLabel() {
  const btn = document.getElementById('btn-fav-toggle-all');
  if (!btn) return;
  const hasData = favData && favData.length > 0;
  btn.disabled = favQuery.length > 0 || !hasData;
  btn.textContent = allFavCollapsed() ? tr("全部展开") : tr("全部折叠");
  btn.title = favQuery.length > 0 ? tr("搜索时自动展开全部")
    : !hasData ? tr("还没有收藏可折叠")
    : (allFavCollapsed() ? tr("展开所有分组") : tr("折叠所有分组"));
}

function toggleAllFavGroups() {
  const collapsed = allFavCollapsed();
  for (const k of favSectionKeys()) favPrefs[k] = collapsed ? 'expanded' : 'collapsed';
  for (const f of (favData || [])) favPrefs[f.label] = collapsed ? 'expanded' : 'collapsed';
  saveFavPrefs();
  render();
}

/**
 * 某个站点分组当前是否应该收起。
 * 用户明确操作过就听用户的;没操作过的「大分组」才自动收起,
 * 这样自动折叠永远不会覆盖用户自己的选择。
 */
function effectiveCollapsed(domain, tabCount) {
  const pref = groupPrefs[domain];
  if (pref === 'collapsed') return true;
  if (pref === 'expanded') return false;
  if (autoCollapseN <= 0) return false;
  return tabCount >= autoCollapseN;
}

/** 各站点的标签数量,用于自动折叠判断与全部折叠文案 */
function domainCounts(tabs = allTabs) {
  const counts = new Map();
  for (const t of tabs) {
    const d = groupingKey(t.url);
    counts.set(d, (counts.get(d) || 0) + 1);
  }
  return counts;
}

function allGroupsCollapsed() {
  const counts = domainCounts();
  if (!counts.size) return false;
  for (const [domain, n] of counts) {
    if (!effectiveCollapsed(domain, n)) return false;
  }
  return true;
}

/** 「全部折叠 / 全部展开」按钮:文案随当前折叠情况切换 */
function syncToggleAllLabel() {
  const btn = document.getElementById('btn-toggle-all');
  if (!btn) return;
  const collapsed = allGroupsCollapsed();

  btn.disabled = query.length > 0;
  btn.textContent = collapsed ? tr("全部展开") : tr("全部折叠");
  btn.title = query.length > 0
    ? tr("搜索时自动展开全部")
    : (collapsed ? tr("展开所有站点分组") : tr("折叠所有站点分组"));
}

function toggleAllGroups() {
  const counts = domainCounts();
  const collapsed = allGroupsCollapsed();
  // 显式记住每个站点的目标状态,连自动折叠的大分组也会被一起展开
  for (const domain of counts.keys()) {
    groupPrefs[domain] = collapsed ? 'expanded' : 'collapsed';
  }
  saveCollapsed();
  render();
}

/* ---------- data ---------- */

// Browser events arrive in bursts during grouping. Query once after a quiet period,
// and let the exclusive operation refresh its own phase snapshots while it runs.
function scheduleTabRefresh() {
  refreshPending = true;
  if (operationBusy) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    if (operationBusy) return;
    loadTabs().catch((error) => console.warn('[KoiTab] refresh failed', error));
  }, 80);
}

async function loadTabs() {
  const revision = ++loadRevision;
  refreshPending = false;
  const [tabs, groups] = await Promise.all([
    chrome.tabs.query(scope === 'all' ? {} : { currentWindow: true }),
    chrome.tabGroups.query ? chrome.tabGroups.query({}) : [],
  ]);
  if (revision !== loadRevision) return;
  allTabs = tabs;
  nativeGroupTitles = new Map(groups.map((group) => [group.id, group.title]));
  await loadWindowInfo();
  if (revision === loadRevision && !operationBusy) render();
}

/** 计算窗口徽标:本窗口显示「本」,其余按顺序编号 */
async function loadWindowInfo() {
  try {
    if (currentWindowId == null) currentWindowId = (await chrome.windows.getCurrent()).id;
  } catch {
    currentWindowId = null;
  }

  const ids = [...new Set(allTabs.map((t) => t.windowId))];
  ids.sort((a, b) => {
    if (a === currentWindowId) return -1;
    if (b === currentWindowId) return 1;
    return a - b;
  });

  windowCount = ids.length;
  windowChips = new Map();
  ids.forEach((id, i) => {
    windowChips.set(id, id === currentWindowId ? '本' : String(i + 1));
  });
}

function groupTabsByDomain(tabs) {
  const map = new Map();
  for (const tab of tabs) {
    const d = groupingKey(tab.url);
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(tab);
  }
  return [...map.entries()]
    .map(([domain, list]) => ({
      domain,
      tabs: list.sort((a, b) => a.windowId - b.windowId || a.index - b.index),
    }))
    .sort((a, b) => b.tabs.length - a.tabs.length || a.domain.localeCompare(b.domain));
}

/* ---------- render ---------- */

function renderNativeGroups() {
  const groups = groupMembership(allTabs);
  document.getElementById('native-group-summary').textContent = tr('浏览器分组（{0}）', groups.size);
  document.getElementById('group-scope').value = scope;
  const list = document.getElementById('native-group-list');
  list.textContent = '';
  for (const [id, tabs] of groups) {
    const row = document.createElement('div');
    row.className = 'koi-native-row';
    const title = nativeGroupTitles.get(id) || tr('未命名分组');
    const label = document.createElement('span');
    label.className = 'koi-native-name';
    label.textContent = title;
    label.title = title;
    const count = document.createElement('small');
    const windowLabel = windowChips.get(tabs[0].windowId);
    count.textContent = tr('{0} 个标签页', tabs.length) + (scope === 'all'
      ? ' · ' + (windowLabel === '本' ? tr('本窗口') : tr('窗口 {0}', windowLabel)) : '');
    const button = document.createElement('button');
    button.className = 'koi-link-btn koi-ungroup';
    button.textContent = tr('取消分组');
    button.setAttribute('aria-label', tr('取消分组：{0}', title));
    button.addEventListener('click', () => removeBrowserGroups(id));
    row.append(label, count, button);
    list.appendChild(row);
  }
  if (!groups.size) {
    const empty = document.createElement('p');
    empty.className = 'koi-setting-hint';
    empty.textContent = tr('此范围内没有浏览器分组');
    list.appendChild(empty);
  }
  document.getElementById('btn-ungroup-all').disabled = operationBusy || !groups.size;
}

// Ungroup is deliberately separate from organize: never close, move, dedupe or
// archive tabs. Re-read membership so hidden search results and new group members
// are included, and stale UI IDs cannot affect a different group.
function removeBrowserGroups(groupId = null) {
  return runExclusive(async () => {
    try {
      await loadTabs();
      const targets = allTabs.filter((t) => isGroupedTab(t) && (groupId === null || t.groupId === groupId))
        .map(({id, groupId, windowId}) => ({id, groupId, windowId}));
      if (!targets.length) { showToast(tr('此范围内没有浏览器分组')); return; }
      try {
        await chrome.tabs.ungroup(targets.map((t) => t.id));
      } catch (error) {
        // A tab may have closed or changed group while the batch was in flight.
        // Retry surviving members only; never ungroup a tab from its new group.
        for (const target of targets) {
          try {
            const tab = await chrome.tabs.get(target.id);
            if (tab.groupId === target.groupId && tab.windowId === target.windowId) {
              await chrome.tabs.ungroup(tab.id);
            }
          } catch (error) { console.warn('[KoiTab] ungroup tab failed', target.id, error); }
        }
      }
      await loadTabs();
      const expected = new Map(targets.map((t) => [t.id, t]));
      const remaining = allTabs.filter((t) => {
        const before = expected.get(t.id);
        return before && t.groupId === before.groupId && t.windowId === before.windowId;
      }).length;
      showToast(remaining ? tr('有 {0} 个标签页未能取消分组，请重试；未关闭任何标签页', remaining)
        : tr('已取消分组，所有标签页保持打开'));
    } catch (error) {
      console.warn('[KoiTab] ungroup failed', error);
      showToast(tr('取消分组失败，请重试；未关闭任何标签页'));
    }
  });
}

function renderTabList() {
  const listEl = document.getElementById('tab-list');
  listEl.textContent = '';

  const filtered = query
    ? allTabs.filter((t) =>
        (t.title || '').toLowerCase().includes(query) ||
        (t.url || '').toLowerCase().includes(query))
    : allTabs;

  const groups = groupTabsByDomain(filtered);
  const activeIds = new Set(filtered.filter((t) => t.active).map((t) => t.id));
  const showChips = scope === 'all' && windowCount > 1;
  const searching = query.length > 0;   // 搜索时强制展开,否则命中结果会被折叠藏起来

  for (const { domain, tabs } of groups) {
    const group = document.createElement('section');
    group.className = 'koi-group';

    const isCollapsed = !searching && effectiveCollapsed(domain, tabs.length);

    const head = document.createElement('div');
    head.className = 'koi-group-head';
    head.setAttribute('aria-expanded', String(!isCollapsed));
    head.title = searching
      ? tr("搜索时自动展开分组")
      : (isCollapsed ? tr("展开 {0}({1} 个标签页)", displayDomain(domain), tabs.length) : tr("折叠 {0}", displayDomain(domain)));

    const caret = document.createElement('span');
    caret.className = 'koi-caret' + (isCollapsed ? ' is-collapsed' : '');
    caret.textContent = '▾';

    const dot = document.createElement('span');
    dot.className = 'koi-dot';
    dot.style.background = domainColor(domain);

    const name = document.createElement('span');
    name.className = 'koi-group-name';
    name.textContent = displayDomain(domain);

    const count = document.createElement('span');
    count.className = 'koi-group-count';
    count.textContent = tabs.length;

    const closeAll = document.createElement('button');
    closeAll.className = 'koi-close-domain';
    closeAll.title = tr("关闭 {0} 的全部标签页", displayDomain(domain));
    closeAll.textContent = '×';
    closeAll.addEventListener('click', async (e) => {
      e.stopPropagation();
      await runExclusive(async () => {
        await chrome.tabs.remove(tabs.map((t) => t.id).filter(Boolean));
        showToast(tr("已关闭 {0} 的 {1} 个标签页", displayDomain(domain), tabs.length));
        await loadTabs();
      });
    });

    head.append(caret, dot, name, count, closeAll);

    const body = document.createElement('div');
    body.className = 'koi-group-body' + (isCollapsed ? ' is-collapsed' : '');
    for (const tab of tabs) {
      body.appendChild(renderRow(tab, activeIds.has(tab.id), showChips));
    }

    // 点击标题栏折叠 / 展开;搜索时保持展开,避免命中结果被藏起来
    if (!searching) {
      head.classList.add('is-clickable');
      head.addEventListener('click', () => {
        const nowCollapsed = !effectiveCollapsed(domain, tabs.length);
        // 记录用户的明确选择,自动折叠从此不再覆盖它
        groupPrefs[domain] = nowCollapsed ? 'collapsed' : 'expanded';
        body.classList.toggle('is-collapsed', nowCollapsed);
        caret.classList.toggle('is-collapsed', nowCollapsed);
        head.setAttribute('aria-expanded', String(!nowCollapsed));
        head.title = nowCollapsed
          ? tr("展开 {0}({1} 个标签页)", displayDomain(domain), tabs.length)
          : tr("折叠 {0}", displayDomain(domain));
        syncToggleAllLabel();
        saveCollapsed();
      });
    }

    group.append(head, body);
    listEl.appendChild(group);
  }

  if (!groups.length) {
    const empty = document.createElement('div');
    empty.className = 'koi-empty';
    empty.textContent = query
      ? tr("没有匹配的标签页")
      : (scope === 'all' ? tr("没有可整理的标签页") : tr("当前窗口没有标签页"));
    listEl.appendChild(empty);
  }

}

function render() {
  if (view === 'tabs') { renderNativeGroups(); renderTabList(); }
  const groupCount = domainCounts().size;
  const m = computeMetrics();
  const parts = [tr("{0} 个标签页", allTabs.length)];
  if (scope === 'all') parts.push(tr("{0} 个窗口", windowCount));
  parts.push(tr("{0} 个站点", groupCount), tr("{0} 个重复", m.dupCount));
  document.getElementById('stat-text').textContent = parts.join(' · ');

  const tidyBtn = document.getElementById('btn-tidy');
  tidyBtn.textContent = operationBusy ? tr('正在处理,请稍候') : tr('按诊断整理');
  tidyBtn.disabled = operationBusy || !m.tidySteps.length;
  tidyBtn.title = operationBusy ? tr("正在处理,请稍候") : tidyBtn.disabled
    ? tr("标签页已经很整齐了")
    : tr("依次执行:{0}", m.tidySteps.join(' → '));

  const archiveBtn = document.getElementById('btn-archive');
  if (archiveBtn) {
    archiveBtn.disabled = operationBusy || m.archivePlan.closeIds.length === 0;
    archiveBtn.title = operationBusy ? tr("正在处理,请稍候") : archiveBtn.disabled
      ? (m.archiveWhy ? m.archiveWhy.text : tr("没有可归档的标签页"))
      : tr("把 {0} 个 {1} 天未用的标签页收进 KoiTab 收藏并关闭(在「收藏夹」页按站点找回)", m.archivePlan.closeIds.length, archiveDays);
  }
  syncArchiveUI();
  syncAutoUI();
  syncGroupingUI();
  if (view === 'ops') renderDiagnose(m);

  // 顶部 tab 徽标:标签页数量常显;收藏数要读过书签才知道
  const badgeTabs = document.getElementById('badge-tabs');
  if (badgeTabs) badgeTabs.textContent = String(allTabs.length);
  const badgeFav = document.getElementById('badge-fav');
  if (badgeFav) badgeFav.textContent = favData ? String(favTotal()) : '';

  if (view === 'fav') renderFavorites();   // 只读缓存的书签数据,不发请求

  syncToggleAllLabel();
  document.querySelectorAll(
    '#seg-scope button, #seg-days button, #seg-auto button, #koi-nav button, '
    + '.koi-ungroup, #group-scope, .koi-close, .koi-close-domain, .koi-fav-openall, #btn-fav-refresh, #language, #grouping-mode, #btn-diagnose, #btn-diagnose-again',
  ).forEach((button) => { button.disabled = operationBusy; });
}

function renderRow(tab, isActive, showChip) {
  const row = document.createElement('div');
  row.className = 'koi-row' + (isActive ? ' active-tab' : '');
  const winLabel = windowChips.get(tab.windowId);
  row.title = `${tab.title || ''}\n${tab.url || ''}` +
    (showChip ? `\n(${winLabel === '本' ? tr("本窗口") : tr("窗口 {0}", winLabel)})` : '');

  const domain = normalizeDomain(tab.url);
  const fav = document.createElement('span');
  fav.className = 'koi-favicon';
  fav.style.background = domainColor(domain);
  fav.textContent = faviconLetter(displayDomain(domain));

  const title = document.createElement('span');
  title.className = 'koi-title';
  title.textContent = tab.title || tab.url || tr("(无标题)");

  const nodes = [fav, title];

  if (showChip) {
    const chip = document.createElement('span');
    chip.className = 'koi-win-chip' + (winLabel === '本' ? ' is-current' : '');
    chip.textContent = winLabel === '本' ? tr('本') : winLabel;
    chip.title = winLabel === '本' ? tr("本窗口") : tr("窗口 {0}", winLabel);
    nodes.push(chip);
  }

  const close = document.createElement('button');
  close.className = 'koi-close';
  close.textContent = '×';
  close.title = tr("关闭此标签页");
  close.addEventListener('click', async (e) => {
    e.stopPropagation();
    await runExclusive(async () => {
      await chrome.tabs.remove(tab.id);
      await loadTabs();
    });
  });
  nodes.push(close);

  row.addEventListener('click', () => activateTab(tab));

  row.append(...nodes);
  return row;
}

/** 跳转到某个标签页,并关闭弹窗 */
async function activateTab(tab) {
  if (operationBusy) return;
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

function countDuplicates(tabs) {
  const seen = new Map();
  let dup = 0;
  for (const t of tabs) {
    if (!t.url) continue;
    const key = normalizeUrlForDedupe(t.url);
    if (seen.has(key)) dup++;
    else seen.set(key, true);
  }
  return dup;
}

/**
 * 规划「收藏并关闭长期未用的标签页」:纯函数,便于测试。
 *
 * 这不是"直接关掉",而是**先存进 KoiTab 收藏、再关闭** —— 用户随时能在
 * 「其他书签 / KoiTab 归档 / 站点名」里找回。所以原则是宁可漏、不可误杀:
 *
 *  1. 只收「未固定、非激活」的标签页 —— 每个窗口正在看的那个永远不动,
 *     也因此任何窗口都不可能被归档到关闭;
 *  2. 只收「拿得到 lastAccessed」的标签页 —— Chrome 121+ 才有这个字段,
 *     拿不到一律跳过:时间不明就判不了"未用";
 *  3. 未用时长 = now - lastAccessed,达到阈值(天)才算;
 *  4. 浏览器内部页(chrome:// 等)不收 —— 存书签没有意义;
 *  5. 同一 URL 有多份时:书签只记一份,标签页全部关闭
 *     (同一页面存两份书签只是噪音)。
 *
 * 注意:lastAccessed 跨浏览器重启是否保留尚未确证(用 debug.html 可验证)。
 * 但因为产物是书签而不是删除,误判的代价只是"多收了一个其实用过的页",
 * 能找回来 —— 这正是"先收藏再关闭"的意义。
 */
function planArchive(tabs, now, days) {
  const fresh = now - days * DAY_MS;

  const candidates = tabs.filter((t) =>
    !t.pinned
    && !t.active
    && Number.isFinite(t.lastAccessed)
    && t.lastAccessed <= fresh
    && t.id != null
    && !t.pendingUrl
    // 书签 API 只接受真正的网页地址:chrome:// 之类存不进去,收了等于白收
    && typeof t.url === 'string'
    && /^(https?|file):/i.test(t.url)
  );

  // 同一 URL 只留一份书签(按 lastAccessed 升序取第一个,标题更"原始")
  const byUrl = new Map();
  for (const t of [...candidates].sort((a, b) => a.lastAccessed - b.lastAccessed)) {
    const key = normalizeUrlForDedupe(t.url);
    if (!byUrl.has(key)) byUrl.set(key, t);
  }

  const domains = new Set();
  for (const t of byUrl.values()) domains.add(normalizeDomain(t.url));

  return {
    uniques: [...byUrl.values()],
    closeIds: candidates.map((t) => t.id),
    domains: domains.size,
    duplicatesClosed: candidates.length - byUrl.size,
  };
}

/** 归档结果的汇总提示 */
function buildArchiveSummary(res) {
  if (res.error && !res.closed) return tr("归档未完成(原因:{0}),没有关闭标签页", res.error);
  const stored = res.archived + (res.skippedDup || 0);
  const because = res.error ? tr("(原因:{0})", res.error) : '';
  if (!res.closed && !stored) {
    return tr("没存进 KoiTab 收藏{0} —— 出于安全,一个页也没关", because);
  }
  if (!res.closed) {
    if (res.skippedChanged) return tr("已存进 KoiTab 收藏;标签状态已变化,保留页面未关闭");
    return tr("已存进 KoiTab 收藏,但页没能关掉 —— 再点一次只补关,不会重复存");
  }
  const parts = [tr("把 {0} 个标签页收进 KoiTab 收藏并关闭", res.closed)];
  if (res.duplicatesClosed > 0) parts.push(tr("重复 URL 只收一份"));
  if (res.skippedDup > 0) parts.push(tr("{0} 条早已收藏过,没重复存", res.skippedDup));
  if (res.failed > 0) parts.push(tr("{0} 个没关掉(页都还在)", res.failed));
  if (res.skippedChanged > 0) parts.push(tr("{0} 个状态已变化,保留未关闭", res.skippedChanged));
  return parts.join(' · ');
}

/* ---------- actions:整理步骤(只执行并返回结果,提示统一由「一键整理」汇总) ---------- */

/**
 * 规划「分组集中 + 散标签收拢」:纯函数,便于测试。
 *
 * 目标终态:
 *   - **当前窗口** = 所有站点分组的展示窗口(同站点标签都收在这里);
 *   - **新窗口**   = 收集全部散标签(未分组、未固定);
 *   - 其他窗口被搬空后由 Chrome 关闭;只有固定标签的窗口会留下来(固定标签不搬动)。
 *
 * 规则:
 *  1. 候选站点 = 在**所有窗口合计**有 ≥2 个「未固定」标签的站点
 *     —— 跨窗口统计,所以一个窗口 1 个、另一个窗口 1 个,合计 2 个也算;
 *  2. 候选标签统一收进**当前窗口**,再按站点成组
 *     —— Chrome 的分组无法跨窗口,必须先集中、再成组;
 *     把当前窗口当目标还有个关键好处:它只收不搬,永远不会被搬空,
 *     而弹窗依附于当前窗口,窗口一旦被关掉整理就会中断在半路;
 *  3. 其余未固定的标签(散标签)收进**新建的窗口**;
 *     排列不交错、不抹掉用户拖过的顺序:当前窗口的整块在前、其余窗口按窗口编号整块排列,
 *     同一窗口内保持标签栏从左到右的顺序;
 *  4. 固定(Pinned)标签不搬动,留在原窗口;
 *  5. 已经全在当前窗口、且已经成好组的站点不再搬动(重复整理不会有动作);
 *     已经全在同一个窗口里的分组一定要搬过来,否则分组会留在两个窗口里;
 *  6. 散标签已经全在同一个窗口里、且那个窗口不是当前窗口时,不再搬动
 *     (避免每点一次整理就多一个窗口);
 *  7. 若搬完会让当前窗口一个标签都不剩(没有任何候选站点、当前窗口也没有固定标签),
 *     那就什么都不做 —— 否则窗口被关掉、弹窗中断,得不偿失。
 */
function planCollect(tabs, windowId) {
  const nothing = {
    plans: [],
    loose: { tabIds: [], needed: false, reason: 'no-window' },
    pinnedKept: 0,
    emptiedWindows: 0,
    target: 'none',
    reason: 'no-window',
  };
  if (windowId == null) return nothing;

  const byDomain = new Map();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const domain = groupingKey(tab.url);
    if (domain === '浏览器页面') continue;
    if (!byDomain.has(domain)) byDomain.set(domain, []);
    byDomain.get(domain).push(tab);
  }

  const candidates = [...byDomain.entries()]
    .filter(([, list]) => list.length >= 2)
    .map(([domain, list]) => ({ domain, list: [...list].sort((a, b) => a.id - b.id) }));

  // 当前窗口能不能留住至少一个标签?候选标签都会收进当前窗口;
  // 固定标签本来就留在原窗口。
  const currentKeeps = candidates.length > 0
    || tabs.some((t) => t.pinned && t.windowId === windowId);
  if (!currentKeeps) {
    // 没有任何分组可留,又要靠搬走散标签来"整理"——那只会把当前窗口搬空
    return { ...nothing, reason: 'would-empty' };
  }

  const members = groupMembership(tabs);
  const plans = [];
  for (const { domain, list } of candidates) {
    // 已经在这个窗口里、而且已经成好组的,不用动;
    // 但若它整齐地待在**别的**窗口里,仍要搬过来 —— 否则分组会分处两个窗口
    if (isTidyDomain(list, members) && list[0].windowId === windowId) continue;
    plans.push({
      domain,
      targetWindowId: windowId,
      tabIds: list.map((t) => t.id),
      movingIds: list.filter((t) => t.windowId !== windowId).map((t) => t.id),
    });
  }

  const candidateIds = new Set(candidates.flatMap((c) => c.list.map((t) => t.id)));
  const loose = planGatherLoose(tabs, windowId, candidateIds);
  const pinnedKept = tabs.filter(
    (t) => t.pinned && candidates.some((c) => c.domain === groupingKey(t.url)),
  ).length;

  // 预计会被搬空的窗口(当前窗口只收不搬,不会被搬空)
  const moving = new Set([
    ...plans.flatMap((p) => p.movingIds),
    ...(loose.needed ? loose.tabIds : []),
  ]);
  const byWindow = new Map();
  for (const tab of tabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }
  let emptiedWindows = 0;
  for (const [wid, list] of byWindow) {
    if (wid === windowId || !list.length) continue;
    if (list.every((t) => moving.has(t.id))) emptiedWindows++;
  }

  return { plans, loose, pinnedKept, emptiedWindows, target: 'current', reason: 'ok' };
}

/**
 * 规划「散标签收进新窗口」:纯函数。
 *
 * 只判断要不要搬、搬哪些:
 *  - 没有散标签 → 不搬;
 *  - 散标签已经全在同一个窗口里、且那个窗口不是当前窗口 → 不搬
 *    (已经收拢好了,再搬只会让窗口越点越多);
 *  - 其余情况(散落在多个窗口,或者就在当前窗口里)→ 全部搬进新建的窗口。
 */
function planGatherLoose(tabs, windowId, candidateIds) {
  const loose = tabs.filter((t) => !t.pinned && !candidateIds.has(t.id));
  if (!loose.length) return { tabIds: [], needed: false, reason: 'no-loose' };

  const windows = new Set(loose.map((t) => t.windowId));
  if (windows.size === 1 && !windows.has(windowId)) {
    return { tabIds: [], needed: false, reason: 'already-gathered' };
  }

  // 搬动顺序 = 用户原来看到的顺序,不是打开顺序:
  //  1) 当前窗口的散标签排最前,其余窗口按窗口编号整块排列 —— 窗口之间不交错;
  //  2) 同一窗口内按标签栏从左到右(index)—— 不是按 id。
  //     用户拖拽调整过顺序后,index 才是他看到的顺序,按 id 排等于把调整抹掉。
  const rank = (t) => (t.windowId === windowId ? 0 : 1);
  const ordered = [...loose].sort(
    (a, b) => rank(a) - rank(b) || a.windowId - b.windowId || a.index - b.index,
  );
  return { tabIds: ordered.map((t) => t.id), needed: true, reason: 'ok' };
}

/**
 * 按 (窗口, 站点) 分桶,与成组逻辑保持一致。
 *
 * 固定(Pinned)标签不参与分桶:Chrome 不允许固定标签进入分组,
 * 把它们算进来会导致成组失败,连累同一个桶里能正常成组的标签。
 */
function bucketByWindowDomain(tabs) {
  const buckets = new Map();
  for (const tab of tabs) {
    if (tab.pinned) continue;
    const domain = groupingKey(tab.url);
    if (domain === '浏览器页面') continue;
    const key = `${tab.windowId}::${domain}`;
    if (!buckets.has(key)) buckets.set(key, { windowId: tab.windowId, domain, tabs: [] });
    buckets.get(key).tabs.push(tab);
  }
  return buckets;
}

/** groupId -> 该分组的成员标签 */
function groupMembership(tabs) {
  const members = new Map();
  for (const tab of tabs) {
    if (!isGroupedTab(tab)) continue;
    if (!members.has(tab.groupId)) members.set(tab.groupId, []);
    members.get(tab.groupId).push(tab);
  }
  return members;
}

/**
 * 这个桶是否「已经是一个纯站点分组」——也就是已经整理好了。
 *
 * 条件:≥2 个标签、全都在同一个分组里、且该分组里没有别的站点的标签。
 * 满足就不再动它,这样重复点「一键整理」不会把已经正确的分组拆掉重建;
 * 反过来说,用户手动把多个站点放进同一个分组时,仍然会被重新按站点拆开
 * (分组里出现了别的站点 → 不满足 → 照旧处理,行为与之前一致)。
 */
function isTidyBucket(bucket, members) {
  if (bucket.tabs.length < 2) return false;
  const first = bucket.tabs[0];
  if (!isGroupedTab(first)) return false;
  if (!bucket.tabs.every((t) => t.groupId === first.groupId)) return false;
  const inGroup = members.get(first.groupId) || [];
  const domains = new Set(inGroup.map((t) => groupingKey(t.url)));
  return domains.size === 1;
}

/**
 * 这个站点是否已经「整理好了」——判断标准和 isTidyBucket 相同,但看的是
 * **该站点的全部标签**(而不是某个窗口里的那一部分):
 * 全都已经在同一个窗口里、在同一个分组里、且该分组里没有别的站点。
 *
 * 为什么必须按站点整体判断:跨窗口的同一个站点正是「集中」要处理的对象,
 * 只看单个窗口会把"两个窗口各一个分组"误判成已整理好。
 */
function isTidyDomain(list, members) {
  if (list.length < 2) return false;
  if (new Set(list.map((t) => t.windowId)).size !== 1) return false;  // 还散在多个窗口
  const first = list[0];
  if (!isGroupedTab(first)) return false;
  if (!list.every((t) => t.groupId === first.groupId)) return false;
  const domain = groupingKey(first.url);
  return (members.get(first.groupId) || []).every(
    (t) => groupingKey(t.url) === domain,
  );
}

function mixedGroups(tabs) {
  return [...groupMembership(tabs).values()].filter((list) =>
    new Set(list.map((t) => groupingKey(t.url))).size > 1);
}

// Rename only recognizable generated titles. Keep users' custom group names.
function planGroupTitles() {
  const updates = [];
  for (const [id, tabs] of groupMembership(allTabs)) {
    if (tabs.length < 2) continue;
    const title = nativeGroupTitles.get(id);
    const domain = groupingKey(tabs[0].url);
    if (!title || title === domain || !tabs.every((t) => groupingKey(t.url) === domain)) continue;
    const generated = new Set(tabs.flatMap((t) => GROUPING_MODES.map((mode) => groupingKey(t.url, mode))));
    if (generated.has(title)) updates.push({ id, domain });
  }
  return updates;
}

async function splitMixedCore() {
  const ids = mixedGroups(allTabs).flatMap((list) => list.filter((t) => !t.pinned).map((t) => t.id));
  if (ids.length) await chrome.tabs.ungroup(ids);
  return ids.length;
}

/** Append in the supplied order; a stale tab ID must not strand the remaining tabs. */
async function moveTabsInOrder(ids, properties) {
  if (!ids.length) return [];
  try {
    await chrome.tabs.move(ids, properties);
    return ids;
  } catch (error) {
    console.warn('[KoiTab] batch move failed, retrying individually', error);
    const moved = [];
    for (const id of ids) {
      try { await chrome.tabs.move(id, properties); moved.push(id); }
      catch (error) { console.warn('[KoiTab] tab move failed', id, error); }
    }
    return moved;
  }
}

/** 统计还需要成组的站点数(按 窗口+域名 计,与成组逻辑一致) */
function countGroupableSites(tabs) {
  const members = groupMembership(tabs);
  let n = 0;
  for (const bucket of bucketByWindowDomain(tabs).values()) {
    if (bucket.tabs.length < 2) continue;      // 单个标签的站点不成组
    if (!isTidyBucket(bucket, members)) n++;
  }
  return n;
}

/* ---------- 重排:分组靠左,未分组靠右 ---------- */

/** 标签页是否属于某个浏览器原生分组(groupId 为 -1 表示未分组) */
function isGroupedTab(tab) {
  return typeof tab.groupId === 'number' && tab.groupId !== -1;
}

/**
 * 规划「取消孤儿分组」:纯函数,便于测试。
 *
 * 分组的价值在于把多个标签收在一起,只剩 1 个标签的分组已经没有意义
 * (还会在白占一个分组位、挡住「分组靠左」的效果),所以自动取消。
 * 注意:空分组会被 Chrome 自动回收,不会出现在查询结果里,这里只需处理剩 1 个的。
 */
function planUngroup(tabs) {
  const byGroup = new Map();
  for (const tab of tabs) {
    if (!isGroupedTab(tab)) continue;
    if (!byGroup.has(tab.groupId)) byGroup.set(tab.groupId, []);
    byGroup.get(tab.groupId).push(tab);
  }

  const targets = [];
  for (const [groupId, list] of byGroup) {
    if (list.length < 2) {
      targets.push({
        groupId,
        windowId: list[0].windowId,
        tabIds: list.map((t) => t.id).filter(Boolean),
      });
    }
  }
  return { targets };
}

/** 只剩 1 个标签的分组数量 */
function countLoneGroups(tabs) {
  return planUngroup(tabs).targets.length;
}

/**
 * 规划「重排」:纯函数,便于测试。
 *
 * 目标:同一个窗口里,分组的标签页彼此挨着,未分组的标签页统一排到它们右边。
 *
 * 为什么只搬未分组的标签页(且一律追加到窗口末尾):
 *  1. 分组标签页一个都不动,所以「同一分组内成员相对顺序」「分组与分组之间的先后顺序」
 *     都被完整保留 —— 用户的分组不会被我们打乱;
 *  2. Chrome 要求同一分组的标签页在标签栏里必须连续。若去移动分组内的标签页,
 *     中途就可能把分组拆开,甚至让标签落进别的分组区间而被"吸"进那个分组;
 *     只追加未分组标签到末尾,永远不会落到任何分组区间内部;
 *  3. 固定标签页不搬(Chrome 要求固定标签只能在最左侧),它们本来就排在分组左边;
 *  4. 未分组标签页之间保持原有相对顺序(按当前 index 依次追加)。
 *
 * 返回需要重排的窗口:appendIds = 该窗口所有「未分组且未固定」的标签页(按当前顺序)。
 */
function planReorder(tabs) {
  const byWindow = new Map();
  for (const tab of tabs) {
    if (!byWindow.has(tab.windowId)) byWindow.set(tab.windowId, []);
    byWindow.get(tab.windowId).push(tab);
  }

  const plans = [];
  for (const [windowId, list] of byWindow) {
    const sorted = [...list].sort((a, b) => a.index - b.index);
    const groupedIndexes = sorted.filter(isGroupedTab).map((t) => t.index);
    if (!groupedIndexes.length) continue;   // 该窗口没有分组,无需重排

    const lastGrouped = Math.max(...groupedIndexes);
    const loose = sorted.filter((t) => !t.pinned && !isGroupedTab(t));
    // 只有「未分组标签还夹在分组左边」时才需要动,已经靠右的窗口跳过
    const interleaved = loose.filter((t) => t.index < lastGrouped);
    if (!interleaved.length) continue;

    plans.push({
      windowId,
      appendIds: loose.map((t) => t.id),
      moved: interleaved.length,
      groups: new Set(sorted.filter(isGroupedTab).map((t) => t.groupId)).size,
    });
  }

  return { plans };
}

/** 步骤一:关闭重复网页 */
async function closeDuplicatesCore() {
  const seen = new Set();
  const toRemove = [];
  let keptForWindow = 0;

  // 跨窗口去重时,若某个窗口只剩这一个标签,关掉它等于关掉整个窗口 —— 跳过并上报
  const remainingByWindow = new Map();
  if (scope === 'all') {
    for (const t of allTabs) {
      remainingByWindow.set(t.windowId, (remainingByWindow.get(t.windowId) || 0) + 1);
    }
  }

  for (const tab of [...allTabs].sort((a, b) => {
    // 优先保留:固定 > 激活 > 更早打开。
    // 注意:index 只是标签在本窗口内的位置,跨窗口不可比;
    // tab.id 递增,更接近真实的打开顺序,所以用它兜底。
    const score = (t) => (t.pinned ? 4 : 0) + (t.active ? 2 : 0);
    return score(b) - score(a) || a.id - b.id;
  })) {
    if (!tab.url) continue;
    const key = normalizeUrlForDedupe(tab.url);
    if (seen.has(key)) {
      if (scope === 'all' && (remainingByWindow.get(tab.windowId) || 0) <= 1) {
        keptForWindow++;
        continue;
      }
      toRemove.push(tab.id);
      if (scope === 'all') {
        remainingByWindow.set(tab.windowId, remainingByWindow.get(tab.windowId) - 1);
      }
    } else {
      seen.add(key);
    }
  }
  if (!toRemove.length) return { removed: 0, keptForWindow };
  await chrome.tabs.remove(toRemove);
  return { removed: toRemove.length, keptForWindow };
}

/**
 * 步骤:把分组收进当前窗口,再把散标签收进一个新窗口。
 *
 * 顺序:先成组、后收散标签。散标签里包含当前窗口自己的散标签,先把分组做出来,
 * 当前窗口就"有底气"了 —— 搬走散标签绝不会让它变空、随窗口关闭而中断弹窗。
 */
async function collectCore() {
  const plan = planCollect(allTabs, currentWindowId);
  const result = {
    moved: 0,
    domains: 0,
    windows: 0,
    looseMoved: 0,
    looseWindowId: null,
    pinnedKept: plan.pinnedKept,
    emptiedWindows: plan.emptiedWindows,
    target: plan.target,
    reason: (plan.plans.length || plan.loose.needed) ? 'ok' : 'nothing',
  };
  if (!plan.plans.length && !plan.loose.needed) return result;

  // 1) 候选站点的标签收进当前窗口,再按站点成组
  //    (必须先集中再成组:Chrome 的分组无法跨窗口)
  for (const p of plan.plans) {
    const moved = await moveTabsInOrder(p.movingIds, { windowId: p.targetWindowId, index: -1 });
    result.moved += moved.length;
    const moving = new Set(p.movingIds);
    const arrived = new Set(moved);
    const ids = p.tabIds.filter((id) => !moving.has(id) || arrived.has(id));
    if (ids.length < 2) continue;
    try {
      // 此刻该站点的标签都已在当前窗口里
      const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: p.targetWindowId } });
      await chrome.tabGroups.update(groupId, {
        title: p.domain,
        color: colorForDomain(p.domain),
        collapsed: false,
      });
      result.domains++;
      result.windows = 1;
    } catch (err) {
      console.warn('[KoiTab] group collected site failed', p.domain, err);
    }
  }

  // 2) 散标签收进新建的窗口
  if (plan.loose.needed) {
    const [firstId, ...restIds] = plan.loose.tabIds;
    let win;
    try {
      // 用第一个散标签当新窗口的初始标签,新窗口里就不会多出一个空白页。
      // focused: false —— 不抢焦点:一是别把用户从当前窗口拽走,
      // 二是弹窗一旦失去焦点就会被关闭,那样就看不到整理结果了。
      win = await chrome.windows.create({ tabId: firstId, focused: false });
      result.looseWindowId = win.id;
      result.looseMoved = 1;
    } catch (err) {
      console.warn('[KoiTab] create window for loose tabs failed', err);
      return result;
    }
    result.looseMoved += (await moveTabsInOrder(restIds, { windowId: win.id, index: -1 })).length;
  }

  return result;
}

/** 步骤三:合并同类项 —— 按 (窗口, 站点) 成组(分组无法跨窗口) */
async function mergeCore() {
  const buckets = bucketByWindowDomain(allTabs);
  const members = groupMembership(allTabs);

  // 只处理「还没整理成纯站点分组」的桶,避免把已经正确的分组拆掉重建
  const targets = [...buckets.values()].filter(
    (b) => b.tabs.length >= 2 && !isTidyBucket(b, members),
  );
  if (!targets.length) return { grouped: 0, windows: 0 };

  // 每个窗口当前正在浏览的标签,用它决定该分组是否展开
  const activeByWindow = new Map();
  for (const tab of allTabs) {
    if (tab.active) activeByWindow.set(tab.windowId, tab.id);
  }

  let grouped = 0;
  const touched = new Set();
  for (const b of targets) {
    const ids = b.tabs.map((t) => t.id).filter(Boolean);
    if (ids.length < 2) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds: ids, createProperties: { windowId: b.windowId } });
      await chrome.tabGroups.update(groupId, {
        title: b.domain,
        color: colorForDomain(b.domain),
        collapsed: activeByWindow.has(b.windowId)
          ? !ids.includes(activeByWindow.get(b.windowId))
          : false,
      });
      grouped += ids.length;
      touched.add(b.windowId);
    } catch (err) {
      console.warn('group failed for', b.domain, err);
    }
  }

  return { grouped, windows: touched.size };
}

/** 步骤四:取消只剩 1 个标签的「孤儿分组」 */
async function ungroupCore() {
  const { targets } = planUngroup(allTabs);
  let groups = 0;
  let freed = 0;

  for (const target of targets) {
    try {
      await chrome.tabs.ungroup(target.tabIds);
      groups++;
      freed += target.tabIds.length;
    } catch (err) {
      console.warn('ungroup failed for group', target.groupId, err);
    }
  }

  return { groups, freed };
}

/** 步骤六:重排 —— 把未分组的标签页挪到分组右边,让分组彼此挨着 */
async function reorderCore() {
  const { plans } = planReorder(allTabs);
  let windows = 0;
  let moved = 0;

  for (const plan of plans) {
    const movedIds = await moveTabsInOrder(plan.appendIds, { index: -1 });
    if (movedIds.length !== plan.appendIds.length) throw new Error('Incomplete tab reorder');
    windows++;
    moved += plan.moved;
  }

  return { windows, moved };
}

/**
 * 归档:把长期未用的标签页**存进 KoiTab 自己的收藏(storage.local),再关闭**。
 *
 * 顺序铁律:先落盘、后关页 —— 收藏没存进的页一个都不关。
 * 幂等:同一 URL 只留一份(隔几天又开到同页,算"更新收藏"而不是重复存);
 *      上次"存了没关掉"的残局,再点一次只补关。
 * 逐个关闭:一个坏 id(标签刚被网页自己关掉/在未保存分组里)不连坐整批。
 */
async function archiveCore() {
  const days = archiveDays;
  const snapshot = allTabs.map((t) => ({ ...t }));
  const plan = planArchive(snapshot, Date.now(), days);
  const result = {
    archived: 0,        // 本次新存进收藏的条数
    skippedDup: 0,      // 同 URL 早已收藏,不重复存
    closed: 0,
    failed: 0,          // 单个页关闭被拒
    skippedChanged: 0,  // 落盘期间状态变化,保留页面
    error: null,        // 第一条真实错误
    domains: plan.domains,
    duplicatesClosed: plan.duplicatesClosed,
  };
  if (!plan.closeIds.length) return result;

  let stored = [];
  try {
    stored = await readArchived();
  } catch (err) {
    console.warn('[KoiTab] read favorites failed', err);
    result.error = err.message || String(err);
    return result;
  }
  const known = new Set(stored.map((x) => normalizeUrlForDedupe(x.url || '')));

  const now = Date.now();
  const added = [];
  for (const t of plan.uniques) {
    const key = normalizeUrlForDedupe(t.url);
    if (known.has(key)) { result.skippedDup++; continue; }
    known.add(key);
    added.push({
      id: uid(),
      url: t.url,
      title: t.title || t.url,
      domain: normalizeDomain(t.url),
      archivedAt: now,
    });
  }

  // 落盘失败 → 一个页都不关(这是"收藏式关闭"的底线)
  try {
    await chrome.storage.local.set({ [ARCHIVE_STORE_KEY]: stored.concat(added) });
  } catch (err) {
    console.warn('[KoiTab] save favorites failed', err);
    result.error = (err && (err.message || err.toString())) || tr("未知错误");
    return result;
  }
  result.archived = added.length;

  const closeSet = new Set(plan.closeIds);
  for (const t of snapshot) {
    if (!closeSet.has(t.id)) continue;
    try {
      const current = await chrome.tabs.get(t.id);
      if (normalizeUrlForDedupe(current.url) !== normalizeUrlForDedupe(t.url)
          || current.windowId !== t.windowId
          || current.lastAccessed !== t.lastAccessed
          || !planArchive([current], Date.now(), days).closeIds.length) {
        result.skippedChanged++;
        continue;
      }
      await chrome.tabs.remove(t.id);
      result.closed++;
    } catch (err) {
      console.warn('[KoiTab] archive-close tab failed', t.id, err);
      result.failed++;
    }
  }

  if (result.closed > 0) {
    await loadTabs();
    await ungroupCore();   // 只剩 1 个成员的分组取消掉
  }
  return result;
}

/** 收藏条目 id:时间戳+随机,本地够用、零依赖 */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function archiveAll() {
  return runExclusive(archiveAllLocked);
}

async function archiveAllLocked() {
  const btn = document.getElementById('btn-archive');
  btn.disabled = true;
  const btnText = btn.textContent;
  btn.textContent = tr("归档中…");   // 明确进入执行态,别让人对着静止的按钮猜
  try {
    await loadTabs();
    const plan = planArchive(allTabs, Date.now(), archiveDays);
    if (!plan.closeIds.length) {
      const why = describeArchiveEmpty(plan);
      showToast(why ? why.text : tr("没有需要归档的标签页"));
      return;
    }
    const res = await archiveCore();
    favData = null;   // 收藏变了,下次进入「收藏夹」重读
    if (view === 'fav') await loadFavorites(true);
    showToast(buildArchiveSummary(res));
  } catch (err) {
    console.error('[KoiTab] archive failed', err);
    showToast(tr("归档时出错,请重试"));
  } finally {
    btn.textContent = btnText;
    await loadTabs();
  }
}

/* ---------- actions:一键整理 ---------- */

/** 汇总各步骤的结果,拼成一句提示 */
function buildTidySummary(dedupe, collected, merged, ungrouped, reordered) {
  const parts = [];
  if (dedupe.removed) parts.push(tr("关闭 {0} 个重复标签页", dedupe.removed));
  if (collected.moved) {
    parts.push(tr("把 {0} 个标签页集中到当前窗口,分成 {1} 个站点分组", collected.moved, collected.domains));
  } else if (collected.domains) {
    parts.push(tr("把 {0} 个站点就地成组", collected.domains));
  }
  if (collected.looseMoved) {
    parts.push(tr("把 {0} 个散标签收进新窗口", collected.looseMoved));
  }
  if (merged.grouped) parts.push(tr("{0} 个标签页归入 {1} 个站点分组", merged.grouped, merged.windows));
  if (ungrouped && ungrouped.groups) {
    parts.push(tr("取消 {0} 个只剩单个标签的分组", ungrouped.groups));
  }
  if (reordered && reordered.moved) {
    parts.push(tr("把 {0} 个未分组标签页排到分组右侧", reordered.moved));
  }
  if (!parts.length) return tr("没有需要整理的标签页 🎉");

  let msg = tr("已") + parts.join(' · ');
  const notes = [];
  if (dedupe.keptForWindow) notes.push(tr("{0} 个重复为避免窗口被清空而保留", dedupe.keptForWindow));
  if (collected.pinnedKept) notes.push(tr("{0} 个固定标签页留在原窗口", collected.pinnedKept));
  if (collected.emptiedWindows) notes.push(tr("{0} 个被搬空的窗口已关闭", collected.emptiedWindows));
  if (notes.length) msg += `(${notes.join(';')})`;
  return msg;
}

/**
 * 一键整理:依次执行
 *   去重 → 取消孤儿分组 → 集中到同一个窗口并成组 → 收拾原窗口 → 重排
 * (「本窗口」范围下不新建窗口,只在当前窗口里成组、取消孤儿分组、重排)
 *
 * 顺序为什么重要:
 *  - 先去重:后面几步要处理的标签更少,也不会把即将关闭的标签搬来搬去;
 *  - 取消孤儿分组放在集中之前:只剩 1 个标签的分组被取消后,这些标签就能参与集中
 *    (比如分组里孤零零 1 个 github 标签,取消后就能和别的窗口的 github 凑成一组);
 *  - 集中的搬运必须在成组之前:跨窗口搬运会让标签脱离原分组,先分组就白做了;
 *  - 重排放在最后:前面几步会改变标签的分组归属,重排要按最终归属来摆放;
 *  - 每步之间重新查询标签(loadTabs),避免基于已关闭/已移动的过期数据做规划。
 */
function tidyAll() {
  return runExclusive(tidyAllLocked);
}

async function tidyAllLocked() {
  try {
    await loadTabs();
    const dedupe = await closeDuplicatesCore();
    await loadTabs();
    const split = await splitMixedCore();
    const titles = planGroupTitles();
    for (const { id, domain } of titles) {
      await chrome.tabGroups.update(id, { title: domain, color: colorForDomain(domain) });
    }

    let collected = { moved: 0, domains: 0, looseMoved: 0, pinnedKept: 0, emptiedWindows: 0, target: 'none' };
    let merged = { grouped: 0, windows: 0 };
    let ungrouped = { groups: 0, freed: 0 };
    let reordered = { moved: 0, windows: 0 };

    if (scope === 'all') {
      // 跨窗口:把各站点的标签集中到同一个窗口,原窗口只留下不参与集中的标签
      await loadTabs();
      ungrouped = await ungroupCore();

      await loadTabs();
      collected = await collectCore();

      await loadTabs();
      merged = await mergeCore();      // 收拾留在原窗口的(固定标签等)

      await loadTabs();
      reordered = await reorderCore();
    } else {
      // 只整理当前窗口:不新建窗口,原地成组
      await loadTabs();
      merged = await mergeCore();

      await loadTabs();
      ungrouped = await ungroupCore();

      await loadTabs();
      reordered = await reorderCore();
    }

    const summary = buildTidySummary(dedupe, collected, merged, ungrouped, reordered);
    const extras = [split ? tr('已按所选规则拆开混合分组') : '',
      titles.length ? tr('更新 {0} 个分组名称', titles.length) : ''].filter(Boolean);
    showToast(summary === tr('没有需要整理的标签页 🎉') && extras.length
      ? extras.join(' · ') : [summary, ...extras].join(' · '));
  } catch (err) {
    console.error('[KoiTab] tidy failed', err);
    showToast(tr("整理时出错,请重试"));
  } finally {
    await loadTabs();
  }
}

/**
 * 诊断指标:对当前标签快照跑一遍各规划器(纯读),回答
 * 「有多少问题、动手之后会变成什么样」。render() 与诊断页共用这一份,
 * 保证按钮状态和报告里的数字永远一致。
 */
function computeMetrics() {
  const isAll = scope === 'all';
  const dupCount = countDuplicates(allTabs);
  // 「所有窗口」模式下多标签站点都会被集中,按「集中之后还剩什么」估算,避免重复计数
  const collectPlan = isAll
    ? planCollect(allTabs, currentWindowId)
    : { plans: [], loose: { tabIds: [], needed: false }, target: 'none' };
  const collectSites = collectPlan.plans.length;
  const collectInvolved = collectPlan.plans.reduce((n, p) => n + p.tabIds.length, 0);
  const loosePlan = collectPlan.loose || { tabIds: [], needed: false };
  const looseNeeded = !!loosePlan.needed;
  const collectDomains = new Set(collectPlan.plans.map((p) => p.domain));
  const leftover = isAll
    ? allTabs.filter((t) => !collectDomains.has(groupingKey(t.url)))
    : allTabs;
  const groupable = countGroupableSites(leftover);
  const loneGroups = countLoneGroups(allTabs);
  const reorderMoved = planReorder(allTabs).plans.reduce((n, p) => n + p.moved, 0);
  const ungrouped = allTabs.filter((t) => !t.pinned && !isGroupedTab(t)).length;
  const archivePlan = planArchive(allTabs, Date.now(), archiveDays);
  const archiveWhy = describeArchiveEmpty(archivePlan);

  const tidySteps = [];
  const mixed = mixedGroups(allTabs).length;
  const titleUpdates = planGroupTitles().length;
  if (titleUpdates) tidySteps.push(tr('更新 {0} 个分组名称', titleUpdates));
  if (mixed) tidySteps.push(tr("拆开 {0} 个混合分组", mixed));
  if (dupCount) tidySteps.push(tr("关闭 {0} 个重复", dupCount));
  if (collectSites) tidySteps.push(tr("把 {0} 个站点集中到当前窗口", collectSites));
  if (looseNeeded) tidySteps.push(tr("把 {0} 个散标签收进新窗口", loosePlan.tabIds.length));
  if (groupable) tidySteps.push(tr("合并 {0} 个站点", groupable));
  if (loneGroups) tidySteps.push(tr("取消 {0} 个单标签分组", loneGroups));
  if (reorderMoved) tidySteps.push(tr("把 {0} 个散标签排到分组右侧", reorderMoved));

  return {
    dupCount, collectPlan, collectSites, collectInvolved,
    loosePlan, looseNeeded, groupable, loneGroups, reorderMoved,
    ungrouped, archivePlan, tidySteps, archiveWhy,
    newGroups: collectSites + groupable,
  };
}

/**
 * 归档没候选时,到底是"为什么没有" —— 三种情况的下一步完全不同,
 * 不能都糊成一句「没有需要归档的 🎉」(那正是排查不到问题的根源):
 *
 *  - 'no-data'   一个使用时间都读不到 → 这台浏览器没开放 lastAccessed(Chrome<121),
 *                这不是"没旧页",是"看不见新旧",得引导去 debug.html 确认;
 *  - 'all-active' 有页但全是正在看的/固定的 → 确实无可归档;
 *  - 'not-stale' 读得到时间,只是最旧的一个也才几天 → 给出还差多久、可换哪档。
 */
function describeArchiveEmpty(plan) {
  if (plan.closeIds.length) return null;   // 有候选,无需解释

  // 能归档的对象 = 未固定 + 非激活 + 非浏览器内部页 + 拿得到 lastAccessed
  const eligible = allTabs.filter(
    (t) => !t.pinned && !t.active && t.id != null && normalizeDomain(t.url) !== '浏览器页面',
  );
  const timed = eligible.filter((t) => typeof t.lastAccessed === 'number');

  if (!eligible.length) {
    return { kind: 'all-active', text: tr("开着的页都在你眼前,没有可归的") };
  }
  if (!timed.length) {
    return { kind: 'no-data', text:
      tr("读不到任何\"上次使用时间\" —— 这项需要 Chrome 121+。")
      + tr("可能是浏览器版本偏低,或标签是刚恢复的。可在扩展目录打开 debug.html 核对。") };
  }

  // 最旧的那个也还不够"闲":报告它还差多久,并给一个刚好能命中它的更短档位
  const oldestMs = Math.min(...timed.map((t) => t.lastAccessed));
  const idleDays = Math.max(0, (Date.now() - oldestMs) / DAY_MS);
  const lower = [3, 7, 30].filter((d) => d < archiveDays && Date.now() - d * DAY_MS >= oldestMs);
  const suggest = lower.length ? Math.min(...lower) : null;  // 最小可命中档:至少收得走最旧的那个
  const idleText = idleDays < 1 / 1440 ? tr("就在刚刚") : tr("{0}前", fmtIdle(idleDays));
  return {
    kind: 'not-stale', idleDays, suggest,
    text: tr("没有超过 {0} 天没用的页 —— 最久的一个 {1}还用过。", archiveDays, idleText)
      + (suggest ? tr("切到「{0} 天」档就能收走它。", suggest)
        : idleDays < 3
          ? tr("最短的 3 天档也还没到,再晾几天就有。")
          : tr("3 天已是最小档 —— 再晾几天就有。")),
  };
}

function fmtIdle(days) {
  if (days < 1 / 24) return tr("刚刚");
  if (days < 1) return tr("{0} 小时", Math.max(1, Math.round(days * 24)));
  return tr("{0} 天", days.toFixed(days < 10 ? 1 : 0));
}

/** 指标行定义:标签、数量、是否"需要处理"(朱条) */
function metricRows(m) {
  return [
    { label: tr("重复网页"), n: m.dupCount, hint: tr("同网址多份"), warn: true },
    { label: tr("跨窗口同站点"), n: m.collectInvolved, hint: tr("{0} 个站点可集中", m.collectSites), warn: true },
    { label: tr("未分组散标签"), n: m.ungrouped, hint: tr("构不成组"), warn: false },
    { label: tr("单标签分组"), n: m.loneGroups, hint: tr("名不副实的空组"), warn: true },
    { label: tr("位置交错"), n: m.reorderMoved, hint: tr("散标签混在分组左边"), warn: false },
    { label: tr("{0} 天没用", archiveDays), n: m.archivePlan.closeIds.length, hint: tr("可收进 KoiTab 收藏再关"), warn: true },
  ];
}

function renderDiagnose(m) {
  const intro = document.getElementById('dx-intro');
  const result = document.getElementById('dx-result');
  if (!intro || !result) return;
  intro.classList.toggle('is-hidden', diagnosed);
  result.classList.toggle('is-hidden', !diagnosed);
  if (!diagnosed) return;

  const summary = document.getElementById('dx-summary');
  if (summary) {
    summary.textContent = tr("{0} 个标签页 · {1} 个窗口 · {2} 个站点", allTabs.length, windowCount, new Set(allTabs.map((t) => groupingKey(t.url))).size);
  }

  const rowsEl = document.getElementById('dx-rows');
  if (rowsEl) {
    rowsEl.textContent = '';
    const total = Math.max(1, allTabs.length);
    for (const row of metricRows(m)) {
      const pct = Math.min(100, Math.round((row.n / total) * 100));
      const line = document.createElement('div');
      line.className = 'koi-metric';

      const label = document.createElement('span');
      label.className = 'koi-metric-label';
      label.textContent = row.label;

      const bar = document.createElement('span');
      bar.className = 'koi-metric-bar';
      const fill = document.createElement('span');
      fill.className = 'koi-metric-fill' + (row.warn && row.n > 0 ? ' is-warn' : '');
      fill.style.width = pct + '%';
      bar.appendChild(fill);

      const num = document.createElement('span');
      num.className = 'koi-metric-num' + (row.n > 0 ? ' has' : '');
      num.textContent = row.n ? tr("{0} 个 · {1}%", row.n, pct) : '0';
      num.title = row.hint;

      line.append(label, bar, num);
      rowsEl.appendChild(line);
    }
  }

  const tidyP = document.getElementById('tidy-preview');
  if (tidyP) {
    tidyP.textContent = m.tidySteps.length
      ? tr("整理后:{0}{1}", m.newGroups ? tr("新合并出 {0} 个分组 · ", m.newGroups) : '', m.tidySteps.join('; '))
      : tr("已经整理好了,这一步可以跳过");
  }
  const archP = document.getElementById('archive-preview');
  if (archP) {
    const a = m.archivePlan;
    archP.textContent = a.closeIds.length
      ? tr("归档后:{0} 条收进 KoiTab 收藏并关闭 {1} 个页 · {2} 个站点", a.uniques.length, a.closeIds.length, a.domains)
        + (a.duplicatesClosed ? tr(" · {0} 个重复 URL 只收一份", a.duplicatesClosed) : '')
      : (m.archiveWhy ? m.archiveWhy.text : '——');
    // '没数据' 和 '都没闲够' 不是好消息也不是庆贺,别顶个 🎉;给足排查线索
    archP.classList.toggle('is-warn', !!m.archiveWhy && m.archiveWhy.kind !== 'all-active');
  }
}

/** 开始诊断:刷新数据 → 展示报告 */
async function runDiagnose() {
  const btn = document.getElementById('btn-diagnose');
  if (btn) {
    btn.disabled = true;
    btn.textContent = tr("诊脉中…");
  }
  try {
    await loadTabs();   // loadTabs 末尾会 render(),diagnosed 置位后渲染报告
    diagnosed = true;
    render();
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = tr("开始诊断");
    }
  }
}

/* ---------- 视图与配置控件 ---------- */

function syncViewUI() {
  ['ops', 'tabs', 'fav'].forEach((v) => {
    const nav = document.querySelector(`.koi-tab[data-view="${v}"]`);
    if (nav) {
      nav.classList.toggle('is-active', v === view);
      nav.setAttribute('aria-selected', String(v === view));
    }
    const panel = document.getElementById('panel-' + v);
    if (panel) panel.classList.toggle('is-active', v === view);
  });
}

function syncArchiveUI() {
  document.querySelectorAll('#seg-days [data-days]').forEach((b) => {
    b.classList.toggle('is-active', Number(b.dataset.days) === archiveDays);
  });
}

function syncAutoUI() {
  document.querySelectorAll('#seg-auto [data-auto]').forEach((b) => {
    b.classList.toggle('is-active', Number(b.dataset.auto) === autoCollapseN);
  });
}

async function setView(v) {
  if (operationBusy) return;
  if ((v !== 'ops' && v !== 'tabs' && v !== 'fav') || v === view) return;
  view = v;
  saveView();
  syncViewUI();
  if (v === 'fav') await loadFavorites();
  render();
}

/* ---------- 收藏夹 ---------- */
/**
 * 两个分区:
 *   ① KoiTab 收藏 —— 归档动作写进 chrome.storage.local(koiArchived),
 *      和浏览器书签完全无关;可打开、可删单条、可清空站点。
 *   ② 浏览器书签 —— 只读展示整棵书签树:满足"搜索时也能搜到书签内容",
 *      但不提供删除/清空 —— 写别人的数据那才叫"搭嘎",我们只看不碰。
 * 懒加载:不进这个 tab 完全不碰书签 API。
 */

async function loadFavorites(force) {
  if (favLoading) return;
  if (favData && !force) return;
  favLoading = true;
  try {
    // ① KoiTab 收藏(自己的存储),按站点分组、最近归档在前
    const rows = await readArchived();
    const byDomain = new Map();
    for (const r of rows) {
      const d = r.domain || normalizeDomain(r.url || '');
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(r);
    }
    const koi = [...byDomain.entries()].map(([domain, items]) => ({
      label: domain, kind: 'koi',
      items: [...items].sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0)),
    }));
    koi.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));

    // ② 浏览器书签(只读)。API 不可用就当没有,不影响 KoiTab 收藏分区
    let browser = [];
    if (chrome.bookmarks && chrome.bookmarks.getTree) {
      try { browser = await collectBrowserBookmarks(); }
      catch (err) { console.warn('[KoiTab] read browser bookmarks failed', err); }
    }

    favData = [...koi, ...browser];
  } catch (err) {
    console.warn('[KoiTab] load favorites failed', err);
    favData = null;                       // 下次进入还会重试
    const why = err && err.message ? String(err.message).slice(0, 60) : tr("未知错误");
    showToast(tr("读取收藏失败({0}),点「刷新」重试", why));
  } finally {
    favLoading = false;
  }
}

/** 遍历书签树,按"直接父文件夹"分组 —— 纯只读 */
async function collectBrowserBookmarks() {
  const tree = await chrome.bookmarks.getTree();
  const groups = new Map();   // folderId -> group
  const CONTAINER_IDS = new Set(['', '0', '1', '2']);   // 容器不进路径前缀

  const walk = (nodes, path) => {
    for (const node of nodes) {
      if (node.url) continue;
      const childPath = CONTAINER_IDS.has(node.id) ? path : [...path, node.title];
      const group = {
        label: childPath.join('/') || node.title || '书签',
        kind: 'browser',
        defaultLabel: !childPath.join('/') && !node.title,
        items: [],
      };
      groups.set(node.id, group);
      for (const child of (node.children || [])) {
        if (child.url) {
          group.items.push({ id: child.id, title: child.title, url: child.url });
        } else {
          walk([child], childPath);
        }
      }
    }
  };
  walk(tree, []);

  const out = [...groups.values()].filter((g) => g.items.length);
  out.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));
  return out;
}

/** 从最新存储按确认过的 ID 删除,不把过期或失效的界面缓存整份覆盖回去。 */
function deleteFavorites(ids) {
  return runExclusive(async () => {
    try {
      const rows = await readArchived();
      const removed = new Set(ids);
      await chrome.storage.local.set({
        [ARCHIVE_STORE_KEY]: rows.filter((r) => !removed.has(r.id)),
      });
      favData = null;
      await loadFavorites(true);
    } catch (err) {
      console.warn('[KoiTab] delete favorites failed', err);
      showToast(tr("删除失败,请刷新后重试"));
    }
  });
}

function favTotal() {
  return (favData || []).reduce((n, g) => n + g.items.length, 0);
}
function favKoiTotal() {
  return (favData || []).filter((g) => g.kind === 'koi').reduce((n, g) => n + g.items.length, 0);
}

async function openFavorite(item) {
  if (operationBusy) return;
  try {
    const prop = { url: item.url, active: true };
    if (currentWindowId != null) prop.windowId = currentWindowId;
    await chrome.tabs.create(prop);
  } catch (err) {
    console.warn('[KoiTab] open favorite failed', err);
  }
}

function removeFavorite(item) {
  return deleteFavorites([item.id]);
}

async function openWholeFolder(g) {
  if (operationBusy) return;
  for (const item of g.items) await openFavorite(item);
  showToast(tr("已在新标签页打开 {0} 条", g.items.length));
}

async function clearKoiFolder(g) {
  if (operationBusy) return;
  const okToGo = window.confirm(
    tr("删除「{0}」当前显示的 {1} 条 KoiTab 收藏?\n\n只删除这些条目,保留未命中的收藏,不动浏览器书签和任何标签页。", favoriteLabel(g), g.items.length),
  );
  if (!okToGo) return;
  await deleteFavorites(g.items.map((item) => item.id));
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function renderFavorites() {
  const listEl = document.getElementById('fav-list');
  if (!listEl) return;
  listEl.textContent = '';

  const statEl = document.getElementById('fav-stat');
  if (statEl) {
    const koi = favKoiTotal();
    const total = favTotal();
    statEl.textContent = favLoading ? tr("读取中…")
      : total ? tr("KoiTab 收藏 {0} 条 · 浏览器书签 {1} 条", koi, total - koi)
      : tr("还没有任何收藏");
  }

  const q = favQuery;
  const searching = q.length > 0;   // 搜索时强制展开,命中不能被藏起来
  const shown = (favData || [])
    .map((g) => ({
      ...g,
      items: q
        ? g.items.filter((i) =>
            (i.title || '').toLowerCase().includes(q) ||
            (i.url || '').toLowerCase().includes(q))
        : g.items,
    }))
    .filter((g) => g.items.length);

  if (!shown.length) {
    const empty = document.createElement('div');
    empty.className = 'koi-empty';
    empty.textContent = q
      ? tr("没有匹配的收藏")
      : tr("还没有收藏 —— 去「诊断」页归档一些长期没用的页,它们会出现在这里");
    listEl.appendChild(empty);
    syncFavToggleAllLabel();
    return;
  }

  const koiShown = shown.filter((g) => g.kind === 'koi');
  const browserShown = shown.filter((g) => g.kind !== 'koi');
  if (koiShown.length) listEl.appendChild(favSectionEl(SEC_KOI, tr("KoiTab 收藏"), '藏', koiShown, searching));
  if (browserShown.length) listEl.appendChild(favSectionEl(SEC_BROWSER, tr("浏览器书签"), '签', browserShown, searching));

  syncFavToggleAllLabel();
}

/** 分区外壳:标题行 = 印章 + 名称 + 计数,可整块折叠 */
function favSectionEl(key, title, markChar, groups, searching) {
  const sec = document.createElement('section');
  sec.className = 'koi-section';
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const collapsed = !searching && favPrefs[key] === 'collapsed';

  const head = document.createElement('div');
  head.className = 'koi-section-head';
  if (!searching) head.classList.add('is-clickable');
  head.setAttribute('aria-expanded', String(!collapsed));
  head.title = collapsed ? tr("展开「{0}」({1} 条)", title, total) : tr("折叠「{0}」", title);

  const caret = document.createElement('span');
  caret.className = 'koi-caret' + (collapsed ? ' is-collapsed' : '');
  caret.textContent = '▾';

  const mark = document.createElement('span');
  mark.className = 'koi-section-mark' + (key === SEC_KOI ? ' koi-section-mark-seal' : '');
  mark.textContent = markChar;
  mark.setAttribute('aria-hidden', 'true');

  const name = document.createElement('span');
  name.className = 'koi-section-title';
  name.textContent = title;

  const count = document.createElement('span');
  count.className = 'koi-section-count';
  count.textContent = tr("{0} 组 · {1} 条", groups.length, total);

  head.append(caret, mark, name, count);
  if (!searching) {
    head.addEventListener('click', () => {
      favPrefs[key] = favPrefs[key] === 'collapsed' ? 'expanded' : 'collapsed';
      saveFavPrefs();
      render();
    });
  }

  const body = document.createElement('div');
  body.className = 'koi-section-body' + (collapsed ? ' is-collapsed' : '');
  for (const g of groups) body.appendChild(favGroupEl(g, searching));

  sec.append(head, body);
  return sec;
}

/** 单个分组:KoiTab 收藏按站点、浏览器书签按文件夹;只有前者可清空 */
function favGroupEl(f, searching) {
  const group = document.createElement('section');
  group.className = 'koi-group';

  const isCollapsed = !searching && favPrefs[f.label] === 'collapsed';

  const head = document.createElement('div');
  head.className = 'koi-group-head';
  head.setAttribute('aria-expanded', String(!isCollapsed));
  head.title = isCollapsed
    ? tr("展开「{0}」({1} 条)", favoriteLabel(f), f.items.length)
    : tr("折叠「{0}」", favoriteLabel(f));

  const caret = document.createElement('span');
  caret.className = 'koi-caret' + (isCollapsed ? ' is-collapsed' : '');
  caret.textContent = '▾';

  const dot = document.createElement('span');
  dot.className = 'koi-dot';
  dot.style.background = domainColor(f.label);

  const name = document.createElement('span');
  name.className = 'koi-group-name';
  name.textContent = favoriteLabel(f);
  name.title = f.kind === 'koi' ? tr("KoiTab 收藏的页面") : tr("浏览器书签(只读,不会改动)");

  const count = document.createElement('span');
  count.className = 'koi-group-count';
  count.textContent = f.items.length;

  const openAll = document.createElement('button');
  openAll.className = 'koi-link-btn koi-fav-openall';
  openAll.textContent = tr("全部打开");
  openAll.title = tr("把「{0}」逐个在新标签页打开", favoriteLabel(f));
  openAll.addEventListener('click', (e) => {
    e.stopPropagation();
    return openWholeFolder(f);
  });

  const kids = [caret, dot, name, count, openAll];
  if (f.kind === 'koi') {
    const clear = document.createElement('button');
    clear.className = 'koi-close-domain';
    clear.textContent = '×';
    clear.title = tr("删除「{0}」当前显示的 {1} 条 KoiTab 收藏", favoriteLabel(f), f.items.length);
    clear.addEventListener('click', (e) => {
      e.stopPropagation();
      return clearKoiFolder(f);
    });
    kids.push(clear);
  }
  head.append(...kids);

  if (!searching) {
    head.classList.add('is-clickable');
    head.addEventListener('click', () => {
      favPrefs[f.label] = favPrefs[f.label] === 'collapsed' ? 'expanded' : 'collapsed';
      saveFavPrefs();
      render();
    });
  }

  const body = document.createElement('div');
  body.className = 'koi-group-body' + (isCollapsed ? ' is-collapsed' : '');

  for (const item of f.items) {
    const row = document.createElement('div');
    row.className = 'koi-row';
    const when = item.archivedAt ? tr(" · 归档于 {0}", fmtDate(item.archivedAt)) : '';
    row.title = tr("{0}\n{1}\n{2} · 点击在新标签页打开", item.title || '', item.url || '', f.kind === 'koi' ? tr("KoiTab 收藏") + when : tr("浏览器书签"));

    const fav = document.createElement('span');
    fav.className = 'koi-favicon';
    fav.style.background = domainColor(f.label);
    fav.textContent = faviconLetter(favoriteLabel(f));

    const title = document.createElement('span');
    title.className = 'koi-title';
    const host = (() => { try { return new URL(item.url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
    title.textContent = item.title || host || item.url || tr("(无标题)");

    const kidsRow = [fav, title];
    if (f.kind === 'koi') {
      const del = document.createElement('button');
      del.className = 'koi-close';
      del.textContent = '×';
      del.title = tr("从 KoiTab 收藏删除(不关浏览器的事)");
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        return removeFavorite(item);
      });
      kidsRow.push(del);
    }

    row.append(...kidsRow);
    row.addEventListener('click', () => openFavorite(item));
    body.appendChild(row);
  }

  group.append(head, body);
  return group;
}

/* ---------- init ---------- */

document.addEventListener('DOMContentLoaded', async () => {
  await KoiI18n.init();
  await Promise.all([loadScope(), loadCollapsed(), loadFavPrefs(), loadArchiveDays(), loadAutoCollapse(), loadView(), loadGrouping()]);
  syncViewUI();
  if (view === 'fav') await loadFavorites();
  await loadTabs();

  // 版本号显示在右上角小徽标里,便于确认加载的是哪一版
  try {
    const chip = document.getElementById('ver-chip');
    if (chip) chip.textContent = `v${chrome.runtime.getManifest().version}`;
  } catch { /* 忽略 */ }

  document.getElementById('language').addEventListener('change', async (event) => {
    if (operationBusy) {
      event.target.value = KoiI18n.preference;
      return;
    }
    try {
      await runExclusive(() => KoiI18n.setLanguage(event.target.value));
    } catch (error) {
      event.target.value = KoiI18n.preference;
      showToast(tr('语言设置失败,请重试'));
    }
  });

  document.getElementById('grouping-mode').addEventListener('change', async (event) => {
    const mode = event.target.value;
    if (operationBusy || !GROUPING_MODES.includes(mode)) { syncGroupingUI(); return; }
    try {
      await runExclusive(async () => {
        await chrome.storage.local.set({ [GROUPING_KEY]: mode });
        groupingMode = mode;
      });
    } catch (error) {
      syncGroupingUI();
      showToast(tr('分组设置保存失败,请重试'));
    }
  });

  const search = document.getElementById('search');
  search.addEventListener('input', () => {
    query = search.value.trim().toLowerCase();
    render();
  });

  const favSearch = document.getElementById('fav-search');
  favSearch.addEventListener('input', () => {
    favQuery = favSearch.value.trim().toLowerCase();
    render();
  });

  document.getElementById('koi-nav').addEventListener('click', (e) => {
    const btn = e.target.closest('.koi-tab');
    // 返回 promise:切到「收藏夹」要等书签读完再渲染,不能点燃就不管
    if (btn) return setView(btn.dataset.view);
  });

  document.getElementById('seg-scope').addEventListener('click', async (e) => {
    if (operationBusy) return;
    const btn = e.target.closest('[data-scope]');
    if (!btn || scope === btn.dataset.scope) return;
    scope = btn.dataset.scope;
    syncScopeUI();
    saveScope();
    await loadTabs();
  });

  document.getElementById('seg-days').addEventListener('click', async (e) => {
    if (operationBusy) return;
    const btn = e.target.closest('[data-days]');
    if (!btn) return;
    archiveDays = Number(btn.dataset.days) || 7;
    syncArchiveUI();
    await saveArchiveDays();
    render();
  });

  document.getElementById('seg-auto').addEventListener('click', async (e) => {
    if (operationBusy) return;
    const btn = e.target.closest('[data-auto]');
    if (!btn) return;
    autoCollapseN = Number(btn.dataset.auto);
    syncAutoUI();
    await saveAutoCollapse();
    render();
  });

  document.getElementById('btn-tidy').addEventListener('click', tidyAll);
  document.getElementById('btn-archive').addEventListener('click', archiveAll);
  document.getElementById('btn-diagnose').addEventListener('click', runDiagnose);
  document.getElementById('btn-diagnose-again').addEventListener('click', runDiagnose);
  document.getElementById('btn-fav-toggle-all').addEventListener('click', toggleAllFavGroups);
  document.getElementById('btn-fav-refresh').addEventListener('click', async () => {
    if (operationBusy) return;
    await loadFavorites(true);
    render();
  });
  document.getElementById('btn-ungroup-all').addEventListener('click', () => removeBrowserGroups());
  document.getElementById('group-scope').addEventListener('change', async (event) => {
    const next = event.target.value;
    if (operationBusy || !['window', 'all'].includes(next)) { event.target.value = scope; return; }
    try {
      await runExclusive(async () => {
        await chrome.storage.local.set({ [SCOPE_KEY]: next });
        scope = next;
        syncScopeUI();
        await loadTabs();
      });
    } catch (error) {
      event.target.value = scope;
      showToast(tr('范围设置失败，请重试'));
    }
  });
  document.getElementById('btn-toggle-all').addEventListener('click', toggleAllGroups);

  chrome.tabs.onCreated.addListener(scheduleTabRefresh);
  chrome.tabs.onRemoved.addListener(scheduleTabRefresh);
  chrome.tabs.onUpdated.addListener((id, info) => {
    if (info.url || info.title || 'groupId' in info || 'pinned' in info) scheduleTabRefresh();
  });
  chrome.windows.onRemoved.addListener(scheduleTabRefresh);
  for (const event of [chrome.tabs.onMoved, chrome.tabs.onAttached, chrome.tabs.onDetached,
    chrome.tabGroups.onCreated, chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved]) {
    event?.addListener(scheduleTabRefresh);
  }
});
