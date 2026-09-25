# Конвертер Google-таблиці «Журнал» у резервну копію Каси (формат /api/import)
# Використання: pip install openpyxl; python3 tools/import_xlsx.py таблиця.xlsx kasa-import.json [дата-звіту-РРРР-ММ-ДД]
# Результат відновлюється в Каса → Налаштування → «Відновити з файлу».
import openpyxl, sys, re, json, collections, datetime, random, string

SRC, OUT, REPORT_DATE = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "")
wb = openpyxl.load_workbook(SRC)
norm = lambda s: re.sub(r"\s+", " ", str(s or "")).strip()
key = lambda s: norm(s).lower()
_n = 0
def uid():
    global _n; _n += 1
    return "x" + format(_n, "05d") + "".join(random.choices(string.ascii_lowercase + string.digits, k=5))
iso = lambda dt: dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
NOW = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")

# ---- Учасники ----
ref = [norm(r[0].value) for r in wb["Довідники"].iter_rows(min_row=2) if r[0].value]
NOT_PEOPLE = {"волонтери"}
ALIAS = {"гайша андрій геннадійович": "гайша андрій геннадійович ворон"}
people, pid = [], {}
for n in ref:
    if key(n) in NOT_PEOPLE: continue
    p = {"id": uid(), "name": n, "phone": "", "note": "", "active": True, "createdAt": NOW}
    people.append(p); pid[key(n)] = p["id"]

# ---- Журнал ----
rows = []
for r in wb["Журнал"].iter_rows(min_row=2):
    v = [c.value for c in r]
    if not v[0]: continue
    rows.append((r[0].row, v))
rows.sort(key=lambda x: (x[1][0], x[0]))

def amount(v):
    if isinstance(v, (int, float)): return round(float(v), 2)
    if isinstance(v, str) and v.startswith("="):  # напр. =7000+17500
        return round(float(eval(v[1:], {"__builtins__": {}})), 2)
    return round(float(str(v).replace(",", ".")), 2)

CATS = [
    ("Старлінк", r"старлінк|starlink|старлинк"),
    ("Поповнення банок майстерень", r"поповнення|на майстерню бпла|майстерн\w* (бпла|нрк)|^майстерня"),
    ("Розрахунки з учасниками", r"^(борг |від \w+ до|\w+ від \w+$)|барні"),
    ("Оренда", r"оренд"),
    ("Підписки та сервіси", r"підписк|промоплат|пром |аліекспрес"),
    ("Авто", r"щеплен|балансир|кардан|рвд|омивач|олива|lt ?46|ml ?270|тяга|гальм|карбюр|\bт4\b|\bт5\b|л200|навар|хайлюкс|hilux|хайс|рено|\bjac\b|таракан|шин|колес|розвал|запчаст|масло|фильтр|фільтр|колодк|стаб|автомоб|маховик|присадк|ремінь|ремень|\bгур\b|втулк|шиномонтаж|тонув|акпп|мкпп|двигун|аккумулятор авто"),
    ("Живлення та паливо", r"заправка (?!балон)|\bдп\b|біопалив|генератор|бензин|палив|пальне|зарядн|ecoflow|ecoplay|акум|батаре|інвертор"),
    ("БПЛА та зв'язок", r"антен|модуль|мавік|mavic|матріс|matrice|дрон|бпла|пропел|пропол|вампір|пульт|crossfire|hdmi|sll|бустер|спарк|шлейф|роутер|mesh|рації|рація"),
    ("Техніка та електроніка", r"нрк|р2д2|діод|медіаконвер|патчкорд|ноутбук|ssd|пам.ять|плат[аи]|комплектуюч|пластик abs|abs|фпв|пропи|мікроскоп|мультиметр|паяль|адаптер|usb|сімкарт|принтер|картридж|кадрідж|запобіжник|відеозахват|bluetooth"),
    ("Доставка", r"нова пошта|\bнп\b|доставк|послуг"),
    ("Господарські", r"стяжк|скоч|скотч|розетк|вилк|кабель|кабеля|лампоч|рукавиц|стрічк|клей|пакет|дюбел|інструмент|ключ|бур|мішк|фарб|пінофол|подовжувач|піна|труб|будматер|скоби|цвях|брус|перчатк|пупирк|канцеляр|стіл|стільч|тележк|дистил|прапор|омивач"),
]
def category(c):
    s = key(c)
    for name, rx in CATS:
        if re.search(rx, s): return name
    return "Інше"

tx, unknown = [], collections.Counter()
for rownum, v in rows:
    ts, typ = v[0], v[1]
    base = {"id": uid(), "date": ts.date().isoformat(), "method": "card", "createdAt": iso(ts), "srcRow": rownum}
    if typ == "Прихід":
        name = key(v[2]); name = ALIAS.get(name, name)
        comment = norm(v[4])
        t = {**base, "type": "income", "amount": amount(v[3]), "personId": "", "collectionId": "", "category": "", "comment": comment}
        if name in NOT_PEOPLE:
            t["comment"] = norm(v[2]) + (": " + comment if comment else "")
        else:
            if name not in pid:  # є в журналі, але немає в довіднику — колишні учасники
                p = {"id": uid(), "name": norm(v[2]), "phone": "", "note": "немає в довіднику", "active": False, "createdAt": NOW}
                people.append(p); pid[name] = p["id"]; unknown[p["name"]] += 0
            t["personId"] = pid[name]
        tx.append(t)
    elif typ == "Витрата":
        c = norm(v[6])
        tx.append({**base, "type": "expense", "amount": amount(v[5]), "personId": "", "collectionId": "", "category": category(c), "comment": c})

# ---- Збори (хвилі внесків) ----
contrib = [t for t in tx if t["type"] == "income" and t["personId"] and not t["comment"]]
perday = collections.Counter(t["date"] for t in contrib)
waves = []
for d in sorted(perday):
    if perday[d] < 20: continue
    dd = datetime.date.fromisoformat(d)
    if waves and (dd - datetime.date.fromisoformat(waves[-1]["days"][-1])).days <= 2:
        waves[-1]["days"].append(d); continue
    waves.append({"days": [d]})

for w in waves:
    amts = [t["amount"] for t in contrib if t["date"] in w["days"]]
    share2000 = sum(a == 2000 for a in amts) / len(amts)
    if w is waves[0]: w["kind"] = "other"
    else: w["kind"] = "salary" if share2000 >= 0.7 else "bonus"
    w["date"] = w["days"][0]

def wave_for(t):
    cur = None
    for w in waves:
        if w["date"] <= t["date"]: cur = w
    return cur

paid = collections.defaultdict(set)
for t in sorted(contrib, key=lambda t: t["createdAt"]):
    w = wave_for(t)
    if not w: continue
    i = waves.index(w)
    # Запізнілий внесок за хвилю іншого типу (напр. 2000 за ЗП у період премії)
    want_salary = t["amount"] == 2000
    if w["kind"] != "other" and (w["kind"] == "salary") != want_salary and t["date"] not in w["days"]:
        prev = next((x for x in reversed(waves[:i]) if x["kind"] == ("salary" if want_salary else "bonus")), None)
        if prev and t["personId"] not in paid[id(prev)]: w = prev
    t["collectionId"] = w.setdefault("id", uid())
    paid[id(w)].add(t["personId"])

KL = {"salary": "ЗП", "bonus": "премію", "other": "внесок"}
collections_out = []
active = {p["id"] for p in people if p["active"]}
for i, w in enumerate(waves):
    w.setdefault("id", uid())
    y, m, d = w["date"].split("-")
    title = f"Внесок за {KL[w['kind']]} {d}.{m}.{y}" if w["kind"] != "other" else f"Перший внесок {d}.{m}.{y}"
    ids = set(paid[id(w)])
    is_recent = i >= len(waves) - 2
    if is_recent:  # для актуальних зборів — очікувані = хто платив у попередньому зборі того ж типу
        prev = next((x for x in reversed(waves[:i]) if x["kind"] == w["kind"]), None)
        if prev: ids |= (paid[id(prev)] & active)
    order = {p["id"]: n for n, p in enumerate(people)}
    collections_out.append({
        "id": w["id"], "title": title, "kind": w["kind"], "date": w["date"],
        "amount": 2000 if w["kind"] == "salary" else 0,
        "personIds": sorted(ids, key=lambda x: order[x]), "comment": "імпорт з таблиці",
        "closed": not is_recent, "createdAt": NOW,
    })

# ---- Звіт-відсічка ----
reports = []
if REPORT_DATE:
    items = [t for t in tx if t["date"] <= REPORT_DATE]
    inc = round(sum(t["amount"] for t in items if t["type"] == "income"), 2)
    exp = round(sum(t["amount"] for t in items if t["type"] == "expense"), 2)
    r = {"id": uid(), "number": 1, "date": REPORT_DATE, "prevDate": "", "opening": 0, "income": inc, "expense": exp,
         "closing": round(inc - exp, 2), "txIds": [t["id"] for t in items], "comment": "Підсумок старої таблиці (імпорт)", "createdAt": NOW}
    for t in items: t["reportId"] = r["id"]
    reports.append(r)

for t in tx: t.pop("srcRow", None)
cats = [c for c, _ in CATS] + ["Інше"]
db = {"people": people, "tx": tx, "collections": collections_out, "reports": reports,
      "settings": {"title": "Каса", "monthlyFee": 0, "openingBalance": 0, "categories": cats}}
json.dump(db, open(OUT, "w"), ensure_ascii=False)

# ---- Підсумок ----
inc = sum(t["amount"] for t in tx if t["type"] == "income"); exp = sum(t["amount"] for t in tx if t["type"] == "expense")
print(f"учасників {len(people)} (активних {len(active)}, з журналу без довідника: {len(unknown)}: {', '.join(unknown)})")
print(f"операцій {len(tx)}: прихід {inc:.2f} ({sum(t['type']=='income' for t in tx)}), витрати {exp:.2f} ({sum(t['type']=='expense' for t in tx)}), залишок {inc-exp:.2f}")
print("без учасника (волонтери тощо):", sum(1 for t in tx if t['type']=='income' and not t['personId']),
      "| внески з коментарем (повернення тощо, без збору):", sum(1 for t in tx if t['type']=='income' and t['personId'] and t['comment']))
for c in collections_out:
    s = sum(t["amount"] for t in tx if t["collectionId"] == c["id"]); n = len({t["personId"] for t in tx if t["collectionId"] == c["id"]})
    print(f"  {c['title']:<34} внесли {n:>3} з {len(c['personIds']):>3}  {s:>10.0f}  {'закр' if c['closed'] else 'ВІДКРИТИЙ'}")
print("категорії:", collections.Counter(t["category"] for t in tx if t["type"] == "expense").most_common())
for r in reports: print("звіт", r["date"], "прихід", r["income"], "витрати", r["expense"], "залишок", r["closing"], "операцій", len(r["txIds"]))
