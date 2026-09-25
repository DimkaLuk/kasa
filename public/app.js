// ===== Стан =====
let db = { people: [], tx: [], collections: [], reports: [], wallets: [], settings: { title: "Каса", monthlyFee: 0, openingBalance: 0, categories: [] } };
let pass = localGet("kasa-pass") || "";
let txLimit = 100;
let curWallet = localGet("kasa-wallet") || ""; // "" — основна каса
let peopleLimit = 200;

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => (Math.round(n * 100) / 100).toLocaleString("uk-UA", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₴";
const today = () => new Date().toLocaleDateString("sv-SE");
const monthKey = (d) => d.slice(0, 7);
const curMonth = () => today().slice(0, 7);
const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const MONTHS_FULL = ["Січень", "Лютий", "Березень", "Квітень", "Травень", "Червень", "Липень", "Серпень", "Вересень", "Жовтень", "Листопад", "Грудень"];
const fmtDate = (d) => { const [y, m, dd] = d.split("-"); return `${dd}.${m}.${y}`; };
const monthLabel = (k) => MONTHS[+k.slice(5) - 1] + " " + k.slice(2, 4);
const personById = (id) => db.people.find((p) => p.id === id);
const collById = (id) => db.collections.find((c) => c.id === id);
const moneyT = (n) => money(n).replace(" ₴", " грн");
const KIND = { salary: "ЗП", bonus: "Премія", other: "Інше" };
const byName = (a, b) => a.name.localeCompare(b.name, "uk");
// ----- Гаманці -----
const W = (t) => t.walletId || "";
const walletById = (id) => db.wallets.find((w) => w.id === id);
const walletName = (id) => (id ? walletById(id)?.name || "гаманець" : db.settings.title || "Каса");
const wtx = (id = curWallet) => db.tx.filter((t) => W(t) === id);
const walletOpening = (id = curWallet) => (id ? walletById(id)?.openingBalance || 0 : db.settings.openingBalance || 0);
const walletBalance = (id) => { const s = totals(wtx(id)); return walletOpening(id) + s.bal; };
const isMain = () => !curWallet;

function localGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function localSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }

function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove("show"), 2200);
}

// ===== API =====
async function api(path, method = "GET", body) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "content-type": "application/json", "x-app-password": pass },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (r.status === 401) { logout(); throw new Error(data.error || "Невірний пароль"); }
  if (!r.ok) throw new Error(data.error || "Помилка сервера (" + r.status + ")");
  return data;
}
async function save(path, method, body) {
  db = await api(path, method, body);
  render();
}

// ===== Вхід =====
$("#loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  pass = $("#loginPass").value;
  $("#loginErr").textContent = "";
  try { await start(); } catch (err) { $("#loginErr").textContent = err.message; }
});
$("#logoutBtn").addEventListener("click", logout);
function logout() {
  pass = ""; localSet("kasa-pass", null);
  $("#app").classList.add("hidden"); $("#login").classList.remove("hidden");
  $("#loginPass").value = "";
}
async function start() {
  db = await api("db");
  localSet("kasa-pass", pass);
  $("#login").classList.add("hidden"); $("#app").classList.remove("hidden");
  render();
}

// ===== Вкладки =====
$("#tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]"); if (!b) return;
  showTab(b.dataset.tab);
});
function showTab(tab) {
  $$("#tabs button").forEach((x) => x.classList.toggle("active", x.dataset.tab === tab));
  $$("main section").forEach((s) => s.classList.toggle("hidden", s.dataset.view !== tab));
  localSet("kasa-tab", tab);
  window.scrollTo(0, 0);
}

// ===== Розрахунки =====
function totals(list) {
  let inc = 0, exp = 0;
  for (const t of list) t.type === "income" ? (inc += t.amount) : (exp += t.amount);
  return { inc, exp, bal: inc - exp };
}
function sortedTx(list = wtx()) {
  return [...list].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
}
function paidByPersonMonth(personId, month) {
  return db.tx.filter((t) => t.type === "income" && t.personId === personId && monthKey(t.date) === month).reduce((s, t) => s + t.amount, 0);
}
function personStats() {
  const m = curMonth(), map = {};
  for (const p of db.people) map[p.id] = { total: 0, month: 0, last: "" };
  for (const t of db.tx) {
    if (t.type !== "income" || !map[t.personId]) continue;
    const s = map[t.personId];
    s.total += t.amount;
    if (monthKey(t.date) === m) s.month += t.amount;
    if (t.date > s.last) s.last = t.date;
  }
  return map;
}
// ----- Збори -----
function collPaidMap(c) {
  const map = {};
  for (const t of db.tx) if (t.type === "income" && t.collectionId === c.id && t.personId) map[t.personId] = (map[t.personId] || 0) + t.amount;
  return map;
}
function collStatus(c) {
  const paid = collPaidMap(c);
  const expected = new Set(c.personIds);
  const ok = (sum) => (c.amount > 0 ? sum >= c.amount - 0.001 : sum > 0);
  const rows = c.personIds.map((id) => ({ id, p: personById(id), sum: paid[id] || 0, inList: true }))
    .concat(Object.keys(paid).filter((id) => !expected.has(id)).map((id) => ({ id, p: personById(id), sum: paid[id], inList: false })))
    .filter((r) => r.p);
  rows.forEach((r) => { r.ok = ok(r.sum); r.debt = c.amount > 0 ? Math.max(0, c.amount - r.sum) : 0; });
  rows.sort((a, b) => byName(a.p, b.p));
  const listed = rows.filter((r) => r.inList);
  return {
    rows,
    total: listed.length,
    done: listed.filter((r) => r.ok).length,
    sum: rows.reduce((s, r) => s + r.sum, 0),
    debt: listed.reduce((s, r) => s + r.debt, 0),
  };
}
function sortedCollections() {
  return [...db.collections].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
}
function personDebts(pid) {
  return sortedCollections().filter((c) => !c.closed && c.personIds.includes(pid))
    .map((c) => ({ c, sum: collPaidMap(c)[pid] || 0 }))
    .filter(({ c, sum }) => (c.amount > 0 ? sum < c.amount - 0.001 : sum <= 0));
}
function collRow(c) {
  const st = collStatus(c);
  const pct = st.total ? (st.done / st.total) * 100 : 0;
  const sub = [fmtDate(c.date), KIND[c.kind], `внесли ${st.done} з ${st.total}`, c.amount ? `по ${money(c.amount)}` : "", st.debt ? `борг ${money(st.debt)}` : "", c.comment].filter(Boolean).join(" · ");
  return `<div class="row" data-coll="${c.id}">
    <div class="t">${esc(c.title)}${c.closed ? `<span class="badge">закрито</span>` : st.done === st.total ? `<span class="badge ok">усі внесли</span>` : `<span class="badge no">не внесли: ${st.total - st.done}</span>`}</div>
    <div class="a pos">${money(st.sum)}</div>
    <div class="s">${esc(sub)}</div><div></div>
    <div class="progress"><div style="width:${pct}%"></div></div>
  </div>`;
}

// ----- Звіти -----
const wReports = (id = curWallet) => db.reports.filter((r) => (r.walletId || "") === id);
const lastReport = (id = curWallet) => { const l = wReports(id); return l[l.length - 1]; };
const unreported = (upTo) => wtx().filter((t) => !t.reportId && (!upTo || t.date <= upTo));
function reportText(r, items) {
  const inc = items.filter((t) => t.type === "income");
  const exp = items.filter((t) => t.type === "expense").sort((a, b) => a.date.localeCompare(b.date));
  const lines = [];
  lines.push(`${walletName(r.walletId || "")} — звіт №${r.number} від ${fmtDate(r.date)}`);
  lines.push(r.prevDate ? `З моменту останнього звіту (${fmtDate(r.prevDate)}) на банці було ${moneyT(r.opening)}` : `На початок обліку на банці було ${moneyT(r.opening)}`);
  lines.push(`Прихід ${moneyT(r.income)}`);
  // Розбивка приходу за зборами; погашення боргів за минулі збори позначаємо окремо
  const groups = new Map();
  for (const t of inc) {
    const c = collById(t.collectionId);
    const key = c ? c.id : t.transferId ? "tr:" + (t.peerWallet || "") : "";
    if (!groups.has(key)) groups.set(key, { c, sum: 0, n: new Set(), from: t.transferId ? walletName(t.peerWallet || "") : "" });
    const g = groups.get(key); g.sum += t.amount; g.n.add(t.personId || t.id);
  }
  if (groups.size > 1 || (groups.size === 1 && !groups.has(""))) {
    lines.push("з них:");
    for (const g of [...groups.values()].sort((a, b) => (a.c?.date || "9").localeCompare(b.c?.date || "9"))) {
      const debt = g.c && r.prevDate && g.c.date <= r.prevDate ? " (погашення боргу)" : "";
      lines.push(`• ${g.c ? g.c.title + debt : g.from ? "надходження з: " + g.from : "інші надходження"} — ${moneyT(g.sum)} (${g.n.size} ${g.c ? "уч." : "оп."})`);
    }
  }
  lines.push(`Витрати ${moneyT(r.expense)}${exp.length ? ", з них:" : ""}`);
  for (const t of exp) lines.push(`• ${moneyT(t.amount)} — ${[t.transferId ? "Переказ у " + walletName(t.peerWallet || "") : t.category, t.comment].filter(Boolean).join(": ")}`);
  lines.push(`Залишок станом на ${fmtDate(r.date)}: ${moneyT(r.closing)}`);
  if (r.comment) lines.push("", r.comment);
  return lines.join("\n");
}
function draftReport(date) {
  const prev = lastReport();
  const items = unreported(date);
  const r2 = (n) => Math.round(n * 100) / 100;
  const income = r2(items.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));
  const expense = r2(items.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const opening = prev ? prev.closing : walletOpening();
  return { r: { walletId: curWallet, number: (prev?.number || 0) + 1, date, prevDate: prev?.date || "", opening, income, expense, closing: r2(opening + income - expense) }, items };
}

function isPaid(st) {
  const fee = db.settings.monthlyFee;
  return fee > 0 ? st.month >= fee : st.month > 0;
}

// ===== Рендер =====
function render() {
  if (curWallet && !walletById(curWallet)) curWallet = "";
  document.title = walletName(curWallet);
  $("#appTitle").textContent = db.settings.title || "Каса";
  renderWalletSel();
  renderOverview(); renderTx(); renderCollections(); renderPeople(); renderReports(); renderSettings(); renderWallets();
}

function txRow(t) {
  const p = personById(t.personId);
  const title = t.transferId ? (t.type === "income" ? "← з: " : "→ у: ") + walletName(t.peerWallet || "")
    : t.type === "income" ? (p ? p.name : "Надходження") : t.category;
  const c = collById(t.collectionId);
  const sub = [fmtDate(t.date), c ? c.title : "", t.method === "card" ? "картка" : "готівка", t.comment].filter(Boolean).join(" · ");
  const sign = t.type === "income" ? "+" : "−";
  return `<div class="row${t.reportId ? " locked" : ""}" data-tx="${t.id}">
    <div class="t">${esc(title)}</div>
    <div class="a ${t.type === "income" ? "pos" : "neg"}">${sign}${money(t.amount)}</div>
    <div class="s">${esc(sub)}</div><div></div>
  </div>`;
}

function renderOverview() {
  const list = wtx();
  const all = totals(list);
  all.bal += walletOpening();
  const m = curMonth();
  const mt = totals(list.filter((t) => monthKey(t.date) === m));
  $("#sBalanceLbl").textContent = isMain() ? "Баланс каси" : "Баланс: " + walletName(curWallet);
  $$(".main-only").forEach((el) => el.classList.toggle("hidden", !isMain()));
  const ws = db.wallets.filter((w) => w.active || walletBalance(w.id));
  $("#walletsCard").classList.toggle("hidden", !isMain() || !ws.length);
  $("#walletsList").innerHTML = ws.map((w) => { const u = totals(wtx(w.id).filter((t) => !t.reportId));
    return `<div class="row" data-wallet="${w.id}"><div class="t">${esc(w.name)}</div><div class="a">${money(walletBalance(w.id))}</div>
      <div class="s">з останнього звіту: +${money(u.inc)} / −${money(u.exp)}${w.note ? " · " + esc(w.note) : ""}</div><div class="r2"><button class="btn ghost small" type="button" data-transfer-to="${w.id}">Поповнити</button></div></div>`; }).join("");
  $("#sBalance").textContent = money(all.bal);
  $("#sIncome").textContent = money(mt.inc);
  $("#sExpense").textContent = money(mt.exp);
  const stats = personStats();
  const active = db.people.filter((p) => p.active);
  $("#sPaid").textContent = `${active.filter((p) => isPaid(stats[p.id])).length} / ${active.length}`;
  const since = totals(unreported());
  $("#sSince").innerHTML = `<span class="pos">+${money(since.inc)}</span> <span class="neg">−${money(since.exp)}</span>`;
  const open = sortedCollections().filter((c) => !c.closed);
  $("#openCollectionsCard").classList.toggle("hidden", !open.length || !isMain());
  $$("[data-add=income]").forEach((b) => (b.textContent = isMain() ? "+ Внесок" : "+ Надходження"));
  $("#openCollections").innerHTML = open.slice(0, 6).map(collRow).join("");

  // Місяці (останні 6)
  const months = [];
  const d = new Date(); d.setDate(1);
  for (let i = 0; i < 6; i++) { months.unshift(d.toLocaleDateString("sv-SE").slice(0, 7)); d.setMonth(d.getMonth() - 1); }
  const byM = months.map((k) => ({ k, ...totals(list.filter((t) => monthKey(t.date) === k)) }));
  const max = Math.max(1, ...byM.map((x) => Math.max(x.inc, x.exp)));
  $("#monthChart").innerHTML =
    `<div class="legend"><span><i style="background:var(--pos)"></i>надходження</span><span><i style="background:var(--neg)"></i>витрати</span></div>` +
    byM.map((x) => `<div class="mrow"><div class="lbl">${monthLabel(x.k)}</div><div class="bars">
      <div class="bar-wrap"><div class="bar in" style="width:${(x.inc / max) * 80}%"></div>${x.inc ? money(x.inc) : ""}</div>
      <div class="bar-wrap"><div class="bar out" style="width:${(x.exp / max) * 80}%"></div>${x.exp ? money(x.exp) : ""}</div>
    </div></div>`).join("");

  // Категорії
  const cats = {};
  for (const t of list) if (t.type === "expense" && monthKey(t.date) === m) { const k = t.transferId ? "Переказ у " + walletName(t.peerWallet || "") : t.category; cats[k] = (cats[k] || 0) + t.amount; }
  const cl = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const cmax = cl.length ? cl[0][1] : 1;
  $("#catList").innerHTML = cl.length
    ? cl.map(([c, v]) => `<div class="cat"><span>${esc(c)}</span><b>${money(v)}</b><div class="track"><div class="fill" style="width:${(v / cmax) * 100}%"></div></div></div>`).join("")
    : `<p class="muted">Цього місяця витрат немає</p>`;

  const recent = sortedTx().slice(0, 8);
  $("#recentList").innerHTML = recent.length ? recent.map(txRow).join("") : `<div class="empty">Ще немає операцій. Додайте перший внесок.</div>`;
}

function filteredTx() {
  const q = $("#fSearch").value.trim().toLowerCase();
  const type = $("#fType").value, from = $("#fFrom").value, to = $("#fTo").value;
  return sortedTx().filter((t) => {
    if (type && t.type !== type) return false;
    if (from && t.date < from) return false;
    if (to && t.date > to) return false;
    if (q) {
      const p = personById(t.personId);
      const hay = [p?.name, t.comment, t.category, String(t.amount)].join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function renderTx() {
  const list = filteredTx();
  const s = totals(list);
  $("#txSummary").innerHTML = `<span>Операцій: <b>${list.length}</b></span><span>Надійшло: <b class="pos">${money(s.inc)}</b></span><span>Витрачено: <b class="neg">${money(s.exp)}</b></span><span>Різниця: <b>${money(s.bal)}</b></span>`;
  const shown = list.slice(0, txLimit);
  $("#txList").innerHTML = list.length
    ? shown.map(txRow).join("") + (list.length > txLimit ? `<button class="btn more" id="moreTx">Показати ще (${list.length - txLimit})</button>` : "")
    : `<div class="empty">Нічого не знайдено</div>`;
}
["#fSearch", "#fType", "#fFrom", "#fTo"].forEach((s) => $(s).addEventListener("input", () => { txLimit = 100; $("#fPeriod").value = ""; renderTx(); }));
$("#fPeriod").addEventListener("change", (e) => {
  const v = e.target.value, d = new Date(), y = d.getFullYear(), mo = d.getMonth();
  const iso = (dt) => dt.toLocaleDateString("sv-SE");
  let from = "", to = "";
  if (v === "month") { from = iso(new Date(y, mo, 1)); to = iso(new Date(y, mo + 1, 0)); }
  if (v === "prev") { from = iso(new Date(y, mo - 1, 1)); to = iso(new Date(y, mo, 0)); }
  if (v === "year") { from = `${y}-01-01`; to = `${y}-12-31`; }
  $("#fFrom").value = from; $("#fTo").value = to; txLimit = 100; renderTx();
});
$("#txList").addEventListener("click", (e) => { if (e.target.id === "moreTx") { txLimit += 200; renderTx(); } });

function filteredPeople(stats) {
  const q = $("#pSearch").value.trim().toLowerCase(), f = $("#pFilter").value;
  return db.people
    .filter((p) => {
      if (f === "active" && !p.active) return false;
      if (f === "inactive" && p.active) return false;
      if (f === "unpaid" && (!p.active || isPaid(stats[p.id]))) return false;
      if (q && !(p.name + " " + p.phone + " " + p.note).toLowerCase().includes(q)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name, "uk"));
}
function renderPeople() {
  const stats = personStats();
  const list = filteredPeople(stats);
  const fee = db.settings.monthlyFee;
  const total = list.reduce((s, p) => s + stats[p.id].total, 0);
  $("#pSummary").innerHTML = `<span>Показано: <b>${list.length}</b></span><span>Усього внесли: <b>${money(total)}</b></span>` +
    (fee ? `<span>Внесок: <b>${money(fee)}</b>/міс</span>` : "");
  const shown = list.slice(0, peopleLimit);
  $("#peopleList").innerHTML = list.length
    ? shown.map((p) => {
        const s = stats[p.id], paid = isPaid(s);
        const badge = !p.active ? `<span class="badge">неактивний</span>` : paid ? `<span class="badge ok">оплачено</span>` : `<span class="badge no">не оплачено</span>`;
        const sub = [p.phone, s.last ? "остання оплата " + fmtDate(s.last) : "оплат не було", p.note].filter(Boolean).join(" · ");
        return `<div class="row" data-person="${p.id}">
          <div class="t">${esc(p.name)}${badge}</div>
          <div class="a">${money(s.total)}</div>
          <div class="s">${esc(sub)}</div>
          <div class="r2">${s.month ? "цей міс. " + money(s.month) : ""}</div>
        </div>`;
      }).join("") + (list.length > peopleLimit ? `<button class="btn more" id="morePeople">Показати ще (${list.length - peopleLimit})</button>` : "")
    : `<div class="empty">${db.people.length ? "Нікого не знайдено" : "Додайте учасників — по одному або списком"}</div>`;
}
["#pSearch", "#pFilter"].forEach((s) => $(s).addEventListener("input", renderPeople));
$("#peopleList").addEventListener("click", (e) => {
  if (e.target.id === "morePeople") { peopleLimit += 200; renderPeople(); return; }
  const r = e.target.closest("[data-person]"); if (r) personModal(personById(r.dataset.person));
});

function renderSettings() {
  const f = $("#settingsForm");
  if (f.contains(document.activeElement)) return;
  f.title.value = db.settings.title;
  f.monthlyFee.value = db.settings.monthlyFee || 0;
  f.openingBalance.value = db.settings.openingBalance || 0;
  f.openingBalance.disabled = db.reports.length > 0;
  f.categories.value = db.settings.categories.join("\n");
}
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = $("button[type=submit]", f);
  btn.disabled = true;
  try {
    await save("settings", "PUT", { title: f.title.value, monthlyFee: f.monthlyFee.value, openingBalance: f.openingBalance.value, categories: f.categories.value.split("\n") });
    toast("Збережено");
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

// ===== Модальне вікно =====
const modal = $("#modal");
let modalSubmit = null, modalDelete = null;
function openModal({ title, body, okText = "Зберегти", onSubmit, onDelete, wide = false }) {
  modal.classList.toggle("wide", wide);
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = body;
  $("#modalErr").textContent = "";
  $("#modalOk").textContent = okText;
  $("#modalOk").classList.toggle("hidden", !onSubmit);
  $("#modalDelete").classList.toggle("hidden", !onDelete);
  modalSubmit = onSubmit; modalDelete = onDelete;
  modal.showModal();
  const first = $("#modalBody input:not([type=radio]):not([type=hidden]), #modalBody select, #modalBody textarea");
  if (first && matchMedia("(pointer:fine)").matches) first.focus();
}
$("#modalCancel").addEventListener("click", () => modal.close());
$("#modalForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!modalSubmit) return modal.close();
  const btn = $("#modalOk"); btn.disabled = true;
  try { const after = await modalSubmit(new FormData(e.target)); modal.close(); if (typeof after === "function") after(); }
  catch (err) { $("#modalErr").textContent = err.message; }
  btn.disabled = false;
});
$("#modalDelete").addEventListener("click", async () => {
  if (!modalDelete) return;
  const btn = $("#modalDelete");
  if (btn.dataset.confirm !== "1") { btn.dataset.confirm = "1"; btn.textContent = "Точно видалити?"; return; }
  btn.disabled = true;
  try { await modalDelete(); modal.close(); } catch (err) { $("#modalErr").textContent = err.message; }
  btn.disabled = false;
});
modal.addEventListener("close", () => { const b = $("#modalDelete"); b.dataset.confirm = ""; b.textContent = "Видалити"; });

// ----- Операція -----
function personOptions(selected) {
  const active = db.people.filter((p) => p.active || p.id === selected).sort((a, b) => a.name.localeCompare(b.name, "uk"));
  return `<option value="">— без учасника —</option>` + active.map((p) => `<option value="${p.id}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}</option>`).join("");
}
function collOptions(personId, selected) {
  const list = sortedCollections().filter((c) => c.id === selected || (!c.closed && (!personId || c.personIds.includes(personId))));
  return `<option value="">— без збору —</option>` + list.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.title)}</option>`).join("");
}
function txModal(t, presetType, presetPerson, presetColl) {
  if (t?.transferId) return transferModal(t);
  const type = t?.type || presetType || "income";
  const inMain = t ? !W(t) : isMain();
  const locked = !!t?.reportId;
  const cats = db.settings.categories.includes(t?.category) || !t?.category ? db.settings.categories : [...db.settings.categories, t.category];
  openModal({
    title: t ? "Редагувати операцію" : type === "income" ? (inMain ? "Новий внесок" : "Нове надходження") : "Нова витрата",
    body: `
      <div class="seg">
        <label><input type="radio" name="type" value="income" ${type === "income" ? "checked" : ""}><span>Надходження</span></label>
        <label><input type="radio" name="type" value="expense" ${type === "expense" ? "checked" : ""}><span>Витрата</span></label>
      </div>
      <div class="two">
        <label>Сума, ₴<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${t?.amount ?? (type === "income" && db.settings.monthlyFee ? db.settings.monthlyFee : "")}"></label>
        <label>Дата<input name="date" type="date" required value="${t?.date || today()}"></label>
      </div>
      ${inMain ? "" : `<p class="muted small-text">Гаманець: <b>${esc(walletName(t ? W(t) : curWallet))}</b>. Поповнення з каси робіть через «Переказ».</p>`}
      <label class="f-income main-field">Від кого<select name="personId">${personOptions(t?.personId || presetPerson)}</select></label>
      <label class="f-income main-field">За збір <small class="muted">(для погашення боргу виберіть минулий збір)</small><select name="collectionId"></select></label>
      <label class="f-expense">Категорія<select name="category">${cats.map((c) => `<option ${c === t?.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label>Спосіб<select name="method"><option value="cash">Готівка</option><option value="card" ${t?.method === "card" ? "selected" : ""}>Картка / переказ</option></select></label>
      <label>Коментар<input name="comment" maxlength="300" value="${esc(t?.comment || "")}"></label>`,
    onSubmit: locked ? null : async (fd) => {
      const body = Object.fromEntries(fd);
      if (!t) body.walletId = curWallet;
      await save(t ? "tx/" + t.id : "tx", t ? "PUT" : "POST", body);
      toast(t ? "Змінено" : "Додано");
    },
    onDelete: t && !locked ? async () => { await save("tx/" + t.id, "DELETE"); toast("Видалено"); } : null,
  });
  if (locked) {
    const r = db.reports.find((x) => x.id === t.reportId);
    $("#modalTitle").textContent = "Операція у звіті" + (r ? ` №${r.number}` : "");
    $$("#modalBody input, #modalBody select").forEach((el) => (el.disabled = true));
    $("#modalBody").insertAdjacentHTML("beforeend", `<p class="muted small-text">Операція вже увійшла у звіт і заблокована. Щоб змінити її, видаліть цей звіт (лише якщо він останній).</p>`);
  }
  const pSel = $("#modalBody select[name=personId]"), cSel = $("#modalBody select[name=collectionId]");
  const fillColl = (sel) => { cSel.innerHTML = collOptions(pSel.value, sel); };
  fillColl(t?.collectionId || presetColl || "");
  if (!t && !presetColl && pSel.value) {
    // Підказка: найстаріший відкритий збір, де учасник ще винен
    const d = personDebts(pSel.value);
    if (d.length) cSel.value = d[d.length - 1].c.id;
  }
  pSel.addEventListener("change", () => fillColl(cSel.value));
  const sync = () => {
    const v = $("#modalBody input[name=type]:checked").value;
    $$("#modalBody .f-income").forEach((el) => el.classList.toggle("hidden", v !== "income" || (!inMain && el.classList.contains("main-field"))));
    $$("#modalBody .f-expense").forEach((el) => el.classList.toggle("hidden", v !== "expense"));
    if (!t) $("#modalTitle").textContent = v === "income" ? (inMain ? "Новий внесок" : "Нове надходження") : "Нова витрата";
  };
  $$("#modalBody input[name=type]").forEach((r) => r.addEventListener("change", sync));
  sync();
}
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]"); if (add) return txModal(null, add.dataset.add);
  if (e.target.closest("[data-group]")) return groupModal();
  const tr = e.target.closest("[data-transfer], [data-transfer-to]");
  if (tr) return transferModal(null, tr.dataset.transferTo);
  const wrow = e.target.closest("[data-wallet]");
  if (wrow && !wrow.closest("dialog")) return switchWallet(wrow.dataset.wallet);
  const coll = e.target.closest("[data-coll]");
  if (coll && !coll.closest("dialog")) return collectionModal(collById(coll.dataset.coll));
  const rep = e.target.closest("[data-report]");
  if (rep) return reportModal(db.reports.find((r) => r.id === rep.dataset.report));
  const row = e.target.closest("[data-tx]");
  if (row && !row.closest("dialog")) { const t = db.tx.find((x) => x.id === row.dataset.tx); if (t) txModal(t); }
});

// ----- Учасник -----
function personModal(p) {
  let history = "";
  if (p) {
    const txs = sortedTx(db.tx).filter((t) => t.personId === p.id);
    const y = new Date().getFullYear();
    const grid = Array.from({ length: 12 }, (_, i) => {
      const k = `${y}-${String(i + 1).padStart(2, "0")}`;
      const sum = paidByPersonMonth(p.id, k);
      const ok = db.settings.monthlyFee ? sum >= db.settings.monthlyFee : sum > 0;
      return `<div class="${ok ? "ok" : ""}" title="${MONTHS_FULL[i]}: ${money(sum)}">${MONTHS[i]}</div>`;
    }).join("");
    const debts = personDebts(p.id);
    history = `
      ${debts.length ? `<label>Не внесено за зборами (${debts.length})</label><div class="person-tx">${debts.map(({ c, sum }) => `<div class="row"><div class="t">${esc(c.title)}</div><div class="a neg">${c.amount ? money(c.amount - sum) : "—"}</div><div class="s">${fmtDate(c.date)}${sum ? " · внесено " + money(sum) : ""}</div><div></div></div>`).join("")}</div>` : ""}
      <label>Оплати за ${y} рік</label><div class="months">${grid}</div>
      <label>Історія внесків (${txs.length}) · разом ${money(txs.reduce((s, t) => s + t.amount, 0))}</label>
      <div class="person-tx">${txs.length ? txs.map((t) => `<div class="row"><div class="t">${fmtDate(t.date)}</div><div class="a pos">+${money(t.amount)}</div><div class="s">${esc(t.comment || (t.method === "card" ? "картка" : "готівка"))}</div><div></div></div>`).join("") : `<div class="empty">Внесків ще немає</div>`}</div>
      <button type="button" class="btn primary" id="payForPerson">+ Внесок від ${esc(p.name)}</button>`;
  }
  openModal({
    title: p ? p.name : "Новий учасник",
    body: `
      <label>Ім'я та прізвище<input name="name" required maxlength="120" value="${esc(p?.name || "")}"></label>
      <div class="two">
        <label>Телефон<input name="phone" type="tel" maxlength="40" value="${esc(p?.phone || "")}"></label>
        <label>Примітка<input name="note" maxlength="300" value="${esc(p?.note || "")}"></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${!p || p.active ? "checked" : ""}> Активний учасник</label>
      ${history}`,
    onSubmit: async (fd) => {
      const body = { name: fd.get("name"), phone: fd.get("phone"), note: fd.get("note"), active: fd.get("active") === "on" };
      await save(p ? "people/" + p.id : "people", p ? "PUT" : "POST", body);
      toast(p ? "Збережено" : "Учасника додано");
    },
    onDelete: p ? async () => { await save("people/" + p.id, "DELETE"); toast("Видалено"); } : null,
  });
  $("#payForPerson")?.addEventListener("click", () => { modal.close(); txModal(null, "income", p.id); });
}
$("#addPerson").addEventListener("click", () => personModal(null));
$("#bulkPeople").addEventListener("click", () => {
  openModal({
    title: "Додати списком",
    okText: "Додати",
    body: `<label>Кожен учасник з нового рядка. Можна через кому додати телефон:<br><span class="muted">Іваненко Петро, 0671234567</span>
      <textarea name="list" rows="10" required></textarea></label>`,
    onSubmit: async (fd) => {
      const rows = String(fd.get("list")).split("\n").map((l) => l.trim()).filter(Boolean);
      const bulk = rows.map((line) => { const [name, phone = ""] = line.split(/[,;\t]/).map((x) => x.trim()); return { name, phone }; }).filter((x) => x.name);
      const before = db.people.length;
      await save("people", "POST", { bulk });
      const added = db.people.length - before, skipped = rows.length - added;
      toast(`Додано: ${added}` + (skipped ? `, пропущено: ${skipped}` : ""));
    },
  });
});

// ===== Збори =====
function renderCollections() {
  const f = $("#cFilter").value;
  const list = sortedCollections().filter((c) => {
    if (f === "open") return !c.closed;
    if (f === "closed") return c.closed;
    if (f === "debt") { const st = collStatus(c); return st.done < st.total; }
    return true;
  });
  $("#collectionsList").innerHTML = list.length
    ? list.map(collRow).join("")
    : `<div class="empty">${db.collections.length ? "Нічого не знайдено" : "Створіть перший збір: «Внесок за ЗП від …» зі списком учасників"}</div>`;
}
$("#cFilter").addEventListener("input", renderCollections);
$("#addCollection").addEventListener("click", () => collectionEditModal(null));

// Перегляд збору: хто вніс / хто ні
function collectionModal(c) {
  if (!c) return;
  let filter = "unpaid";
  openModal({
    title: c.title,
    wide: true,
    body: `
      <div class="summary" id="cmSummary"></div>
      <div class="seg three">
        <label><input type="radio" name="cmf" value="unpaid" checked><span>Не внесли</span></label>
        <label><input type="radio" name="cmf" value="paid"><span>Внесли</span></label>
        <label><input type="radio" name="cmf" value="all"><span>Усі</span></label>
      </div>
      <div class="plist" id="cmList"></div>
      <div class="tools">
        <button type="button" class="btn primary" id="cmGroup">+ Внести групою</button>
        <button type="button" class="btn ghost" id="cmCopy">Копіювати список боржників</button>
        <button type="button" class="btn ghost" id="cmEdit">Редагувати збір</button>
      </div>`,
  });
  const draw = () => {
    const st = collStatus(c);
    $("#cmSummary").innerHTML = `<span>${fmtDate(c.date)} · ${KIND[c.kind]}</span><span>Внесли: <b>${st.done} з ${st.total}</b></span><span>Зібрано: <b class="pos">${money(st.sum)}</b></span>` +
      (c.amount ? `<span>По: <b>${money(c.amount)}</b></span><span>Борг: <b class="neg">${money(st.debt)}</b></span>` : "") + (c.closed ? `<span class="badge">закрито</span>` : "");
    const rows = st.rows.filter((r) => filter === "all" || (filter === "paid" ? r.sum > 0 : !r.ok && r.inList));
    $("#cmList").innerHTML = rows.length ? rows.map((r) => `<div class="status-row">
        <div><b>${esc(r.p.name)}</b>${!r.inList ? `<span class="badge">поза списком</span>` : r.ok ? `<span class="badge ok">внесено</span>` : r.sum ? `<span class="badge no">частково</span>` : `<span class="badge no">не внесено</span>`}</div>
        <div class="${r.sum ? "pos" : "muted"}">${r.sum ? money(r.sum) : "—"}${r.debt ? ` <span class="neg">/ борг ${money(r.debt)}</span>` : ""}</div>
      </div>`).join("") : `<div class="empty">${filter === "unpaid" ? "Усі внесли 🎉" : "Нікого"}</div>`;
  };
  $$("#modalBody input[name=cmf]").forEach((r) => r.addEventListener("change", () => { filter = r.value; draw(); }));
  draw();
  $("#cmGroup").addEventListener("click", () => { modal.close(); groupModal(c.id); });
  $("#cmEdit").addEventListener("click", () => { modal.close(); collectionEditModal(c); });
  $("#cmCopy").addEventListener("click", async () => {
    const st = collStatus(c);
    const debtors = st.rows.filter((r) => r.inList && !r.ok);
    const text = `${c.title} — не внесли (${debtors.length}):\n` + debtors.map((r, i) => `${i + 1}. ${r.p.name}${r.debt ? " — " + moneyT(r.debt) : ""}`).join("\n");
    try { await navigator.clipboard.writeText(text); toast("Скопійовано"); } catch { prompt("Скопіюйте текст:", text); }
  });
}

// Створення / редагування збору зі списком учасників
function collectionEditModal(c) {
  const picked = new Set(c?.personIds || []);
  const people = db.people.filter((p) => p.active || picked.has(p.id)).sort(byName);
  const kind = c?.kind || "salary";
  openModal({
    title: c ? "Редагувати збір" : "Новий збір",
    okText: c ? "Зберегти" : "Створити",
    wide: true,
    body: `
      <div class="two">
        <label>Тип<select name="kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}" ${k === kind ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>Дата<input name="date" type="date" required value="${c?.date || today()}"></label>
      </div>
      <label>Назва <small class="muted">(порожньо — сформується автоматично)</small><input name="title" maxlength="120" value="${esc(c?.title || "")}" placeholder="Внесок за ЗП від …"></label>
      <div class="two">
        <label>Очікувана сума з кожного, ₴ <small class="muted">(0 — будь-яка)</small><input name="amount" type="number" min="0" step="0.01" value="${c?.amount || 0}"></label>
        <label>Коментар<input name="comment" maxlength="300" value="${esc(c?.comment || "")}"></label>
      </div>
      ${c ? `<label class="check"><input type="checkbox" name="closed" ${c.closed ? "checked" : ""}> Збір закрито (не показувати серед відкритих і в боргах)</label>` : ""}
      <label>Учасники, які мають внести: <b id="ceCount"></b></label>
      <div class="tools">
        <button type="button" class="btn ghost small" data-pick="all">Усі активні</button>
        <button type="button" class="btn ghost small" data-pick="none">Нікого</button>
        <button type="button" class="btn ghost small" data-pick="prev">Як у попередньому</button>
        <button type="button" class="btn ghost small" data-pick="paste">Вставити список імен</button>
      </div>
      <div id="cePaste" class="hidden form">
        <textarea id="cePasteText" rows="5" placeholder="Кожне ім'я з нового рядка"></textarea>
        <div class="tools"><button type="button" class="btn ghost small" id="cePasteApply">Позначити знайдених</button><span id="cePasteRes" class="muted small-text"></span></div>
      </div>
      <input type="search" id="ceSearch" placeholder="Пошук учасника">
      <div class="plist" id="ceList"></div>`,
    onSubmit: async (fd) => {
      const body = { kind: fd.get("kind"), date: fd.get("date"), title: fd.get("title"), amount: fd.get("amount"), comment: fd.get("comment"), closed: fd.get("closed") === "on", personIds: [...picked] };
      await save(c ? "collections/" + c.id : "collections", c ? "PUT" : "POST", body);
      toast(c ? "Збір збережено" : "Збір створено");
      if (!c) { const created = db.collections[db.collections.length - 1]; return () => { showTab("collections"); collectionModal(created); }; }
    },
    onDelete: c ? async () => { await save("collections/" + c.id, "DELETE"); toast("Збір видалено"); } : null,
  });
  const draw = () => {
    const q = $("#ceSearch").value.trim().toLowerCase();
    $("#ceList").innerHTML = people.filter((p) => !q || p.name.toLowerCase().includes(q))
      .map((p) => `<label class="prow pick"><input type="checkbox" data-pid="${p.id}" ${picked.has(p.id) ? "checked" : ""}><span class="nm">${esc(p.name)}</span></label>`).join("") || `<div class="empty">Нікого</div>`;
    $("#ceCount").textContent = picked.size;
  };
  $("#ceList").addEventListener("change", (e) => {
    const id = e.target.dataset.pid; if (!id) return;
    e.target.checked ? picked.add(id) : picked.delete(id);
    $("#ceCount").textContent = picked.size;
  });
  $("#ceSearch").addEventListener("input", draw);
  $("#modalBody .tools").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]"); if (!b) return;
    const v = b.dataset.pick;
    if (v === "all") db.people.filter((p) => p.active).forEach((p) => picked.add(p.id));
    if (v === "none") picked.clear();
    if (v === "prev") {
      const k = $("#modalBody select[name=kind]").value;
      const others = sortedCollections().filter((x) => x.id !== c?.id);
      const prev = others.find((x) => x.kind === k) || others[0];
      if (!prev) return toast("Попередніх зборів немає");
      picked.clear(); prev.personIds.forEach((id) => picked.add(id));
      toast("Скопійовано з: " + prev.title);
    }
    if (v === "paste") { $("#cePaste").classList.toggle("hidden"); return; }
    draw();
  });
  $("#cePasteApply").addEventListener("click", () => {
    const norm = (x) => x.toLowerCase().replace(/\s+/g, " ").trim();
    const idx = new Map(db.people.map((p) => [norm(p.name), p]));
    const lines = $("#cePasteText").value.split("\n").map((l) => l.split(/[,;\t]/)[0]).map(norm).filter(Boolean);
    const miss = [];
    for (const l of lines) { const p = idx.get(l); p ? picked.add(p.id) : miss.push(l); }
    $("#cePasteRes").textContent = `Знайдено: ${lines.length - miss.length}` + (miss.length ? `. Не знайдено: ${miss.join(", ")}` : "");
    draw();
  });
  draw();
}

// ===== Груповий внесок =====
function groupModal(presetColl = "") {
  const amounts = new Map();
  openModal({
    title: "Груповий внесок",
    okText: "Провести внески",
    wide: true,
    body: `
      <div class="two">
        <label>Дата внеску<input name="date" type="date" required value="${today()}"></label>
        <label>Спосіб<select name="method"><option value="cash">Готівка</option><option value="card">Картка / переказ</option></select></label>
      </div>
      <label>За збір <small class="muted">(минулий збір — погашення боргу; у звіт піде за датою внеску)</small><select name="collectionId" id="gColl">${collOptions("", presetColl)}</select></label>
      <label>Коментар до всіх внесків<input name="comment" maxlength="300"></label>
      <div class="two">
        <input type="search" id="gSearch" placeholder="Пошук учасника">
        <select id="gShow"><option value="todo">Лише ті, хто ще не вніс</option><option value="all">Усі у списку</option></select>
      </div>
      <div class="tools">
        <button type="button" class="btn ghost small" id="gFill">Заповнити очікувані суми</button>
        <button type="button" class="btn ghost small" id="gClear">Очистити суми</button>
      </div>
      <div class="plist" id="gList"></div>
      <div class="gtotal"><span id="gCount">0 учасників</span><span id="gSum">0 ₴</span></div>`,
    onSubmit: async (fd) => {
      const bulk = [...amounts].filter(([, v]) => Number(v) > 0).map(([personId, amount]) => ({ personId, amount }));
      if (!bulk.length) throw new Error("Вкажіть суму хоча б для одного учасника");
      await save("tx", "POST", { bulk, date: fd.get("date"), method: fd.get("method"), collectionId: fd.get("collectionId"), comment: fd.get("comment") });
      toast(`Проведено внесків: ${bulk.length}`);
    },
  });
  const coll = () => collById($("#gColl").value);
  const total = () => {
    let n = 0, sum = 0;
    for (const v of amounts.values()) { const x = Number(String(v).replace(",", ".")); if (x > 0) { n++; sum += x; } }
    $("#gCount").textContent = `${n} учасн.`; $("#gSum").textContent = money(sum);
  };
  const draw = () => {
    const c = coll(), q = $("#gSearch").value.trim().toLowerCase();
    $("#gShow").disabled = !c;
    let rows;
    if (c) {
      const st = collStatus(c);
      rows = st.rows.filter((r) => r.inList && ($("#gShow").value === "all" || !r.ok))
        .map((r) => ({ p: r.p, note: r.sum ? `внесено ${money(r.sum)}${r.debt ? ", борг " + money(r.debt) : ""}` : c.amount ? `борг ${money(r.debt)}` : "", debt: r.debt }));
    } else {
      rows = db.people.filter((p) => p.active).sort(byName).map((p) => ({ p, note: "", debt: 0 }));
    }
    rows = rows.filter((r) => !q || r.p.name.toLowerCase().includes(q));
    $("#gList").innerHTML = rows.map((r) => `<div class="prow"><span class="nm">${esc(r.p.name)}${r.note ? `<small>${esc(r.note)}</small>` : ""}</span>
      <input type="number" inputmode="decimal" step="0.01" min="0" placeholder="${r.debt ? r.debt : "0"}" data-pid="${r.p.id}" data-debt="${r.debt}" value="${esc(amounts.get(r.p.id) || "")}"></div>`).join("")
      || `<div class="empty">${c ? "Усі у цьому зборі вже внесли" : "Немає активних учасників"}</div>`;
    total();
  };
  $("#gList").addEventListener("input", (e) => { const id = e.target.dataset.pid; if (id) { amounts.set(id, e.target.value); total(); } });
  // Enter у полі суми — перехід до наступного учасника, а не відправка форми
  $("#gList").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.dataset.pid) return;
    e.preventDefault();
    const all = $$("#gList input"); const i = all.indexOf(e.target);
    (all[i + 1] || $("#modalOk")).focus();
  });
  $("#gColl").addEventListener("change", draw);
  $("#gSearch").addEventListener("input", draw);
  $("#gShow").addEventListener("change", draw);
  $("#gFill").addEventListener("click", () => {
    const c = coll(); if (!c?.amount) return toast("У збору не задано очікуваної суми");
    $$("#gList input").forEach((i) => { if (!i.value && +i.dataset.debt > 0) { i.value = i.dataset.debt; amounts.set(i.dataset.pid, i.value); } });
    total();
  });
  $("#gClear").addEventListener("click", () => { amounts.clear(); draw(); });
  draw();
}

// ===== Звіти =====
function renderReports() {
  const d = draftReport(today());
  const all = unreported();
  const later = all.length - d.items.length;
  $("#pendingReport").innerHTML = `<h2>Ще не у звітах${isMain() ? "" : ": " + esc(walletName(curWallet))}</h2>
    <div class="summary"><span>Операцій: <b>${all.length}</b></span><span>Було: <b>${money(d.r.opening)}</b></span><span>Прихід: <b class="pos">${money(d.r.income)}</b></span><span>Витрати: <b class="neg">${money(d.r.expense)}</b></span><span>Залишок: <b>${money(d.r.closing)}</b></span>${later ? `<span>+ ${later} з майбутньою датою</span>` : ""}</div>
    <div class="actions" style="margin-top:12px"><button class="btn primary" id="newReport" ${all.length ? "" : "disabled"}>Сформувати звіт</button></div>`;
  $("#newReport").addEventListener("click", newReportModal);
  const list = [...wReports()].reverse();
  $("#reportsList").innerHTML = list.length
    ? list.map((r) => `<div class="row" data-report="${r.id}">
        <div class="t">Звіт №${r.number} від ${fmtDate(r.date)}</div>
        <div class="a">${money(r.closing)}</div>
        <div class="s">${r.prevDate ? fmtDate(r.prevDate) + " → " : ""}було ${money(r.opening)} · прихід ${money(r.income)} · витрати ${money(r.expense)}${r.comment ? " · " + esc(r.comment) : ""}</div><div></div>
      </div>`).join("")
    : `<div class="empty">Журнал звітів порожній</div>`;
}
function newReportModal() {
  const prev = lastReport();
  openModal({
    title: "Новий звіт",
    okText: "Зафіксувати звіт",
    wide: true,
    body: `
      <div class="two">
        <label>Станом на дату <small class="muted">(включно)</small><input name="date" type="date" required value="${today()}" min="${prev?.date || ""}"></label>
        <label>Коментар<input name="comment" maxlength="500"></label>
      </div>
      <label>Попередній перегляд</label>
      <div class="report-text" id="nrPreview"></div>
      <p class="muted small-text">Після фіксації операції звіту блокуються від змін, а наступний звіт почнеться з цього залишку.</p>`,
    onSubmit: async (fd) => {
      await save("reports", "POST", { walletId: curWallet, date: fd.get("date"), comment: fd.get("comment") });
      toast("Звіт створено");
      return () => reportModal(lastReport());
    },
  });
  const upd = () => {
    const date = $("#modalBody input[name=date]").value || today();
    const d = draftReport(date);
    $("#nrPreview").textContent = d.items.length ? reportText({ ...d.r, comment: $("#modalBody input[name=comment]").value }, d.items) : "Немає нових операцій до цієї дати";
  };
  $$("#modalBody input").forEach((i) => i.addEventListener("input", upd));
  upd();
}
function reportModal(r) {
  if (!r) return;
  const text = reportText(r, db.tx.filter((t) => t.reportId === r.id));
  const isLast = lastReport(r.walletId || "")?.id === r.id;
  openModal({
    title: `Звіт №${r.number} від ${fmtDate(r.date)}`,
    wide: true,
    body: `<div class="report-text">${esc(text)}</div>
      <div class="tools"><button type="button" class="btn primary" id="rpCopy">Копіювати текст</button></div>
      ${isLast ? `<p class="muted small-text">Це останній звіт — його можна видалити, щоб виправити операції; вони знову стануть «не у звітах».</p>` : ""}`,
    onDelete: isLast ? async () => { await save("reports/" + r.id, "DELETE"); toast("Звіт видалено"); } : null,
  });
  $("#rpCopy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(text); toast("Скопійовано"); } catch { prompt("Скопіюйте текст:", text); }
  });
}

// ===== Гаманці підрозділів =====
function renderWalletSel() {
  const sel = $("#walletSel");
  const list = db.wallets.filter((w) => w.active || w.id === curWallet);
  sel.classList.toggle("hidden", !db.wallets.length);
  sel.innerHTML = `<option value="">${esc(db.settings.title || "Каса")} (основна)</option>` + list.map((w) => `<option value="${w.id}" ${w.id === curWallet ? "selected" : ""}>${esc(w.name)}</option>`).join("");
  sel.value = curWallet;
  document.body.classList.toggle("in-wallet", !isMain());
  $$("#tabs .main-only").forEach((b) => b.classList.toggle("hidden", !isMain()));
  const active = $("#tabs button.active");
  if (active?.classList.contains("hidden")) showTab("overview");
}
function switchWallet(id) {
  curWallet = id || ""; localSet("kasa-wallet", curWallet || null);
  txLimit = 100; render(); window.scrollTo(0, 0);
  toast("Гаманець: " + walletName(curWallet));
}
$("#walletSel").addEventListener("change", (e) => switchWallet(e.target.value));

function walletOptions(selected, exclude) {
  const list = [{ id: "", name: (db.settings.title || "Каса") + " (основна)" }, ...db.wallets.filter((w) => w.active || w.id === selected)];
  return list.filter((w) => w.id !== exclude).map((w) => `<option value="${w.id}" ${w.id === selected ? "selected" : ""}>${esc(w.name)}</option>`).join("");
}
function transferModal(t, presetTo) {
  // t — будь-яка сторона переказу; шукаємо обидві
  const pair = t ? db.tx.filter((x) => x.transferId === t.transferId) : [];
  const out = pair.find((x) => x.type === "expense"), inc = pair.find((x) => x.type === "income");
  const from = out ? W(out) : presetTo ? "" : curWallet;
  const to = inc ? W(inc) : presetTo ?? (curWallet ? "" : db.wallets.find((w) => w.active)?.id || "");
  const locked = pair.some((x) => x.reportId);
  if (!db.wallets.length) return toast("Спочатку додайте гаманець у Налаштуваннях");
  openModal({
    title: t ? "Переказ між гаманцями" : "Новий переказ",
    body: `
      <div class="two">
        <label>Звідки<select name="from">${walletOptions(from)}</select></label>
        <label>Куди<select name="to">${walletOptions(to)}</select></label>
      </div>
      <div class="two">
        <label>Сума, ₴<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${out?.amount ?? ""}"></label>
        <label>Дата<input name="date" type="date" required value="${out?.date || today()}"></label>
      </div>
      <label>Коментар<input name="comment" maxlength="300" value="${esc(out?.comment || "")}" placeholder="поповнення банки"></label>
      <p class="muted small-text">Переказ записується у двох гаманцях одразу: у першому як витрата, у другому як надходження. Кожна сторона потрапляє у звіт свого гаманця.</p>
      ${locked ? `<p class="muted small-text">Переказ уже увійшов у звіт і заблокований.</p>` : ""}`,
    onSubmit: locked ? null : async (fd) => {
      const body = Object.fromEntries(fd);
      await save(t ? "transfer/" + t.transferId : "transfer", t ? "PUT" : "POST", body);
      toast(t ? "Переказ змінено" : "Переказ проведено");
    },
    onDelete: t && !locked ? async () => { await save("transfer/" + t.transferId, "DELETE"); toast("Переказ видалено"); } : null,
  });
  if (locked) $$("#modalBody input, #modalBody select").forEach((el) => (el.disabled = true));
}

function renderWallets() {
  $("#walletsSettings").innerHTML = db.wallets.length
    ? db.wallets.map((w) => `<div class="row" data-wallet-edit="${w.id}"><div class="t">${esc(w.name)}${w.active ? "" : `<span class="badge">неактивний</span>`}</div>
        <div class="a">${money(walletBalance(w.id))}</div><div class="s">${esc(w.note || "")} · звітів: ${wReports(w.id).length}</div><div></div></div>`).join("")
    : `<div class="empty">Гаманців ще немає</div>`;
}
$("#walletsSettings").addEventListener("click", (e) => { const r = e.target.closest("[data-wallet-edit]"); if (r) walletModal(walletById(r.dataset.walletEdit)); });
$("#addWallet").addEventListener("click", () => walletModal(null));
function walletModal(w) {
  const hasReports = w && wReports(w.id).length > 0;
  openModal({
    title: w ? "Гаманець" : "Новий гаманець",
    body: `
      <label>Назва<input name="name" required maxlength="80" value="${esc(w?.name || "")}" placeholder="Банка Стрікс"></label>
      <label>Примітка<input name="note" maxlength="300" value="${esc(w?.note || "")}" placeholder="майстерня НРК"></label>
      <label>Початковий залишок, ₴ <small class="muted">(змінюється лише до першого звіту гаманця)</small><input name="openingBalance" type="number" step="0.01" value="${w?.openingBalance || 0}" ${hasReports ? "disabled" : ""}></label>
      <label class="check"><input type="checkbox" name="active" ${!w || w.active ? "checked" : ""}> Активний</label>`,
    onSubmit: async (fd) => {
      const body = { name: fd.get("name"), note: fd.get("note"), openingBalance: hasReports ? w.openingBalance : fd.get("openingBalance"), active: fd.get("active") === "on" };
      await save(w ? "wallets/" + w.id : "wallets", w ? "PUT" : "POST", body);
      toast(w ? "Збережено" : "Гаманець додано");
    },
    onDelete: w ? async () => { await save("wallets/" + w.id, "DELETE"); toast("Гаманець видалено"); } : null,
  });
}

// ===== Експорт / копії =====
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#exportTxCsv").addEventListener("click", () => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Гаманець", "Дата", "Тип", "Сума", "Учасник", "Збір", "Категорія", "Спосіб", "Коментар", "Звіт"]].concat(
    filteredTx().map((t) => [walletName(W(t)), fmtDate(t.date), t.type === "income" ? "Надходження" : "Витрата", String(t.type === "income" ? t.amount : -t.amount).replace(".", ","),
      personById(t.personId)?.name || "", collById(t.collectionId)?.title || "", t.category, t.method === "card" ? "Картка" : "Готівка", t.comment,
      db.reports.find((r) => r.id === t.reportId)?.number || ""])
  );
  download(`operacii${curWallet ? "-" + walletName(curWallet).replace(/[^\p{L}\d]+/gu, "_") : ""}-${today()}.csv`, "﻿" + rows.map((r) => r.map(q).join(";")).join("\n"), "text/csv");
});
$("#backupBtn").addEventListener("click", () => download(`kasa-backup-${today()}.json`, JSON.stringify(db, null, 1), "application/json"));
$("#restoreFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`Відновити копію? Учасників: ${data.people?.length ?? 0}, операцій: ${data.tx?.length ?? 0}, гаманців: ${data.wallets?.length ?? 0}, зборів: ${data.collections?.length ?? 0}, звітів: ${data.reports?.length ?? 0}. Поточні дані буде замінено.`)) return;
    db = await api("import", "POST", data); render(); toast("Дані відновлено");
  } catch (err) { toast(err.message); }
});

$("#serverBackupsBtn").addEventListener("click", async () => {
  const box = $("#serverBackups");
  box.classList.remove("hidden"); box.innerHTML = `<div class="empty">Завантаження…</div>`;
  try {
    const items = await api("backups");
    box.innerHTML = items.length
      ? items.map((b) => `<div class="row" data-backup="${esc(b.key)}">
          <div class="t">Стан перед відновленням ${new Date(b.at).toLocaleString("uk-UA")}</div>
          <div class="a"><button class="btn ghost small" type="button">Повернути</button></div>
          <div class="s">учасників ${b.people} · операцій ${b.tx} · звітів ${b.reports}</div><div></div>
        </div>`).join("")
      : `<div class="empty">Копій ще немає — вони з'являються після кожного відновлення з файлу</div>`;
  } catch (err) { box.innerHTML = `<div class="empty">${esc(err.message)}</div>`; }
});
$("#serverBackups").addEventListener("click", async (e) => {
  const row = e.target.closest("[data-backup]"); if (!row || !e.target.closest("button")) return;
  if (!confirm("Повернути дані до цього стану? Поточні дані теж буде збережено як копію.")) return;
  try { db = await api("backups/" + encodeURIComponent(row.dataset.backup), "POST", {}); render(); toast("Дані повернуто"); $("#serverBackupsBtn").click(); }
  catch (err) { toast(err.message); }
});

// ===== Старт =====
showTab(localGet("kasa-tab") || "overview");
if (pass) start().catch(() => logout()); else logout();
