# Telegram FIFA Bot + Miniapp

Готовый каркас для футбольного Telegram-чата:

- бот автоматически ловит новые анонсы игр из сообщений формата `дата -> место -> время -> список @username`
- miniapp показывает текущую игру и список всех игроков
- каждому игроку строится FIFA-карточка с фото, именем, ником, рейтингом, позицией, параметрами, играми, голами и ассистами
- после начала матча бот присылает в чат сообщение с кнопкой на miniapp для оценок
- оценивать можно только участников текущей игры и только других игроков
- окно оценок живет до появления следующего анонса игры
- после 3 часов от старта матч помечается как завершенный
- лучший игрок последней оцененной игры получает бейдж `MVP` до следующего MVP

## Рекомендуемая схема деплоя

Для этого проекта сейчас лучшая схема такая:

- `Cloudflare Pages` — только фронт miniapp из папки `web/`
- `Render / Railway / Fly.io / VPS` — backend, Telegram bot, API, база `data/db.json`

Почему так:

- Cloudflare Pages отлично подходит для статического miniapp
- текущий бот работает как Node.js процесс с long polling
- такой backend нельзя целиком запускать на обычном статическом Pages-хостинге

## Что внутри

- `src/server.js` — HTTP-сервер, API miniapp и запуск long polling бота
- `src/bot/telegram.js` — интеграция с Telegram Bot API
- `src/lib/parser.js` — парсинг анонсов игр и импорта истории
- `src/lib/store.js` — JSON-хранилище
- `src/lib/stats.js` — агрегация рейтингов, карточек и MVP
- `web/` — miniapp
- `web/config.js` — адрес backend API для фронта
- `scripts/build-web-config.js` — генерация `web/config.js` на этапе Cloudflare build
- `scripts/import-history.js` — импорт старых игр из Telegram Desktop export

## Важные ограничения Telegram

1. Обычный Telegram Bot API не умеет сам читать старую историю чата задним числом.
2. Поэтому для полной исторической базы в проекте есть импорт из JSON-экспорта Telegram Desktop.
3. Если игрок в истории встречается только как `@username`, Telegram не дает боту автоматически узнать его имя, `user_id` и фото.
4. Имя и фото подтянутся, когда этот человек сам напишет что-то в чате или откроет miniapp.

Итог: вся новая история будет собираться автоматически, а старая история импортируется один раз из экспорта.

## Архитектура URL

Тебе понадобятся два публичных адреса:

- `FRONTEND_URL` — адрес miniapp, например `https://fifa-cards.pages.dev`
- `BACKEND_URL` — адрес Node backend, например `https://fifa-bot.onrender.com`

Именно так они используются:

- `PUBLIC_BASE_URL=FRONTEND_URL` на backend
- `CORS_ALLOWED_ORIGINS=FRONTEND_URL,http://localhost:3000` на backend
- `API_BASE_URL=BACKEND_URL` в Cloudflare Pages build settings

## 1. Создать Telegram-бота

1. Открой `@BotFather`
2. Выполни `/newbot`
3. Сохрани токен
4. Выполни `/setprivacy`
5. Выбери своего бота
6. Установи `Disable`

Без отключенного privacy mode бот не увидит обычные сообщения с анонсами игр в группе.

## 2. Подготовить backend

Подойдет:

- Render
- Railway
- Fly.io
- VPS
- локальный сервер через `cloudflared` или `ngrok`

### Переменные окружения backend

Скопируй `.env.example` в `.env` и заполни:

```bash
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://your-project.pages.dev
CORS_ALLOWED_ORIGINS=https://your-project.pages.dev,http://localhost:3000
TELEGRAM_BOT_TOKEN=123456:replace_me
DEFAULT_CHAT_ID=
ALLOW_DEV_LOGIN=true
ADMIN_IMPORT_TOKEN=replace_with_long_secret
CHAT_TIMEZONE_OFFSET=+03:00
SCHEDULER_INTERVAL_MS=60000
AUTH_MAX_AGE_SECONDS=86400
```

Где:

- `PUBLIC_BASE_URL` — это будущий адрес Cloudflare Pages
- `CORS_ALLOWED_ORIGINS` — домены, которым разрешено ходить в API
- `CHAT_TIMEZONE_OFFSET` — часовой пояс анонсов игр, например `+03:00` для Москвы

### Локальный запуск backend

```bash
npm start
```

Dev-режим:

```bash
npm run dev
```

Docker:

```bash
docker build -t fifa-miniapp-bot .
docker run --rm -p 3000:3000 --env-file .env fifa-miniapp-bot
```

## 3. Создать проект на Cloudflare Pages

Ниже самый удобный сценарий: через GitHub.

### 3.1. Залить проект в GitHub

1. Создай новый репозиторий на GitHub
2. Запушь туда этот проект

### 3.2. Создать Pages проект

1. Открой Cloudflare Dashboard
2. Перейди в `Workers & Pages`
3. Нажми `Create application`
4. Выбери `Pages`
5. Нажми `Connect to Git`
6. Подключи GitHub
7. Выбери репозиторий с этим проектом

### 3.3. Build settings в Cloudflare Pages

Заполни так:

- `Framework preset`: `None`
- `Build command`: `npm run build:web`
- `Build output directory`: `web`
- `Root directory`: оставить пустым, если репозиторий целиком состоит из этого проекта

### 3.4. Environment variables в Cloudflare Pages

Добавь:

- `API_BASE_URL = https://your-backend.example`

Это адрес backend, в который miniapp будет слать запросы.

### 3.5. Первый деплой

1. Нажми `Save and Deploy`
2. Дождись сборки
3. Получишь адрес вида:

```text
https://your-project.pages.dev
```

Это и будет `FRONTEND_URL`.

## 4. Связать frontend и backend

После того как у тебя появился адрес Cloudflare Pages:

1. Подставь его в backend:

```bash
PUBLIC_BASE_URL=https://your-project.pages.dev
CORS_ALLOWED_ORIGINS=https://your-project.pages.dev,http://localhost:3000
```

2. Перезапусти backend
3. Убедись, что `API_BASE_URL` в Cloudflare Pages указывает на backend
4. Если менял переменные в Pages, сделай redeploy

## 5. Добавить бота в футбольный чат

1. Добавь бота в группу
2. Дай право читать сообщения, если Telegram попросит
3. Отправь в чат `/chatid`
4. Сохрани ID чата, например `-1001234567890`
5. Подставь его в `.env` как `DEFAULT_CHAT_ID`
6. Перезапусти backend

## 6. Настроить Mini App у BotFather

Нужно, чтобы Telegram открывал именно `FRONTEND_URL`.

Сделай так:

1. Открой `@BotFather`
2. Выбери своего бота через `/mybots`
3. Открой `Bot Settings`
4. Открой `Menu Button` или `Configure Mini App`, в зависимости от нужного режима
5. Укажи URL:

```text
https://your-project.pages.dev
```

Дополнительно можешь оставить команду `/open` — бот тоже умеет слать кнопку открытия miniapp.

## 7. Открыть miniapp

В чате отправь:

```text
/open
```

Бот пришлет кнопку `Открыть миниапп`.

## Импорт всей старой истории

### 1. Экспортировать чат из Telegram Desktop

1. Открой нужный чат в Telegram Desktop
2. `...` -> `Export chat history`
3. Формат: `Machine-readable JSON`
4. Экспортируй историю

### 2. Импортировать в локальную базу

```bash
node scripts/import-history.js /absolute/path/to/result.json --chat-id -1001234567890
```

После этого все найденные исторические анонсы игр попадут в базу, а карточки игроков посчитают число игр.

### 3. Импортировать в уже развернутый backend

Если backend уже крутится на Railway/Render/VPS, используй защищенный remote import:

```bash
node scripts/import-history-remote.js /absolute/path/to/result.json --backend https://your-backend.example --chat-id -1001234567890 --token your_secret
```

Где `your_secret` должен совпадать с `ADMIN_IMPORT_TOKEN` на backend.

## Как работает сценарий игры

1. Кто-то пишет в чат сообщение формата:

```text
Воскресенье 17 мая
Полежаевская
19:30

1. @teterko
2. @dbabanin
3. @dimasharovv
...
```

2. Бот парсит дату, место, время и список игроков
3. Игра становится текущей
4. После наступления времени старта бот автоматически шлет в чат сообщение с кнопкой на miniapp
5. Участники игры открывают miniapp и оценивают друг друга
6. Бот усредняет оценки по параметрам
7. Из средних параметров считает общий рейтинг
8. Голы и ассисты за игру тоже берутся как среднее значение по оценкам и суммируются в карьеру
9. Лучший игрок последней оцененной игры получает `MVP`
10. Когда появляется новый анонс в чате, окно оценок для прошлой игры закрывается

## Формула рейтинга

Сейчас общий рейтинг считается как среднее по шести параметрам:

- скорость
- дриблинг
- удар
- защита
- передачи
- физика

Позиция определяется как самая часто выбранная позиция среди оценок игрока за игру и дальше агрегируется по карьере.

## Структура miniapp

### Таб 1. Текущая игра

- сверху дата, время, место и статус матча
- ниже схема поля с игроками
- ниже список игроков текущего матча
- по нажатию на игрока открывается его карточка
- после старта игры доступна форма оценки
- если прошло больше 3 часов, показывается плашка `Игра закончена`

### Таб 2. Игроки

- сортировка по рейтингу
- сортировка по количеству игр
- сортировка по отдельному параметру
- сортировка по голам
- сортировка по ассистам
- `MVP` всегда ранжируется выше остальных

## API для miniapp

- `GET /api/bootstrap?chatId=...`
- `POST /api/auth/telegram`
- `POST /api/auth/dev`
- `POST /api/games/:gameId/ratings`

Фронт на Cloudflare Pages обращается к backend через `web/config.js`, который генерируется командой:

```bash
npm run build:web
```

При сборке используется переменная окружения:

```bash
API_BASE_URL=https://your-backend.example
```

## Локальная проверка без Telegram

Если включен `ALLOW_DEV_LOGIN=true`, miniapp можно открыть прямо в браузере:

```text
http://localhost:3000/?chatId=-1001234567890
```

Там появится `Dev-вход`, через который можно войти как любой `username` и проверить интерфейс.

Если хочешь отдельно проверить только фронт с backend на другом домене, можно локально сгенерировать конфиг так:

```bash
API_BASE_URL=https://your-backend.example npm run build:web
```

## Тесты

```bash
npm test
```

## Что можно улучшить дальше

- перевести backend с JSON на PostgreSQL или SQLite
- заменить long polling на webhook и перенести backend глубже в Cloudflare-стек
- добавить админку для ручной правки статистики
- добавить экспорт красивых PNG-карточек
- научить бот закреплять текущую игру и обновлять ее по кнопке
- сделать локальный кэш аватаров
