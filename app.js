"use strict";
/* イーストラジオ045 公開スケジュール
   個人サイボウズ2と同じ方式: データはこの端末の localStorage だけに保存する。
   サーバー（GitHub Pages）には空のアプリ枠だけがあり、予定データは一切送られない。
   画面は下タブ5つ: スケジュール / 制作予定 / 進行状況 / ネタ倉庫 / 設定。
   制作予定だけは例外で、正本はリポジトリの schedule.json（共有データ）。
   アプリは表示するだけで、登録・変更は友がJSON側で行う。
   ネタ倉庫も表示だけで、正本は非公開リポジトリ eastradio-ideas の ideas.json。
   読み取りキーは localStorage の専用キーにだけ置き、控えファイル・自動控えには絶対に入れない。 */
const LS_KEY = "eastradio-schedule-v1";

const STATUS = {
  making:    { label: "制作中",           cls: "st-making" },
  assembled: { label: "組み立て完了",     cls: "st-assembled" },
  unlisted:  { label: "限定公開・確認待ち", cls: "st-unlisted" },
  published: { label: "公開済み",         cls: "st-published" }
};
/* 制作の段階: 台本 → 音声 → 組み立て → 限定公開・確認 → 公開
   stageDone = 済んだ段階の数（0〜5）、stageDoing = いま進めている段階の番号（0〜4、なしは -1） */
const STEPS = ["台本", "音声", "組み立て", "限定公開・確認", "公開"];

/* 初期データ: アプリを初めて開いたときだけ入る。以後は本人の編集が正で、
   全件消しても入れ直さない（seeded フラグで管理）。 */
const SEED_EPISODES = [
  { ep: 1, title: "顔には出さないけど、ゴリラーマンが好きだった。", date: "2026-11-24", time: "19:00", status: "published", stageDone: 5, stageDoing: -1, url: "https://youtu.be/2GRH4_v7mOU", memo: "" },
  { ep: 2, title: "『青空』を、何度も巻き戻した", date: "2026-11-27", time: "19:00", status: "assembled", stageDone: 3, stageDoing: -1, url: "", memo: "" },
  { ep: 3, title: "一番印象に残っている入場シーン", date: "2026-12-01", time: "19:00", status: "assembled", stageDone: 3, stageDoing: -1, url: "", memo: "" },
  { ep: 4, title: "主役じゃない男、青八木一", date: "2026-12-08", time: "19:00", status: "assembled", stageDone: 3, stageDoing: -1, url: "", memo: "" },
  { ep: 5, title: "僕が見てきた堀口恭司", date: "2026-12-15", time: "19:00", status: "making", stageDone: 2, stageDoing: 2, url: "", memo: "" },
  { ep: 6, title: "主人公らしくない主人公、戯言遣い", date: "2026-12-22", time: "19:00", status: "making", stageDone: 2, stageDoing: 2, url: "", memo: "日付は仮置き" }
];

function emptyStore() {
  return { episodes: [], snapshots: [], lastBackupExport: null, seeded: false };
}
function loadStore() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return emptyStore();
    return Object.assign(emptyStore(), JSON.parse(raw));
  } catch (e) { return emptyStore(); }
}
let store = loadStore();
if (!store.seeded) {
  store.episodes = SEED_EPISODES.map(e => Object.assign({ id: uid() }, e));
  store.seeded = true;
  saveStore(false);
}
/* 公開曜日ルール変更（2026-11-25決定：通常回は金曜19時）への日付付け替え。
   初期データのままの日付だけを対象にし、手で変えた日付には触らない。 */
const DATE_FIX_20261125 = { 3: ["2026-12-01", "2026-12-04"], 4: ["2026-12-08", "2026-12-11"], 5: ["2026-12-15", "2026-12-18"], 6: ["2026-12-22", "2026-12-25"] };
let dateFixed = false;
for (const e of store.episodes) {
  const f = DATE_FIX_20261125[Number(e.ep)];
  if (f && e.date === f[0]) { e.date = f[1]; dateFixed = true; }
}
if (dateFixed) saveStore(false);
/* 週2ペース決定（2026-11-25：火曜・金曜19時）に伴う日付付け替え。
   初期データの日付と、上の付け替え後の日付の両方を対象にする。手で変えた日付には触らない。 */
const DATE_FIX2_20261125 = {
  3: { from: ["2026-12-01", "2026-12-04"], to: "2026-12-01" },
  4: { from: ["2026-12-08", "2026-12-11"], to: "2026-12-04" },
  5: { from: ["2026-12-15", "2026-12-18"], to: "2026-12-08" },
  6: { from: ["2026-12-22", "2026-12-25"], to: "2026-12-11" }
};
let dateFixed2 = false;
for (const e of store.episodes) {
  const f = DATE_FIX2_20261125[Number(e.ep)];
  if (f && f.from.includes(e.date) && e.date !== f.to) { e.date = f.to; dateFixed2 = true; }
}
if (dateFixed2) saveStore(false);
/* 第7話・第8話の追加（2026-11-25：公開日程の確定に伴う）。
   保存済みに無い話数だけを末尾に足す。既存の話数や手で変えた内容には一切触らない。 */
const ADD_EPISODES_20261125 = [
  { ep: 7, title: "タイトル未定", date: "2026-12-15", time: "19:00", status: "making", stageDone: 0, stageDoing: 0, url: "", memo: "" },
  { ep: 8, title: "タイトル未定", date: "2026-12-18", time: "19:00", status: "making", stageDone: 0, stageDoing: 0, url: "", memo: "" }
];
let episodesAdded = false;
for (const add of ADD_EPISODES_20261125) {
  if (!store.episodes.some(e => Number(e.ep) === add.ep)) {
    store.episodes.push(Object.assign({ id: uid() }, add));
    episodesAdded = true;
  }
}
if (episodesAdded) saveStore(false);
/* 第5話・第6話の組み立て完了の反映（2026-11-25：レイナのOK済み）。
   初期データのまま（制作中・音声まで完了・組み立て進行中）のときだけ付け替え、
   手で変えた内容には触らない。 */
const STATUS_FIX_20261125 = [5, 6];
let statusFixed = false;
for (const e of store.episodes) {
  if (STATUS_FIX_20261125.includes(Number(e.ep)) &&
      e.status === "making" && Number(e.stageDone) === 2 && Number(e.stageDoing) === 2) {
    e.status = "assembled"; e.stageDone = 3; e.stageDoing = -1;
    statusFixed = true;
  }
}
if (statusFixed) saveStore(false);
/* 第7話の組み立て完了とタイトルの反映（2026-11-27：レイナのOK済み）。
   初期データのまま（制作中・段階0）のときだけ付け替え、手で変えた内容には触らない。 */
const STATUS_FIX_20261127 = [7];
let statusFixed2 = false;
for (const e of store.episodes) {
  if (STATUS_FIX_20261127.includes(Number(e.ep)) &&
      e.status === "making" && Number(e.stageDone) === 0 && Number(e.stageDoing) === 0) {
    e.status = "assembled"; e.stageDone = 3; e.stageDoing = -1;
    if (e.title === "タイトル未定") e.title = "格闘技の果てに、範馬勇次郎はいるのか。";
    statusFixed2 = true;
  }
}
if (statusFixed2) saveStore(false);
function saveStore(withSnapshot) {
  if (withSnapshot) {
    store.snapshots.push({ ts: new Date().toISOString(), data: JSON.stringify({ episodes: store.episodes }) });
    while (store.snapshots.length > 10) store.snapshots.shift(); // 自動控えは最新10世代
  }
  localStorage.setItem(LS_KEY, JSON.stringify(store));
}

let editingId = null;
let currentTab = "scrList"; // 編集画面から戻る先

function uid() { return "e" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }
function esc(s) { return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function pad2(n) { return String(n).padStart(2, "0"); }
function toYMD(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
function fmtShort(ymd, time) {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = "日月火水木金土"[new Date(y, m - 1, d).getDay()];
  return m + "/" + d + "(" + dow + ")" + (time ? " " + time : "");
}
function statusOf(e) { return STATUS[e.status] || STATUS.making; }
function stageDoneOf(e) { const n = Number(e.stageDone); return Number.isFinite(n) ? Math.min(5, Math.max(0, n)) : 0; }
function stageDoingOf(e) { const n = Number(e.stageDoing); return Number.isFinite(n) ? n : -1; }
function sortedEpisodes() {
  return store.episodes.slice().sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    String(a.time || "").localeCompare(String(b.time || "")) ||
    (Number(a.ep) || 0) - (Number(b.ep) || 0));
}

/* ----- 最新版へ更新（古い版の残りを消して読み直す。データには触らない） ----- */
async function forceUpdate() {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      for (const r of regs) await r.unregister();
    }
    if (window.caches) {
      const keys = await caches.keys();
      for (const k of keys) await caches.delete(k);
    }
  } catch (e) { /* 消せなくても読み直しはする */ }
  location.reload();
}

/* ----- 画面切り替え（下タブ） ----- */
function show(id) {
  document.querySelectorAll(".screen").forEach(el => el.style.display = "none");
  document.getElementById(id).style.display = "block";
  window.scrollTo(0, 0);
}
function showTab(id) {
  currentTab = id;
  document.getElementById("tabList").classList.toggle("on", id === "scrList");
  document.getElementById("tabProd").classList.toggle("on", id === "scrProd");
  document.getElementById("tabProgress").classList.toggle("on", id === "scrProgress");
  document.getElementById("tabIdeas").classList.toggle("on", id === "scrIdeas");
  document.getElementById("tabSettings").classList.toggle("on", id === "scrSettings");
  if (id === "scrList") renderList();
  if (id === "scrProd") loadProdSchedule();
  if (id === "scrProgress") renderProgress();
  if (id === "scrIdeas") loadIdeas();
  if (id === "scrSettings") renderSettings();
  show(id);
}

/* ----- 共通のカード表示 ----- */
function stepsHtml(e) {
  const done = stageDoneOf(e), doing = stageDoingOf(e);
  return '<div class="steps">' + STEPS.map((s, i) => {
    let cls = "step", mark = "";
    if (i < done) { cls += " done"; mark = "✓ "; }
    else if (i === doing) { cls += " doing"; mark = "▶ "; }
    return (i ? '<span class="step-arrow">→</span>' : "") + '<span class="' + cls + '">' + mark + s + (i === doing ? "（進行中）" : "") + "</span>";
  }).join("") + "</div>";
}
function episodeCard(e, withSteps) {
  const st = statusOf(e);
  const published = e.status === "published";
  return '<div class="card ' + st.cls + '" data-ep="' + e.id + '">' +
    '<div class="cardhead"><span class="epno">第' + esc(e.ep) + '話</span>' +
    '<span class="badge ' + st.cls + '">' + st.label + "</span></div>" +
    '<div class="title">' + esc(e.title) + "</div>" +
    '<div class="pubdate' + (published ? " actual" : "") + '"><span class="lbl">' + (published ? "公開日" : "公開予定日") + "</span>" + fmtShort(e.date, e.time) + "</div>" +
    (e.url ? '<div class="sub">' + esc(e.url) + "</div>" : "") +
    (withSteps ? stepsHtml(e) : "") +
    (e.memo ? '<div class="memo">' + esc(e.memo) + "</div>" : "") +
    "</div>";
}
function wireCards(box) {
  box.querySelectorAll("[data-ep]").forEach(c => c.addEventListener("click", () => openForm(c.getAttribute("data-ep"))));
}

/* ----- スケジュール（一覧） ----- */
function renderList() {
  renderOverdueAlert();
  const box = document.getElementById("episodeList");
  const list = sortedEpisodes();
  box.innerHTML = list.length ? list.map(e => episodeCard(e, false)).join("") : '<p class="muted">まだ話が登録されていません。「＋ 話を足す」から追加できます。</p>';
  wireCards(box);
}
function renderOverdueAlert() {
  const todayYMD = toYMD(new Date());
  const overdue = sortedEpisodes().filter(e => e.date < todayYMD && e.status !== "published");
  const el = document.getElementById("overdueAlert");
  if (!overdue.length) { el.style.display = "none"; el.innerHTML = ""; return; }
  el.style.display = "block";
  el.innerHTML = '<div class="od-title">公開予定日を過ぎているのに、まだ「公開済み」になっていない話が ' + overdue.length + " 件あります</div>" +
    overdue.map(e => '<button type="button" data-od="' + e.id + '">第' + esc(e.ep) + "話 " + esc(e.title) + "（" + fmtShort(e.date, e.time) + "・" + statusOf(e).label + "）</button>").join("");
  el.querySelectorAll("[data-od]").forEach(b => b.addEventListener("click", () => openForm(b.getAttribute("data-od"))));
}

/* ----- 進行状況 ----- */
function progressGroup(e) {
  if (e.status === "published") return 2;               // 公開済みは下
  if (e.status === "assembled" || e.status === "unlisted") return 1; // 組み立て完了・確認待ち
  return 0;                                              // 作成中は上
}
function renderProgress() {
  const box = document.getElementById("progressList");
  const list = sortedEpisodes().sort((a, b) =>
    progressGroup(a) - progressGroup(b) ||
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    (Number(a.ep) || 0) - (Number(b.ep) || 0));
  if (!list.length) { box.innerHTML = '<p class="muted">まだ話が登録されていません。</p>'; return; }
  const heads = ["いま作成中", "組み立て完了・確認待ち", "公開済み"];
  let html = "", lastGroup = -1;
  for (const e of list) {
    const g = progressGroup(e);
    if (g !== lastGroup) { html += '<div class="grouphead">' + heads[g] + "</div>"; lastGroup = g; }
    html += episodeCard(e, true);
  }
  box.innerHTML = html;
  wireCards(box);
}

/* ----- 制作予定（schedule.json 共有データ・読み取り専用） -----
   正本はリポジトリの schedule.json。友がJSON側で登録・変更し、アプリは表示だけする。
   取れたら localStorage に控えを取り、取れなかったら前回分を「前回の取得分」と明示して出す。 */
const PROD_LS_KEY = "eastradio-schedule-prod-last";
const PROD_CATEGORIES = {
  planning:   { label: "企画",               bg: "#ede9fe", fg: "#5b21b6", bar: "#8b5cf6" },
  prep:       { label: "事前準備",           bg: "#e0f2fe", fg: "#075985", bar: "#38bdf8" },
  meeting:    { label: "友との台本会議",     bg: "#fce7f3", fg: "#9d174d", bar: "#f472b6" },
  script:     { label: "台本確認・修正",     bg: "#fef3c7", fg: "#92400e", bar: "#f59e0b" },
  production: { label: "動画制作",           bg: "#dbeafe", fg: "#1e40af", bar: "#2563eb" },
  unlisted:   { label: "限定公開・本人確認", bg: "#ffedd5", fg: "#9a3412", bar: "#ea580c" },
  publish:    { label: "一般公開",           bg: "#dcfce7", fg: "#166534", bar: "#16a34a" }
};
function prodCategoryOf(it) {
  return PROD_CATEGORIES[it.category] || { label: String(it.category || "その他"), bg: "#e5e7eb", fg: "#374151", bar: "#9ca3af" };
}
function sortProdItems(items) {
  return items.slice().sort((a, b) =>
    (String(a.date || "") < String(b.date || "") ? -1 : String(a.date || "") > String(b.date || "") ? 1 : 0) ||
    String(a.time || "").localeCompare(String(b.time || "")) ||
    String(a.id || "").localeCompare(String(b.id || "")));
}
function prodItemHtml(it) {
  const cat = prodCategoryOf(it);
  const dateLabel = it.date ? fmtShort(it.date, "") : "日付なし";
  return '<div class="prodcard' + (it.done ? " done" : "") + '" style="border-left-color:' + cat.bar + '">' +
    '<div class="cardhead"><span class="proddate">' + esc(dateLabel) + (it.time ? " " + esc(it.time) : "") + "</span></div>" +
    '<div class="title">' + (it.done ? "✓ " : "") + esc(it.title) + "</div>" +
    '<div class="prodmeta"><span class="catchip" style="background:' + cat.bg + ";color:" + cat.fg + '">' + esc(cat.label) + "</span>" +
    (it.ep != null && it.ep !== "" ? '<span class="prodep">第' + esc(it.ep) + "話</span>" : "") + "</div>" +
    (it.memo ? '<div class="memo">' + esc(it.memo) + "</div>" : "") +
    "</div>";
}
function renderProd(items, notice) {
  const nbox = document.getElementById("prodNotice");
  const box = document.getElementById("prodList");
  nbox.textContent = notice || "";
  nbox.style.display = notice ? "" : "none";
  if (!items || !items.length) {
    box.innerHTML = '<p class="muted">制作予定はまだ登録されていません。</p>';
    return;
  }
  box.innerHTML = sortProdItems(items).map(prodItemHtml).join("");
}
async function loadProdSchedule() {
  const nbox = document.getElementById("prodNotice");
  nbox.textContent = "読み込み中…";
  nbox.style.display = "";
  try {
    const res = await fetch("schedule.json?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) throw new Error("bad json");
    try { localStorage.setItem(PROD_LS_KEY, JSON.stringify({ fetchedAt: new Date().toISOString(), data: data })); } catch (e) {}
    renderProd(data.items, "");
  } catch (err) {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(PROD_LS_KEY) || "null"); } catch (e) {}
    if (saved && saved.data && Array.isArray(saved.data.items)) {
      const when = saved.fetchedAt ? saved.fetchedAt.replace("T", " ").slice(0, 16) : "日時不明";
      renderProd(saved.data.items, "前回の取得分を表示中（取得日時：" + when + "）");
    } else {
      renderProd(null, "");
      document.getElementById("prodList").innerHTML = '<p class="muted">制作予定を取得できませんでした。通信できる場所で開き直してください。</p>';
    }
  }
}

/* ----- ネタ倉庫（ideas.json・非公開リポジトリ・読み取り専用） -----
   正本は非公開リポジトリ k017dam-ops/eastradio-ideas の ideas.json（スキーマは IDEAS_JSON.md）。
   GitHub API の contents エンドポイントを、読み取りキー付きで叩いて表示だけする。
   キーと取得キャッシュは localStorage の専用キーにだけ置く。store には入れないので、
   控えファイル（exportBackup）にも自動控え（snapshots）にも混ざらない。 */
const IDEAS_KEY_LS = "eastradio-schedule-ideas-key";
const IDEAS_CACHE_LS = "eastradio-schedule-ideas-cache";
const IDEAS_API_URL = "https://api.github.com/repos/k017dam-ops/eastradio-ideas/contents/ideas.json";
/* 分類・状態のラベルは IDEAS_JSON.md の対応表どおり */
const IDEA_CATEGORIES = {
  favorite:  { label: "好きな作品・人物",     bg: "#fce7f3", fg: "#9d174d" },
  views:     { label: "再生数を意識した企画", bg: "#e0f2fe", fg: "#075985" },
  crossover: { label: "ジャンル横断企画",     bg: "#ede9fe", fg: "#5b21b6" },
  timely:    { label: "時事企画",             bg: "#fef3c7", fg: "#92400e" },
  series:    { label: "長期シリーズ",         bg: "#dcfce7", fg: "#166534" }
};
const IDEA_STATUSES = {
  candidate: { label: "候補",     bg: "#e5e7eb", fg: "#374151", bar: "#9ca3af" },
  adopted:   { label: "採用済み", bg: "#dcfce7", fg: "#166534", bar: "#16a34a" },
  hold:      { label: "保留",     bg: "#fef3c7", fg: "#92400e", bar: "#f59e0b" },
  producing: { label: "制作中",   bg: "#dbeafe", fg: "#1e40af", bar: "#2563eb" },
  produced:  { label: "制作済み", bg: "#ede9fe", fg: "#5b21b6", bar: "#8b5cf6" }
};
let ideasFilter = "all";
let ideasItemsCache = null;   // 直近に描画した企画（分類フィルタの切り替え用）
let ideasNoticeText = "";
function ideaCategoryOf(it) {
  return IDEA_CATEGORIES[it.category] || { label: String(it.category || "その他"), bg: "#e5e7eb", fg: "#374151" };
}
function ideaStatusOf(it) { return IDEA_STATUSES[it.status] || IDEA_STATUSES.candidate; }
function fmtIdeaDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return "";
  return Number(m[2]) + "/" + Number(m[3]);
}
function sortIdeaItems(items) {
  return items.slice().sort((a, b) =>
    String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")) ||
    String(a.id || "").localeCompare(String(b.id || "")));
}
function ideaItemHtml(it) {
  const cat = ideaCategoryOf(it), st = ideaStatusOf(it);
  let chips = '<span class="catchip" style="background:' + cat.bg + ";color:" + cat.fg + '">' + esc(cat.label) + "</span>" +
    '<span class="catchip" style="background:' + st.bg + ";color:" + st.fg + '">' + esc(st.label) + "</span>";
  if (it.priority === "high") chips += '<span class="catchip" style="background:#fee2e2;color:#b91c1c">優先度：高</span>';
  if (it.priority === "low") chips += '<span class="catchip" style="background:#f1f5f9;color:#64748b">優先度：低</span>';
  if (it.needsPrep) chips += '<span class="catchip" style="background:#fff7ed;color:#9a3412">事前準備あり</span>';
  if (it.linkedSchedule && it.linkedSchedule.episode != null && it.linkedSchedule.episode !== "") {
    chips += '<span class="catchip" style="background:#dcfce7;color:#166534">第' + esc(it.linkedSchedule.episode) + "話の制作予定へ移行済み</span>";
  }
  return '<div class="prodcard" style="border-left-color:' + st.bar + '">' +
    '<div class="title">' + esc(it.title) + "</div>" +
    '<div class="prodmeta">' + chips + "</div>" +
    (it.summary ? '<div style="font-size:14px;margin-top:6px;white-space:pre-wrap;word-break:break-word">' + esc(it.summary) + "</div>" : "") +
    (it.timing ? '<div class="sub">公開時期の候補：' + esc(it.timing) + "</div>" : "") +
    (it.memo ? '<div class="memo">メモ：' + esc(it.memo) + "</div>" : "") +
    (it.updatedAt ? '<div class="sub">更新：' + fmtIdeaDate(it.updatedAt) + (it.updatedBy ? "（" + esc(it.updatedBy) + "）" : "") + "</div>" : "") +
    "</div>";
}
function renderIdeaFilters() {
  const box = document.getElementById("ideasFilters");
  const items = ideasItemsCache || [];
  const keys = ["all"].concat(Object.keys(IDEA_CATEGORIES));
  box.innerHTML = keys.map(k => {
    const label = k === "all" ? "すべて" : IDEA_CATEGORIES[k].label;
    const n = k === "all" ? items.length : items.filter(it => it.category === k).length;
    return '<button type="button" class="chip' + (ideasFilter === k ? " on" : "") + '" data-ifilter="' + k + '">' + esc(label) + (n ? " " + n : "") + "</button>";
  }).join("");
  box.querySelectorAll("[data-ifilter]").forEach(b => b.addEventListener("click", () => {
    ideasFilter = b.getAttribute("data-ifilter");
    renderIdeas(ideasItemsCache, ideasNoticeText);
  }));
}
function renderIdeas(items, notice) {
  ideasNoticeText = notice || "";
  const nbox = document.getElementById("ideasNotice");
  nbox.textContent = ideasNoticeText;
  nbox.style.display = ideasNoticeText ? "" : "none";
  const box = document.getElementById("ideasList");
  if (!items) {
    document.getElementById("ideasFilters").innerHTML = "";
    box.innerHTML = "";
    return;
  }
  ideasItemsCache = items;
  renderIdeaFilters();
  if (!items.length) {
    box.innerHTML = '<p class="muted">ネタ倉庫はまだ空です。企画は友が倉庫側で登録します。</p>';
    return;
  }
  const filtered = sortIdeaItems(items).filter(it => ideasFilter === "all" || it.category === ideasFilter);
  box.innerHTML = filtered.length ? filtered.map(ideaItemHtml).join("") : '<p class="muted">この分類の企画はまだありません。</p>';
}
function readIdeasCache() {
  try {
    const s = JSON.parse(localStorage.getItem(IDEAS_CACHE_LS) || "null");
    return (s && s.data && Array.isArray(s.data.items)) ? s : null;
  } catch (e) { return null; }
}
async function loadIdeas() {
  const nbox = document.getElementById("ideasNotice");
  const box = document.getElementById("ideasList");
  const key = (localStorage.getItem(IDEAS_KEY_LS) || "").trim();
  if (!key) {
    ideasItemsCache = null;
    document.getElementById("ideasFilters").innerHTML = "";
    nbox.textContent = ""; nbox.style.display = "none";
    box.innerHTML = '<p class="muted">キーが未設定のため表示できません。設定タブで読み取りキーを入れてください。</p>';
    return;
  }
  nbox.textContent = "読み込み中…";
  nbox.style.display = "";
  try {
    const res = await fetch(IDEAS_API_URL, {
      headers: { "Authorization": "Bearer " + key, "Accept": "application/vnd.github.raw+json" },
      cache: "no-store"
    });
    if (res.status === 401 || res.status === 403) {
      const cached = readIdeasCache();
      if (cached) {
        renderIdeas(cached.data.items, "キーを確認してください（認証エラー " + res.status + "）。前回取得分を表示しています。");
      } else {
        ideasItemsCache = null;
        document.getElementById("ideasFilters").innerHTML = "";
        nbox.textContent = ""; nbox.style.display = "none";
        box.innerHTML = '<p class="muted">キーを確認してください。設定タブで読み取りキーを入れ直してください。</p>';
      }
      return;
    }
    if (!res.ok) throw new Error("http " + res.status);
    const data = await res.json();
    if (!data || !Array.isArray(data.items)) throw new Error("bad json");
    try { localStorage.setItem(IDEAS_CACHE_LS, JSON.stringify({ fetchedAt: new Date().toISOString(), data: data })); } catch (e) {}
    renderIdeas(data.items, "");
  } catch (err) {
    const cached = readIdeasCache();
    if (cached) {
      const when = cached.fetchedAt ? cached.fetchedAt.replace("T", " ").slice(0, 16) : "日時不明";
      renderIdeas(cached.data.items, "前回取得分を表示中（取得日時：" + when + "）");
    } else {
      ideasItemsCache = null;
      document.getElementById("ideasFilters").innerHTML = "";
      nbox.textContent = ""; nbox.style.display = "none";
      box.innerHTML = '<p class="muted">ネタ倉庫を取得できませんでした。通信できる場所で開き直してください。</p>';
    }
  }
}

/* ----- 追加・編集 ----- */
function openForm(id) {
  editingId = id;
  const e = id ? store.episodes.find(x => x.id === id) : null;
  document.getElementById("formTitle").textContent = e ? "話を直す" : "話を足す";
  document.getElementById("fEp").value = e ? e.ep : nextEpNo();
  document.getElementById("fTitle").value = e ? e.title : "";
  document.getElementById("fDate").value = e ? e.date : toYMD(new Date());
  document.getElementById("fTime").value = e ? (e.time || "19:00") : "19:00";
  document.getElementById("fStatus").value = e ? e.status : "making";
  document.getElementById("fStageDone").value = String(e ? stageDoneOf(e) : 0);
  document.getElementById("fStageDoing").value = String(e ? stageDoingOf(e) : -1);
  document.getElementById("fUrl").value = e ? (e.url || "") : "";
  document.getElementById("fMemo").value = e ? (e.memo || "") : "";
  document.getElementById("btnDelete").style.display = e ? "" : "none";
  show("scrForm");
}
function nextEpNo() {
  let mx = 0;
  for (const e of store.episodes) mx = Math.max(mx, Number(e.ep) || 0);
  return mx + 1;
}
function submitForm() {
  const ep = Number(document.getElementById("fEp").value);
  const title = document.getElementById("fTitle").value.trim();
  const date = document.getElementById("fDate").value;
  if (!ep || ep < 1) { alert("話数を入れてください"); return; }
  if (!title) { alert("タイトルを入れてください"); return; }
  if (!date) { alert("公開予定日を選んでください"); return; }
  const data = {
    ep: ep, title: title, date: date,
    time: document.getElementById("fTime").value || "",
    status: document.getElementById("fStatus").value,
    stageDone: Number(document.getElementById("fStageDone").value) || 0,
    stageDoing: Number(document.getElementById("fStageDoing").value),
    url: document.getElementById("fUrl").value.trim(),
    memo: document.getElementById("fMemo").value
  };
  if (editingId) {
    const e = store.episodes.find(x => x.id === editingId);
    if (e) Object.assign(e, data);
  } else {
    store.episodes.push(Object.assign({ id: uid() }, data));
  }
  saveStore(true);
  editingId = null;
  showTab(currentTab);
}
function deleteEditing() {
  if (!editingId) return;
  if (!confirm("この話を消しますか？")) return;
  store.episodes = store.episodes.filter(x => x.id !== editingId);
  saveStore(true);
  editingId = null;
  showTab(currentTab);
}

/* ----- 控えファイル（2段がけの外側） ----- */
function markBackupExported() {
  store.lastBackupExport = new Date().toISOString();
  saveStore(false);
}
function downloadBackupFile(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
/* 共有もダウンロードも使えないときの予備：中身のテキストを表示してコピーできるようにする */
function showExportTextFallback(text) {
  const old = document.getElementById("exportFallback");
  if (old) old.remove();
  const wrap = document.createElement("div");
  wrap.id = "exportFallback";
  wrap.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;";
  const box = document.createElement("div");
  box.style.cssText = "background:var(--hatch-widget-surface,#fff);color:var(--hatch-widget-text,#111);border-radius:12px;padding:16px;max-width:560px;width:100%;max-height:85vh;display:flex;flex-direction:column;gap:10px;";
  const title = document.createElement("div");
  title.textContent = "控えファイルの中身（コピー用）";
  title.style.cssText = "font-weight:700;font-size:16px;";
  const note = document.createElement("div");
  note.textContent = "保存がうまくいかないとき用です。下のテキストを全部コピーして、メモなどに貼って保管してください。";
  note.style.cssText = "font-size:13px;line-height:1.5;";
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.readOnly = true;
  ta.style.cssText = "width:100%;min-height:180px;flex:1;font-size:12px;box-sizing:border-box;";
  const row = document.createElement("div");
  row.style.cssText = "display:flex;gap:10px;";
  const btnCopy = document.createElement("button");
  btnCopy.type = "button";
  btnCopy.textContent = "全部コピーする";
  btnCopy.style.cssText = "flex:1;min-height:48px;font-size:15px;";
  btnCopy.addEventListener("click", () => {
    ta.focus(); ta.select();
    const done = () => { btnCopy.textContent = "コピーしました"; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => { document.execCommand("copy"); done(); });
    } else { document.execCommand("copy"); done(); }
  });
  const btnClose = document.createElement("button");
  btnClose.type = "button";
  btnClose.textContent = "閉じる";
  btnClose.style.cssText = "flex:1;min-height:48px;font-size:15px;";
  btnClose.addEventListener("click", () => wrap.remove());
  row.appendChild(btnCopy); row.appendChild(btnClose);
  box.appendChild(title); box.appendChild(note); box.appendChild(ta); box.appendChild(row);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
}
function exportBackup() {
  const payload = { app: "eastradio-schedule", version: 1, exportedAt: new Date().toISOString(), episodes: store.episodes };
  const text = JSON.stringify(payload, null, 2);
  const filename = "eastradio-schedule-backup-" + toYMD(new Date()).replace(/-/g, "") + ".json";
  const blob = new Blob([text], { type: "application/json" });
  // 1) 共有シート（iPhoneのホーム画面アプリでは「ファイルに保存」やチャット添付が選べる）
  let shareFile = null;
  try { shareFile = new File([blob], filename, { type: "application/json" }); } catch (e) { shareFile = null; }
  if (shareFile && navigator.canShare && navigator.share) {
    let can = false;
    try { can = navigator.canShare({ files: [shareFile] }); } catch (e) { can = false; }
    if (can) {
      navigator.share({ files: [shareFile] }).then(() => {
        markBackupExported();
      }).catch(err => {
        if (err && err.name === "AbortError") return; // 本人が共有をやめたときは何もしない
        try { downloadBackupFile(blob, filename); markBackupExported(); }
        catch (e2) { showExportTextFallback(text); }
      });
      return;
    }
  }
  // 2) 従来のダウンロード方式
  try { downloadBackupFile(blob, filename); markBackupExported(); return; }
  catch (e) { /* 次の予備へ */ }
  // 3) 予備：テキスト表示
  showExportTextFallback(text);
}
function normalizeEpisode(e) {
  const status = STATUS[e.status] ? e.status : "making";
  let stageDone = Number(e.stageDone), stageDoing = Number(e.stageDoing);
  if (!Number.isFinite(stageDone)) {
    // 進行段階を持たない古い控えファイルは、状態から無理のない初期値を付ける
    stageDone = status === "published" ? 5 : status === "unlisted" ? 3 : status === "assembled" ? 3 : 2;
    stageDoing = status === "published" ? -1 : status === "unlisted" ? 3 : status === "assembled" ? -1 : 2;
  }
  if (!Number.isFinite(stageDoing)) stageDoing = -1;
  return {
    id: e.id || uid(), ep: Number(e.ep) || 0, title: String(e.title), date: String(e.date),
    time: String(e.time || ""), status: status,
    stageDone: Math.min(5, Math.max(0, stageDone)), stageDoing: stageDoing,
    url: String(e.url || ""), memo: String(e.memo || "")
  };
}
function importBackupFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(String(reader.result));
      if (!d || !Array.isArray(d.episodes)) { alert("控えファイルの形が違います"); return; }
      if (!confirm("控えファイルから戻しますか？今の予定は控え（自動保存）に残ります。")) return;
      saveStore(true); // 戻す前に現状を自動控えへ
      store.episodes = d.episodes.filter(e => e && e.title && e.date).map(normalizeEpisode);
      saveStore(false);
      alert("控えファイルから戻しました");
      showTab("scrList");
    } catch (err) { alert("控えファイルを読めませんでした"); }
  };
  reader.readAsText(file);
}

/* ----- 設定 ----- */
function renderIdeasKeySettings() {
  const saved = localStorage.getItem(IDEAS_KEY_LS) || "";
  const input = document.getElementById("ideasKey");
  if (input) input.value = saved;
  const st = document.getElementById("ideasKeyState");
  if (st) st.textContent = saved ? "キーは設定済みです。ネタ倉庫タブで表示できます。" : "キーは未設定です。";
}
function renderSettings() {
  renderIdeasKeySettings();
  const counts = {};
  for (const e of store.episodes) counts[e.status] = (counts[e.status] || 0) + 1;
  document.getElementById("dataCounts").textContent =
    "登録 " + store.episodes.length + " 件（" +
    Object.keys(STATUS).map(k => STATUS[k].label + " " + (counts[k] || 0)).join("／") +
    "）／自動控え " + store.snapshots.length + "世代" +
    (store.lastBackupExport ? "／控えファイルを出した日 " + store.lastBackupExport.slice(0, 10) : "");
  const box = document.getElementById("snapshotList");
  if (!store.snapshots.length) { box.innerHTML = '<p class="muted">自動控えはまだありません。</p>'; return; }
  box.innerHTML = store.snapshots.map((s, i) => {
    let n = "?";
    try { n = JSON.parse(s.data).episodes.length; } catch (e) {}
    return '<div class="snap">' + esc(s.ts.replace("T", " ").slice(0, 16)) + "　" + n + ' 件 <button type="button" class="mini" data-restore="' + i + '">この時点に戻す</button></div>';
  }).join("");
  box.querySelectorAll("[data-restore]").forEach(b => b.addEventListener("click", () => {
    if (!confirm("この時点の控えに戻しますか？今の状態も自動控えに残ります。")) return;
    const d = JSON.parse(store.snapshots[Number(b.getAttribute("data-restore"))].data);
    saveStore(true); // 戻す前に現状も控える
    store.episodes = (d.episodes || []).map(normalizeEpisode);
    saveStore(false);
    renderSettings();
    alert("戻しました");
  }));
}

/* ----- 起動 ----- */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("tabList").addEventListener("click", () => showTab("scrList"));
  document.getElementById("tabProd").addEventListener("click", () => showTab("scrProd"));
  document.getElementById("tabProgress").addEventListener("click", () => showTab("scrProgress"));
  document.getElementById("tabIdeas").addEventListener("click", () => showTab("scrIdeas"));
  document.getElementById("tabSettings").addEventListener("click", () => showTab("scrSettings"));
  document.getElementById("btnIdeasKeySave").addEventListener("click", () => {
    const v = document.getElementById("ideasKey").value.trim();
    if (v) localStorage.setItem(IDEAS_KEY_LS, v); else localStorage.removeItem(IDEAS_KEY_LS);
    renderIdeasKeySettings();
    alert(v ? "キーを保存しました" : "キーを消しました");
  });
  document.getElementById("btnIdeasKeyClear").addEventListener("click", () => {
    if (!confirm("読み取りキーを消しますか？ネタ倉庫が見られなくなります。")) return;
    localStorage.removeItem(IDEAS_KEY_LS);
    renderIdeasKeySettings();
  });
  document.getElementById("btnAdd").addEventListener("click", () => openForm(null));
  document.getElementById("btnFormCancel").addEventListener("click", () => { editingId = null; showTab(currentTab); });
  document.getElementById("btnFormSave").addEventListener("click", submitForm);
  document.getElementById("btnDelete").addEventListener("click", deleteEditing);
  document.querySelectorAll(".btn-update").forEach(b => b.addEventListener("click", forceUpdate));
  document.getElementById("btnExport").addEventListener("click", exportBackup);
  document.getElementById("backupFile").addEventListener("change", ev => { if (ev.target.files[0]) importBackupFile(ev.target.files[0]); ev.target.value = ""; });
  showTab("scrList");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
