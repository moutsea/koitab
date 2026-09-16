/**
 * KoiTab 诊断页(开发用,只读):验证 tab.lastAccessed 能否用于「清理长期未用标签」。
 *
 * 三个问题:
 *   1. 这台浏览器能不能拿到 lastAccessed?(Chrome 121+ 才有)
 *   2. 哪些标签页是 undefined?有没有规律?
 *   3. **最关键**:浏览器重启后时间戳是保留还是重置?
 *      —— 若被重置,「3 天未用」永远判不出来,功能就不能做。
 *
 * 用法:保存快照 → 完全退出浏览器 → 重新打开 → 回到本页看对比结论。
 * 本页只读:不会关闭、移动或激活任何标签页。
 */

const SNAPSHOT_KEY = 'koiDebugSnapshot';
// 快照时已经"至少 10 分钟没用过"的标签页,如果重启后时间戳一字不变,就是强证据
const STRONG_MS = 10 * 60 * 1000;

// ---------- 小工具 ----------
const el = (tag, props = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k === 'html') node.innerHTML = v;
    else node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c) node.appendChild(c);
  return node;
};

const pad = (n) => String(n).padStart(2, '0');

function absTime(ms) {
  if (ms == null) return '—';
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function relTime(ms) {
  if (ms == null) return '—';
  const diff = Date.now() - ms;
  if (diff < 0) return '刚刚';
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s} 秒前`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo} 个月前`;
  return `${Math.floor(mo / 12)} 年前`;
}

/** 从 UA 里取浏览器名与主版本号,用来判断是否够 Chrome 121 */
function browserInfo() {
  const ua = navigator.userAgent;
  const edg = ua.match(/Edg\/(\d+)/);
  const chr = ua.match(/Chrom(?:e|ium)\/(\d+)/);
  if (edg) return { name: 'Edge', major: Number(edg[1]) };
  if (chr) return { name: 'Chrome', major: Number(chr[1]) };
  return { name: '未知', major: null };
}

function hostOf(url) {
  try {
    const u = new URL(url);
    if (u.protocol === 'chrome:' || u.protocol === 'edge:' || u.protocol === 'about:') return '浏览器页面';
    return u.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || '(无 URL)';
  }
}

// ---------- 读取 ----------
async function readCurrent() {
  const tabs = await chrome.tabs.query({});
  return {
    at: Date.now(),
    ua: navigator.userAgent,
    manifestVersion: chrome.runtime.getManifest().version,
    hasApi: tabs.some((t) => typeof t.lastAccessed === 'number'),
    tabs: tabs.map((t) => ({
      id: t.id,
      url: t.url || t.pendingUrl || '',
      title: t.title || '',
      lastAccessed: typeof t.lastAccessed === 'number' ? t.lastAccessed : null,
      windowId: t.windowId,
      pinned: !!t.pinned,
      active: !!t.active,
      discarded: !!t.discarded,
    })),
  };
}

async function loadSnapshot() {
  const got = await chrome.storage.local.get(SNAPSHOT_KEY);
  return got[SNAPSHOT_KEY] || null;
}

// ---------- 渲染:环境 + 统计 ----------
function renderEnv(cur) {
  const info = browserInfo();
  const box = document.getElementById('env');
  box.textContent = '';

  const versions = { Chrome: 121, Edge: 121 };
  const need = versions[info.name];
  const okVersion = info.major != null && need != null && info.major >= need;

  box.append(
    el('div', { class: 'stat' }, [
      el('b', { text: info.major == null ? '?' : String(info.major) }),
      el('span', { text: `${info.name} 主版本号` }),
    ]),
    el('div', { class: 'stat' }, [
      el('b', { text: cur.hasApi ? '有' : '无' }),
      el('span', { text: '能否拿到 lastAccessed' }),
    ]),
    el('div', { class: 'stat' }, [
      el('b', { text: String(cur.tabs.length) }),
      el('span', { text: '当前标签页总数' }),
    ]),
    el('div', { class: 'stat' }, [
      el('b', { text: cur.manifestVersion }),
      el('span', { text: 'KoiTab 版本' }),
    ]),
  );

  if (!okVersion && need != null) {
    box.append(el('div', {
      class: 'hint',
      text: `${info.name} ${need}+ 才提供 lastAccessed。当前是 ${info.major}，所以全部为 undefined —— 这本身就是结论：低版本浏览器上这个功能做不了。`,
    }));
  }
  return { info, okVersion };
}

function renderStats(cur) {
  const box = document.getElementById('stats');
  box.textContent = '';
  const total = cur.tabs.length;
  const missing = cur.tabs.filter((t) => t.lastAccessed == null);
  const pinned = cur.tabs.filter((t) => t.pinned);
  const active = cur.tabs.filter((t) => t.active);
  const missingPinned = missing.filter((t) => t.pinned).length;
  const missingActive = missing.filter((t) => t.active).length;

  const stat = (n, label) => el('div', { class: 'stat' }, [
    el('b', { text: String(n) }),
    el('span', { text: label }),
  ]);

  box.append(
    stat(total, '标签页总数'),
    stat(total - missing.length, '有 lastAccessed'),
    stat(missing.length, 'undefined'),
    stat(`${missingActive}/${active.length}`, 'undefined 中属当前激活'),
    stat(`${missingPinned}/${pinned.length}`, 'undefined 中属固定标签'),
  );

  const staleCandidates = cur.tabs
    .filter((t) => t.lastAccessed != null)
    .sort((a, b) => a.lastAccessed - b.lastAccessed);
  if (staleCandidates.length) {
    const oldest = staleCandidates[0];
    const d = Math.floor((Date.now() - oldest.lastAccessed) / 86400000);
    box.append(el('div', { class: 'hint', text:
      `最久没用过的一个：${relTime(oldest.lastAccessed)}（约 ${d} 天）「${(oldest.title || hostOf(oldest.url)).slice(0, 40)}」` }));
  }
}

// ---------- 渲染:标签页表格 ----------
function renderTable(cur) {
  const tbody = document.querySelector('#tabs tbody');
  tbody.textContent = '';
  const rows = [...cur.tabs].sort((a, b) => {
    if (a.lastAccessed == null && b.lastAccessed == null) return 0;
    if (a.lastAccessed == null) return 1;   // undefined 排最后
    if (b.lastAccessed == null) return -1;
    return a.lastAccessed - b.lastAccessed;
  });

  for (const t of rows) {
    const tags = [];
    if (t.lastAccessed == null) tags.push(el('span', { class: 'tag miss', text: 'undefined' }));
    if (t.pinned) tags.push(el('span', { class: 'tag pin', text: '固定' }));
    if (t.active) tags.push(el('span', { class: 'tag', text: '当前' }));
    if (t.discarded) tags.push(el('span', { class: 'tag', text: '已休眠' }));

    tbody.append(el('tr', {}, [
      el('td', { class: 'num', text: relTime(t.lastAccessed) }),
      el('td', { class: 'num', text: absTime(t.lastAccessed) }),
      el('td', { class: 'num mono', text: t.lastAccessed == null ? '—' : String(t.lastAccessed) }),
      el('td', {}, [
        el('div', { class: 'u', text: t.title || '(无标题)' }),
        el('div', { class: 'u hint', text: hostOf(t.url) }),
      ]),
      el('td', { class: 'num', text: String(t.windowId) }),
      el('td', {}, tags),
    ]));
  }
}

// ---------- 跨重启对比 ----------
function compare(cur, snap) {
  // 重启后 tab id 会变,所以按 URL 匹配(同 URL 多个标签页按顺序一一对应)
  const pool = new Map();
  for (const t of snap.tabs) {
    if (!pool.has(t.url)) pool.set(t.url, []);
    pool.get(t.url).push(t);
  }

  const out = { same: [], changed: [], noPrev: [], lostValue: [], bothMissing: [], gainedValue: [] };
  for (const t of cur.tabs) {
    const arr = pool.get(t.url);
    const prev = arr && arr.length ? arr.shift() : null;
    if (!prev) { out.noPrev.push({ cur: t, prev: null }); continue; }
    if (prev.lastAccessed == null && t.lastAccessed == null) { out.bothMissing.push({ cur: t, prev }); continue; }
    if (prev.lastAccessed == null) { out.gainedValue.push({ cur: t, prev }); continue; }
    if (t.lastAccessed == null) { out.lostValue.push({ cur: t, prev }); continue; }
    if (t.lastAccessed === prev.lastAccessed) out.same.push({ cur: t, prev });
    else out.changed.push({ cur: t, prev });
  }
  return out;
}

/**
 * 跨重启结论:纯函数,便于测试。
 * 这是整个诊断的核心判断,判错的代价是给出错误的技术结论 —— 所以单独抽出来。
 *
 * 判据只看一件事:有没有标签页**保留了旧值**。
 * 重启后被激活过的标签页时间戳本来就该变新,那不算"被重置"。
 */
function verdictFor(cur, snap) {
  if (!snap) {
    return { level: 'unknown', text:
      '还没有快照。先点上面的「保存快照」，然后完全退出浏览器再回来。', c: null, strong: [] };
  }
  const c = compare(cur, snap);
  const strong = c.same.filter((r) => snap.at - r.prev.lastAccessed > STRONG_MS);

  if (strong.length > 0) {
    return { level: 'ok', c, strong, text:
      `✅ 时间戳跨重启被保留：${strong.length} 个标签页重启后仍是重启前的旧时间戳` +
      `（且当时就已经 ${Math.round(STRONG_MS / 60000)} 分钟以上没用过）。` +
      `→「清理长期未用标签」可以跨重启判断，功能能做。` };
  }
  if (c.changed.length > 0) {
    return { level: 'bad', c, strong, text:
      `❌ 时间戳在重启后被重置：${c.changed.length} 个能对比的标签页时间戳都变了（变成了重启时间），` +
      `没有一个保留旧值。→「3 天未用」永远判不出来，这个功能需要换方案` +
      `（自己记录时间，就需要常驻后台）。` };
  }
  return { level: 'unknown', c, strong, text:
    `⚠️ 数据不足：没有可比对的标签页（重启后可能都被关掉了，` +
    `或者启动行为不是「继续浏览上次打开的网页」）。` +
    `请重新走一遍：保存快照 → 完全退出 → 重新打开。` };
}

/** 页面上方最显眼的位置:只放结论 */
function renderVerdict(cur, snap) {
  const box = document.getElementById('verdict');
  box.textContent = '';
  const v = verdictFor(cur, snap);
  box.append(el('div', { class: `verdict ${v.level}`, text: v.text }));
}

function renderCompareDetail(cur, snap) {
  const box = document.getElementById('compare');
  box.textContent = '';
  if (!snap) return;

  const { c, strong } = verdictFor(cur, snap);

  const grid = el('div', { class: 'grid' }, [
    el('div', { class: 'stat' }, [el('b', { text: String(strong.length) }), el('span', { text: '保留旧值（强证据）' })]),
    el('div', { class: 'stat' }, [el('b', { text: String(c.same.length) }), el('span', { text: '时间戳一致' })]),
    el('div', { class: 'stat' }, [el('b', { text: String(c.changed.length) }), el('span', { text: '时间戳变新了' })]),
    el('div', { class: 'stat' }, [el('b', { text: String(c.noPrev.length) }), el('span', { text: '快照里没有的新标签' })]),
    el('div', { class: 'stat' }, [el('b', { text: String(c.bothMissing.length) }), el('span', { text: '前后都无值' })]),
    el('div', { class: 'stat' }, [el('b', { text: String(c.lostValue.length + c.gainedValue.length) }), el('span', { text: '值出现/消失' })]),
  ]);
  box.append(el('h2', { text: '对比明细' }), grid);
  box.append(el('div', { class: 'hint', text:
    `注意：重启后被激活过的标签页，时间戳本来就该变成重启时间 —— 这不算"被重置"。` +
    `判据是上面第一项：有没有标签页保留了旧值。` }));

  const detail = el('div', { class: 'wrap' }, [el('table', {}, [
    el('thead', {}, [el('tr', {}, [
      el('th', { text: '结论' }), el('th', { text: '重启前' }), el('th', { text: '现在' }), el('th', { text: '站点 / 标题' }),
    ])]),
    el('tbody', {}, [
      ...strong.map((r) => detailRow('✅ 保留旧值', r, snap.at)),
      ...c.same.filter((r) => !strong.includes(r)).map((r) => detailRow('一致（但快照时就很新）', r, snap.at)),
      ...c.changed.map((r) => detailRow('变为新时间', r, snap.at)),
      ...c.bothMissing.map((r) => detailRow('前后都无值', r, snap.at)),
      ...c.gainedValue.map((r) => detailRow('之前无值 → 现在有值', r, snap.at)),
      ...c.lostValue.map((r) => detailRow('之前有值 → 现在无值', r, snap.at)),
      ...c.noPrev.map((r) => detailRow('快照里没有', r, snap.at)),
    ]),
  ])]);
  box.append(el('h2', { text: '每个标签页的对比' }), detail);
}

function detailRow(label, r, snapAt) {
  const t = r.cur;
  return el('tr', {}, [
    el('td', { class: 'num', text: label }),
    el('td', { class: 'num', text: r.prev ? relTime(r.prev.lastAccessed) : '—' }),
    el('td', { class: 'num', text: relTime(t.lastAccessed) }),
    el('td', {}, [
      el('div', { class: 'u', text: t.title || '(无标题)' }),
      el('div', { class: 'u hint', text: hostOf(t.url) }),
    ]),
  ]);
}

// ---------- 复制结果 ----------
function buildReport(cur, snap) {
  const info = browserInfo();
  const lines = [];
  lines.push(`KoiTab lastAccessed 诊断`);
  lines.push(`时间: ${absTime(Date.now())}`);
  lines.push(`浏览器: ${info.name} ${info.major}`);
  lines.push(`UA: ${navigator.userAgent}`);
  lines.push(`KoiTab 版本: ${cur.manifestVersion}`);
  lines.push(`标签页总数: ${cur.tabs.length}`);
  const missing = cur.tabs.filter((t) => t.lastAccessed == null);
  lines.push(`undefined: ${missing.length} / ${cur.tabs.length}`);
  lines.push(`能否拿到 lastAccessed: ${cur.hasApi ? '能' : '不能'}`);

  const withVal = cur.tabs.filter((t) => t.lastAccessed != null).sort((a, b) => a.lastAccessed - b.lastAccessed);
  lines.push('');
  lines.push(`最久没用过的 8 个:`);
  for (const t of withVal.slice(0, 8)) {
    lines.push(`  ${relTime(t.lastAccessed)} | ${absTime(t.lastAccessed)} | ${hostOf(t.url)} | ${(t.title || '').slice(0, 50)}`);
  }
  const undef = missing.slice(0, 8);
  if (undef.length) {
    lines.push('');
    lines.push(`undefined 的标签页(最多列 8 个):`);
    for (const t of undef) {
      lines.push(`  固定=${t.pinned ? 'Y' : 'N'} 当前=${t.active ? 'Y' : 'N'} | ${hostOf(t.url)} | ${(t.title || '').slice(0, 50)}`);
    }
  }

  if (snap) {
    const c = compare(cur, snap);
    const strong = c.same.filter((r) => snap.at - r.prev.lastAccessed > STRONG_MS);
    lines.push('');
    lines.push(`跨重启对比`);
    lines.push(`  快照时间: ${absTime(snap.at)}`);
    lines.push(`  保留旧值(强证据): ${strong.length}`);
    lines.push(`  时间戳一致: ${c.same.length}`);
    lines.push(`  时间戳变新: ${c.changed.length}`);
    lines.push(`  快照里没有的新标签: ${c.noPrev.length}`);
    lines.push(`  前后都无值: ${c.bothMissing.length}`);
    lines.push(`  值出现/消失: ${c.gainedValue.length} / ${c.lostValue.length}`);
    lines.push(`  结论: ${strong.length > 0 ? '跨重启保留' : (c.changed.length > 0 ? '重启后被重置' : '数据不足')}`);
    lines.push('');
    lines.push(`  保留旧值的标签页(最多 10 个):`);
    for (const r of strong.slice(0, 10)) {
      lines.push(`    重启前 ${relTime(r.prev.lastAccessed)} | 现在 ${relTime(r.cur.lastAccessed)} | ${hostOf(r.cur.url)}`);
    }
  } else {
    lines.push('');
    lines.push(`跨重启对比: 还没有快照`);
  }
  return lines.join('\n');
}

// ---------- 主流程 ----------
let current = null;
let snapshot = null;

async function refresh() {
  current = await readCurrent();
  snapshot = await loadSnapshot();
  renderEnv(current);
  renderStats(current);
  renderTable(current);
  renderVerdict(current, snapshot);
  renderCompareDetail(current, snapshot);

  const info = document.getElementById('snap-info');
  info.textContent = snapshot ? `已有快照：${absTime(snapshot.at)}` : '还没有快照';
}

document.getElementById('btn-refresh').addEventListener('click', refresh);

document.getElementById('btn-snapshot').addEventListener('click', async () => {
  const data = await readCurrent();
  await chrome.storage.local.set({ [SNAPSHOT_KEY]: data });
  await refresh();
  alert(`已保存 ${data.tabs.length} 个标签页的快照。\n\n现在请完全退出浏览器,再重新打开,然后回到本页看「跨重启对比」。`);
});

document.getElementById('btn-clear').addEventListener('click', async () => {
  await chrome.storage.local.remove(SNAPSHOT_KEY);
  await refresh();
});

document.getElementById('btn-copy').addEventListener('click', async () => {
  const text = buildReport(current || await readCurrent(), snapshot);
  try {
    await navigator.clipboard.writeText(text);
    alert('已复制到剪贴板,直接粘给我就行。');
  } catch (err) {
    window.prompt('自动复制失败,请手动复制下面这段:', text);
  }
});

refresh();
