// ===== Стан =====
let db = { people: [], tx: [], settings: { title: "Каса", monthlyFee: 0, categories: [] } };
let pass = localGet("kasa-pass") || "";
let txLimit = 100;
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
function sortedTx() {
  return [...db.tx].sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || "").localeCompare(a.createdAt || ""));
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
function isPaid(st) {
  const fee = db.settings.monthlyFee;
  return fee > 0 ? st.month >= fee : st.month > 0;
}

// ===== Рендер =====
function render() {
  document.title = db.settings.title || "Каса";
  $("#appTitle").textContent = db.settings.title || "Каса";
  renderOverview(); renderTx(); renderPeople(); renderSettings();
}

function txRow(t) {
  const p = personById(t.personId);
  const title = t.type === "income" ? (p ? p.name : "Надходження") : t.category;
  const sub = [fmtDate(t.date), t.method === "card" ? "картка" : "готівка", t.comment].filter(Boolean).join(" · ");
  const sign = t.type === "income" ? "+" : "−";
  return `<div class="row" data-tx="${t.id}">
    <div class="t">${esc(title)}</div>
    <div class="a ${t.type === "income" ? "pos" : "neg"}">${sign}${money(t.amount)}</div>
    <div class="s">${esc(sub)}</div><div></div>
  </div>`;
}

function renderOverview() {
  const all = totals(db.tx);
  const m = curMonth();
  const mt = totals(db.tx.filter((t) => monthKey(t.date) === m));
  $("#sBalance").textContent = money(all.bal);
  $("#sIncome").textContent = money(mt.inc);
  $("#sExpense").textContent = money(mt.exp);
  const stats = personStats();
  const active = db.people.filter((p) => p.active);
  $("#sPaid").textContent = `${active.filter((p) => isPaid(stats[p.id])).length} / ${active.length}`;

  // Місяці (останні 6)
  const months = [];
  const d = new Date(); d.setDate(1);
  for (let i = 0; i < 6; i++) { months.unshift(d.toLocaleDateString("sv-SE").slice(0, 7)); d.setMonth(d.getMonth() - 1); }
  const byM = months.map((k) => ({ k, ...totals(db.tx.filter((t) => monthKey(t.date) === k)) }));
  const max = Math.max(1, ...byM.map((x) => Math.max(x.inc, x.exp)));
  $("#monthChart").innerHTML =
    `<div class="legend"><span><i style="background:var(--pos)"></i>надходження</span><span><i style="background:var(--neg)"></i>витрати</span></div>` +
    byM.map((x) => `<div class="mrow"><div class="lbl">${monthLabel(x.k)}</div><div class="bars">
      <div class="bar-wrap"><div class="bar in" style="width:${(x.inc / max) * 80}%"></div>${x.inc ? money(x.inc) : ""}</div>
      <div class="bar-wrap"><div class="bar out" style="width:${(x.exp / max) * 80}%"></div>${x.exp ? money(x.exp) : ""}</div>
    </div></div>`).join("");

  // Категорії
  const cats = {};
  for (const t of db.tx) if (t.type === "expense" && monthKey(t.date) === m) cats[t.category] = (cats[t.category] || 0) + t.amount;
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
  f.categories.value = db.settings.categories.join("\n");
}
$("#settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, btn = $("button[type=submit]", f);
  btn.disabled = true;
  try {
    await save("settings", "PUT", { title: f.title.value, monthlyFee: f.monthlyFee.value, categories: f.categories.value.split("\n") });
    toast("Збережено");
  } catch (err) { toast(err.message); }
  btn.disabled = false;
});

// ===== Модальне вікно =====
const modal = $("#modal");
let modalSubmit = null, modalDelete = null;
function openModal({ title, body, okText = "Зберегти", onSubmit, onDelete }) {
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
  try { await modalSubmit(new FormData(e.target)); modal.close(); }
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
function txModal(t, presetType, presetPerson) {
  const type = t?.type || presetType || "income";
  const cats = db.settings.categories.includes(t?.category) || !t?.category ? db.settings.categories : [...db.settings.categories, t.category];
  openModal({
    title: t ? "Редагувати операцію" : type === "income" ? "Новий внесок" : "Нова витрата",
    body: `
      <div class="seg">
        <label><input type="radio" name="type" value="income" ${type === "income" ? "checked" : ""}><span>Надходження</span></label>
        <label><input type="radio" name="type" value="expense" ${type === "expense" ? "checked" : ""}><span>Витрата</span></label>
      </div>
      <div class="two">
        <label>Сума, ₴<input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" required value="${t?.amount ?? (type === "income" && db.settings.monthlyFee ? db.settings.monthlyFee : "")}"></label>
        <label>Дата<input name="date" type="date" required value="${t?.date || today()}"></label>
      </div>
      <label class="f-income">Від кого<select name="personId">${personOptions(t?.personId || presetPerson)}</select></label>
      <label class="f-expense">Категорія<select name="category">${cats.map((c) => `<option ${c === t?.category ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></label>
      <label>Спосіб<select name="method"><option value="cash">Готівка</option><option value="card" ${t?.method === "card" ? "selected" : ""}>Картка / переказ</option></select></label>
      <label>Коментар<input name="comment" maxlength="300" value="${esc(t?.comment || "")}"></label>`,
    onSubmit: async (fd) => {
      const body = Object.fromEntries(fd);
      await save(t ? "tx/" + t.id : "tx", t ? "PUT" : "POST", body);
      toast(t ? "Змінено" : "Додано");
    },
    onDelete: t ? async () => { await save("tx/" + t.id, "DELETE"); toast("Видалено"); } : null,
  });
  const sync = () => {
    const v = $("#modalBody input[name=type]:checked").value;
    $("#modalBody .f-income").classList.toggle("hidden", v !== "income");
    $("#modalBody .f-expense").classList.toggle("hidden", v !== "expense");
    if (!t) $("#modalTitle").textContent = v === "income" ? "Новий внесок" : "Нова витрата";
  };
  $$("#modalBody input[name=type]").forEach((r) => r.addEventListener("change", sync));
  sync();
}
document.addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]"); if (add) return txModal(null, add.dataset.add);
  const row = e.target.closest("[data-tx]");
  if (row && !row.closest("dialog")) { const t = db.tx.find((x) => x.id === row.dataset.tx); if (t) txModal(t); }
});

// ----- Учасник -----
function personModal(p) {
  let history = "";
  if (p) {
    const txs = sortedTx().filter((t) => t.personId === p.id);
    const y = new Date().getFullYear();
    const grid = Array.from({ length: 12 }, (_, i) => {
      const k = `${y}-${String(i + 1).padStart(2, "0")}`;
      const sum = paidByPersonMonth(p.id, k);
      const ok = db.settings.monthlyFee ? sum >= db.settings.monthlyFee : sum > 0;
      return `<div class="${ok ? "ok" : ""}" title="${MONTHS_FULL[i]}: ${money(sum)}">${MONTHS[i]}</div>`;
    }).join("");
    history = `
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

// ===== Експорт / копії =====
function download(name, content, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([content], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$("#exportTxCsv").addEventListener("click", () => {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [["Дата", "Тип", "Сума", "Учасник", "Категорія", "Спосіб", "Коментар"]].concat(
    filteredTx().map((t) => [fmtDate(t.date), t.type === "income" ? "Надходження" : "Витрата", String(t.type === "income" ? t.amount : -t.amount).replace(".", ","),
      personById(t.personId)?.name || "", t.category, t.method === "card" ? "Картка" : "Готівка", t.comment])
  );
  download(`operacii-${today()}.csv`, "﻿" + rows.map((r) => r.map(q).join(";")).join("\n"), "text/csv");
});
$("#backupBtn").addEventListener("click", () => download(`kasa-backup-${today()}.json`, JSON.stringify(db, null, 1), "application/json"));
$("#restoreFile").addEventListener("change", async (e) => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!confirm(`Відновити копію? Учасників: ${data.people?.length ?? 0}, операцій: ${data.tx?.length ?? 0}. Поточні дані буде замінено.`)) return;
    db = await api("import", "POST", data); render(); toast("Дані відновлено");
  } catch (err) { toast(err.message); }
});

// ===== Старт =====
showTab(localGet("kasa-tab") || "overview");
if (pass) start().catch(() => logout()); else logout();
