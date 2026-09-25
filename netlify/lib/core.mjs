// Спільна логіка API. Сховище передається ззовні (Netlify Blobs у проді, пам'ять у dev).

const EMPTY = () => ({
  people: [],
  tx: [],
  settings: { title: "Каса", monthlyFee: 0, categories: ["Оренда", "Господарські", "Подарунки", "Транспорт", "Інше"] },
});

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8" } });

async function load(store) {
  const db = (await store.get("db", { type: "json" })) || EMPTY();
  db.settings = { ...EMPTY().settings, ...(db.settings || {}) };
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
  return {
    type,
    amount,
    date,
    personId,
    category: type === "expense" ? str(b.category, 60) || "Інше" : "",
    method: b.method === "card" ? "card" : "cash",
    comment: str(b.comment, 300),
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
      if (m === "POST") {
        db.tx.push({ id: uid(), ...cleanTx(body, db), createdAt: now });
      } else if (m === "PUT" && id) {
        const i = db.tx.findIndex((t) => t.id === id);
        if (i < 0) return json({ error: "Не знайдено" }, 404);
        db.tx[i] = { ...db.tx[i], ...cleanTx(body, db), updatedAt: now };
      } else if (m === "DELETE" && id) {
        db.tx = db.tx.filter((t) => t.id !== id);
      } else return json({ error: "Метод не підтримується" }, 405);
    } else if (res === "settings" && m === "PUT") {
      const cats = Array.isArray(body.categories)
        ? [...new Set(body.categories.map((c) => str(c, 60)).filter(Boolean))].slice(0, 50)
        : db.settings.categories;
      db.settings = {
        title: str(body.title, 80) || "Каса",
        monthlyFee: Math.max(0, num(body.monthlyFee) || 0),
        categories: cats.length ? cats : ["Інше"],
      };
    } else if (res === "import" && m === "POST") {
      if (!Array.isArray(body.people) || !Array.isArray(body.tx)) throw new Error("Невірний формат резервної копії");
      await store.setJSON("backup-before-import-" + Date.now(), db);
      await store.setJSON("db", { people: body.people, tx: body.tx, settings: { ...EMPTY().settings, ...body.settings } });
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
