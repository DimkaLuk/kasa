// Спільна логіка API. Сховище передається ззовні (Netlify Blobs у проді, пам'ять у dev).

const EMPTY = () => ({
  people: [],
  tx: [],
  collections: [],
  reports: [],
  settings: { title: "Каса", monthlyFee: 0, openingBalance: 0, categories: ["Оренда", "Господарські", "Подарунки", "Транспорт", "Інше"] },
});

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function load(store) {
  const db = (await store.get("db", { type: "json" })) || EMPTY();
  db.settings = { ...EMPTY().settings, ...(db.settings || {}) };
  db.collections ||= [];
  db.reports ||= [];
  return db;
}

const str = (v, max = 200) => String(v ?? "").trim().slice(0, max);
const num = (v) => Math.round(Number(String(v).replace(",", ".")) * 100) / 100;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);

function cleanPerson(b) {
  const name = str(b.name, 120);
  if (!name) throw new Error("Вкажіть ім'я");
  return { name, phone: str(b.phone, 40), note: str(b.note, 300), active: b.active !== false };
}

function cleanTx(b, db) {
  const type = b.type === "expense" ? "expense" : "income";
  const amount = num(b.amount);
  if (!(amount > 0)) throw new Error("Сума має бути більше 0");
  const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const personId = type === "income" && b.personId ? str(b.personId, 40) : "";
  if (personId && !db.people.some((p) => p.id === personId)) throw new Error("Учасника не знайдено");
  const collectionId = type === "income" && personId && b.collectionId ? str(b.collectionId, 40) : "";
  if (collectionId && !db.collections.some((c) => c.id === collectionId)) throw new Error("Збір не знайдено");
  return {
    type,
    amount,
    date,
    personId,
    collectionId,
    category: type === "expense" ? str(b.category, 60) || "Інше" : "",
    method: b.method === "card" ? "card" : "cash",
    comment: str(b.comment, 300),
  };
}

const KINDS = ["salary", "bonus", "other"];
const KIND_LABEL = { salary: "ЗП", bonus: "премію", other: "інше" };

function cleanCollection(b, db) {
  const kind = KINDS.includes(b.kind) ? b.kind : "other";
  const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const [y, m, d] = date.split("-");
  const title = str(b.title, 120) || `Внесок за ${KIND_LABEL[kind]} ${d}.${m}.${y}`;
  const ids = new Set(db.people.map((p) => p.id));
  const personIds = [...new Set((Array.isArray(b.personIds) ? b.personIds : []).map((x) => str(x, 40)))].filter((x) => ids.has(x));
  if (!personIds.length) throw new Error("Виберіть хоча б одного учасника");
  return { title, kind, date, amount: Math.max(0, num(b.amount) || 0), personIds, comment: str(b.comment, 300), closed: b.closed === true };
}

const txLocked = (t) => t && t.reportId;

function makeReport(b, db) {
  const date = isDate(b.date) ? b.date : new Date().toISOString().slice(0, 10);
  const prev = db.reports[db.reports.length - 1];
  if (prev && date < prev.date) throw new Error("Дата звіту не може бути раніше за попередній звіт");
  const items = db.tx.filter((t) => !t.reportId && t.date <= date);
  if (!items.length) throw new Error("Немає нових операцій для звіту");
  const r2 = (n) => Math.round(n * 100) / 100;
  const income = r2(items.filter((t) => t.type === "income").reduce((s, t) => s + t.amount, 0));
  const expense = r2(items.filter((t) => t.type === "expense").reduce((s, t) => s + t.amount, 0));
  const opening = prev ? prev.closing : num(db.settings.openingBalance) || 0;
  return {
    number: (prev?.number || 0) + 1,
    date,
    prevDate: prev?.date || "",
    opening,
    income,
    expense,
    closing: r2(opening + income - expense),
    txIds: items.map((t) => t.id),
    comment: str(b.comment, 500),
  };
}

export async function handle(req, store, password) {
  if (!password) return json({ error: "На сервері не задано APP_PASSWORD" }, 500);
  if (req.headers.get("x-app-password") !== password) return json({ error: "Невірний пароль" }, 401);

  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [res, id] = parts;
  const m = req.method;
  let body = {};
  if (m === "POST" || m === "PUT") {
    try { body = await req.json(); } catch { return json({ error: "Некоректний JSON" }, 400); }
  }

  try {
    if (res === "db" && m === "GET") return json(await load(store));

    const db = await load(store);
    const now = new Date().toISOString();

    if (res === "people") {
      if (m === "POST" && Array.isArray(body.bulk)) {
        const names = new Set(db.people.map((p) => p.name.toLowerCase()));
        for (const item of body.bulk.slice(0, 1000)) {
          const p = cleanPerson(item);
          if (names.has(p.name.toLowerCase())) continue;
          names.add(p.name.toLowerCase());
          db.people.push({ id: uid(), ...p, createdAt: now });
        }
      } else if (m === "POST") {
        const p = { id: uid(), ...cleanPerson(body), createdAt: now };
        db.people.push(p);
      } else if (m === "PUT" && id) {
        const i = db.people.findIndex((p) => p.id === id);
        if (i < 0) return json({ error: "Не знайдено" }, 404);
        db.people[i] = { ...db.people[i], ...cleanPerson(body) };
      } else if (m === "DELETE" && id) {
        if (db.tx.some((t) => t.personId === id))
          return json({ error: "У учасника є операції — зробіть його неактивним замість видалення" }, 409);
        db.people = db.people.filter((p) => p.id !== id);
      } else return json({ error: "Метод не підтримується" }, 405);
    } else if (res === "tx") {
      const LOCKED = "Операція вже увійшла у звіт — її не можна змінити. Спочатку видаліть звіт.";
      if (m === "POST" && Array.isArray(body.bulk)) {
        // Груповий внесок: спільні дата/спосіб/збір, у кожного учасника своя сума
        const items = body.bulk.slice(0, 1000).filter((x) => num(x.amount) > 0);
        if (!items.length) throw new Error("Вкажіть суму хоча б для одного учасника");
        const added = items.map((x) => ({
          id: uid(),
          ...cleanTx({ type: "income", date: body.date, method: body.method, collectionId: body.collectionId, personId: x.personId, amount: x.amount, comment: x.comment ?? body.comment }, db),
          createdAt: now,
        }));
        db.tx.push(...added);
      } else if (m === "POST") {
        db.tx.push({ id: uid(), ...cleanTx(body, db), createdAt: now });
      } else if (m === "PUT" && id) {
        const i = db.tx.findIndex((t) => t.id === id);
        if (i < 0) return json({ error: "Не знайдено" }, 404);
        if (txLocked(db.tx[i])) return json({ error: LOCKED }, 409);
        db.tx[i] = { ...db.tx[i], ...cleanTx(body, db), updatedAt: now };
      } else if (m === "DELETE" && id) {
        if (txLocked(db.tx.find((t) => t.id === id))) return json({ error: LOCKED }, 409);
        db.tx = db.tx.filter((t) => t.id !== id);
      } else return json({ error: "Метод не підтримується" }, 405);
    } else if (res === "collections") {
      if (m === "POST") {
        db.collections.push({ id: uid(), ...cleanCollection(body, db), createdAt: now });
      } else if (m === "PUT" && id) {
        const i = db.collections.findIndex((c) => c.id === id);
        if (i < 0) return json({ error: "Не знайдено" }, 404);
        db.collections[i] = { ...db.collections[i], ...cleanCollection(body, db), updatedAt: now };
      } else if (m === "DELETE" && id) {
        if (db.tx.some((t) => t.collectionId === id && t.reportId))
          return json({ error: "Внески цього збору вже увійшли у звіт — збір можна лише закрити" }, 409);
        db.tx.forEach((t) => { if (t.collectionId === id) t.collectionId = ""; });
        db.collections = db.collections.filter((c) => c.id !== id);
      } else return json({ error: "Метод не підтримується" }, 405);
    } else if (res === "reports") {
      if (m === "POST") {
        const r = { id: uid(), ...makeReport(body, db), createdAt: now };
        const set = new Set(r.txIds);
        db.tx.forEach((t) => { if (set.has(t.id)) t.reportId = r.id; });
        db.reports.push(r);
      } else if (m === "PUT" && id) {
        const r = db.reports.find((x) => x.id === id);
        if (!r) return json({ error: "Не знайдено" }, 404);
        r.comment = str(body.comment, 500);
      } else if (m === "DELETE" && id) {
        const last = db.reports[db.reports.length - 1];
        if (!last || last.id !== id) return json({ error: "Видалити можна лише останній звіт" }, 409);
        db.tx.forEach((t) => { if (t.reportId === id) delete t.reportId; });
        db.reports.pop();
      } else return json({ error: "Метод не підтримується" }, 405);
    } else if (res === "settings" && m === "PUT") {
      const cats = Array.isArray(body.categories)
        ? [...new Set(body.categories.map((c) => str(c, 60)).filter(Boolean))].slice(0, 50)
        : db.settings.categories;
      if (db.reports.length && (num(body.openingBalance) || 0) !== db.settings.openingBalance)
        throw new Error("Початковий залишок не можна змінити після першого звіту");
      db.settings = {
        title: str(body.title, 80) || "Каса",
        monthlyFee: Math.max(0, num(body.monthlyFee) || 0),
        openingBalance: num(body.openingBalance) || 0,
        categories: cats.length ? cats : ["Інше"],
      };
    } else if (res === "import" && m === "POST") {
      if (!Array.isArray(body.people) || !Array.isArray(body.tx)) throw new Error("Невірний формат резервної копії");
      await store.setJSON("backup-before-import-" + Date.now(), db);
      await store.setJSON("db", {
        people: body.people, tx: body.tx,
        collections: Array.isArray(body.collections) ? body.collections : [],
        reports: Array.isArray(body.reports) ? body.reports : [],
        settings: { ...EMPTY().settings, ...body.settings },
      });
      return json(await load(store));
    } else {
      return json({ error: "Не знайдено" }, 404);
    }

    await store.setJSON("db", db);
    return json(db);
  } catch (e) {
    return json({ error: e.message || "Помилка" }, 400);
  }
}
