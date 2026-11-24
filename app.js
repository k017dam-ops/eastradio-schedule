"use strict";
/* イーストラジオ045 公開スケジュール
   個人サイボウズ2と同じ方式: データはこの端末の localStorage だけに保存する。
   サーバー（GitHub Pages）には空のアプリ枠だけがあり、予定データは一切送られない。
   画面は下タブ3つ: スケジュール / 進行状況 / 設定。 */
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
  document.getElementById("tabProgress").classList.toggle("on", id === "scrProgress");
  document.getElementById("tabSettings").classList.toggle("on", id === "scrSettings");
  if (id === "scrList") renderList();
  if (id === "scrProgress") renderProgress();
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
function exportBackup() {
  const payload = { app: "eastradio-schedule", version: 1, exportedAt: new Date().toISOString(), episodes: store.episodes };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "eastradio-schedule-backup-" + toYMD(new Date()).replace(/-/g, "") + ".json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  store.lastBackupExport = new Date().toISOString();
  saveStore(false);
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
function renderSettings() {
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
  document.getElementById("tabProgress").addEventListener("click", () => showTab("scrProgress"));
  document.getElementById("tabSettings").addEventListener("click", () => showTab("scrSettings"));
  document.getElementById("btnAdd").addEventListener("click", () => openForm(null));
  document.getElementById("btnFormCancel").addEventListener("click", () => { editingId = null; showTab(currentTab); });
  document.getElementById("btnFormSave").addEventListener("click", submitForm);
  document.getElementById("btnDelete").addEventListener("click", deleteEditing);
  document.getElementById("btnUpdate").addEventListener("click", forceUpdate);
  document.getElementById("btnExport").addEventListener("click", exportBackup);
  document.getElementById("backupFile").addEventListener("change", ev => { if (ev.target.files[0]) importBackupFile(ev.target.files[0]); ev.target.value = ""; });
  showTab("scrList");
  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
