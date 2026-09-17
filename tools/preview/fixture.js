(() => {
  // Isolated screenshot data: no access to real tabs, bookmarks or browser storage.
  const params = new URLSearchParams(location.search);
  const lang = params.get("lang") || "zh";
  const view = params.get("view") || "ops";
  const prefs = { koiLanguage: lang, koiView: view };
  const events = { addListener() {} };
  const labels = {
    zh: [
      "项目路线图",
      "本周的设计笔记",
      "阅读清单",
      "水墨配色参考",
      "周末的灵感",
      "前端开发指南",
      "稍后阅读",
      "常用工具",
    ],
    en: [
      "Project roadmap",
      "Design notes this week",
      "Reading list",
      "Ink color references",
      "Weekend inspiration",
      "Frontend handbook",
      "Read later",
      "Everyday tools",
    ],
    ja: [
      "プロジェクト計画",
      "今週のデザインノート",
      "読書リスト",
      "水墨の配色",
      "週末のアイデア",
      "フロントエンド入門",
      "後で読む",
      "いつものツール",
    ],
    ko: [
      "프로젝트 로드맵",
      "이번 주 디자인 노트",
      "읽을거리 목록",
      "수묵 색상 참고",
      "주말의 영감",
      "프런트엔드 안내서",
      "나중에 읽기",
      "자주 쓰는 도구",
    ],
    la: [
      "Consilium operis",
      "Notae de forma",
      "Libri legendi",
      "Colores atramenti",
      "Ideae dierum festorum",
      "Ars paginarum",
      "Postea lege",
      "Instrumenta cotidiana",
    ],
  }[lang];
  const now = Date.now();
  const urls = [
    "https://github.com/example/roadmap",
    "https://github.com/example/design",
    "https://github.com/example/roadmap",
    "https://en.wikipedia.org/wiki/Ink",
    "https://en.wikipedia.org/wiki/Design",
    "https://developer.mozilla.org/en-US/docs/Web",
  ];
  const titles = [
    labels[0],
    labels[1],
    labels[0],
    labels[3],
    labels[4],
    labels[5],
  ];
  const tabs = urls.map((url, i) => ({
    id: i + 1,
    url,
    title: titles[i],
    windowId: 1,
    index: i,
    groupId: params.get("groups") === "1" ? (i < 3 ? 10 : i < 5 ? 11 : -1) : -1,
    active: i === 1,
    pinned: false,
    lastAccessed: now - (i === 1 ? 0 : 12 * 86400000),
  }));
  const archived = [
    {
      id: "one",
      url: "https://en.wikipedia.org/wiki/Reading",
      title: labels[2],
      domain: "wikipedia.org",
      archivedAt: now - 86400000,
    },
    {
      id: "two",
      url: "https://en.wikipedia.org/wiki/Ink",
      title: labels[3],
      domain: "wikipedia.org",
      archivedAt: now - 86400000,
    },
    {
      id: "three",
      url: "https://github.com/example/weekend",
      title: labels[4],
      domain: "github.com",
      archivedAt: now - 86400000,
    },
  ];
  window.chrome = {
    i18n: { getUILanguage: () => lang },
    action: { setTitle: async () => {} },
    runtime: {
      getURL: (p) => "/" + p,
      getManifest: () => window.previewManifest,
    },
    storage: {
      local: {
        get: async () => ({ ...prefs, koiArchived: archived }),
        set: async (p) => Object.assign(prefs, p),
      },
    },
    tabs: {
      query: async () => tabs,
      get: async (id) => tabs.find((t) => t.id === id),
      ungroup: async (ids) => { for (const tab of tabs) { if ([].concat(ids).includes(tab.id)) tab.groupId = -1; } },
      onCreated: events,
      onRemoved: events,
      onUpdated: events,
    },
    tabGroups: { query: async () => [...new Set(tabs.map((t) => t.groupId))]
      .filter((id) => id !== -1).map((id) => ({id, title: id === 10 ? 'github.com' : 'wikipedia.org'})) },
    windows: { getCurrent: async () => ({ id: 1 }), onRemoved: events },
    bookmarks: {
      getTree: async () => [
        {
          id: "0",
          children: [
            {
              id: "1",
              title: labels[7],
              children: [
                { id: "b1", title: "KoiNote", url: "https://koinote.app" },
                { id: "b2", title: "KoiAgent", url: "https://koiagent.app" },
              ],
            },
          ],
        },
      ],
    },
  };
})();
