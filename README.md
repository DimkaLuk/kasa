# Каса — облік внесків і витрат

Веб-додаток для обліку грошей групи (100–150 учасників): внески від учасників, витрати за категоріями, баланс каси, хто оплатив за місяць, експорт CSV, резервні копії.

## Як влаштовано
- `public/` — інтерфейс (HTML/CSS/JS, без збірки)
- `netlify/functions/api.mjs` — API на Netlify Functions
- Дані зберігаються в **Netlify Blobs** (сховище `kasa`) — окрема база не потрібна
- Вхід за спільним паролем зі змінної середовища `APP_PASSWORD`

## Розгортання на Netlify
1. Add new site → Import from GitHub → вибрати цей репозиторій (налаштування підхопляться з `netlify.toml`).
2. Site configuration → Environment variables → додати `APP_PASSWORD`.
3. Deploy. Далі кожен push у `main` розгортається автоматично.

## Локально
```
npm install
APP_PASSWORD=1234 npm run dev   # http://localhost:8888
```
