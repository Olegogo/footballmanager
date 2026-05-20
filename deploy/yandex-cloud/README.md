# Yandex Cloud VM Deploy

Это самый простой перенос текущего проекта в `Yandex Cloud` без переделки бота в serverless.

Схема:

- одна `Compute Cloud VM`
- `Docker Compose`
- `Caddy` для HTTPS
- bot + miniapp работают с одного домена

## Что подготовить

Нужны:

- домен или поддомен, например `football.example.ru`
- публичный IP виртуальной машины
- токен Telegram-бота
- `chat id` целевого чата

## 1. Создай VM в Yandex Cloud

Подойдет:

- `Ubuntu 24.04 LTS`
- 1 vCPU
- 1-2 GB RAM
- внешний IP

Открой входящие порты:

- `22` для SSH
- `80` для HTTP
- `443` для HTTPS

## 2. Привяжи домен

У домена создай `A`-запись на публичный IP VM.

Пример:

```text
football.example.ru -> 84.xx.xx.xx
```

## 3. Подключись к VM и установи Docker

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker
docker --version
docker compose version
```

## 4. Склонируй проект

```bash
git clone git@github.com:Olegogo/footballmanager.git
cd footballmanager
```

Если на VM нет SSH-доступа к GitHub, можно использовать HTTPS:

```bash
git clone https://github.com/Olegogo/footballmanager.git
cd footballmanager
```

## 5. Заполни `.env`

Создай `.env` рядом с `package.json`.

Пример:

```bash
DOMAIN=football.example.ru
PORT=3000
HOST=0.0.0.0
PUBLIC_BASE_URL=https://football.example.ru
CORS_ALLOWED_ORIGINS=https://football.example.ru,http://localhost:3000
TELEGRAM_BOT_TOKEN=123456:replace_me
DEFAULT_CHAT_ID=-1001234567890
ALLOW_DEV_LOGIN=true
ADMIN_IMPORT_TOKEN=replace_with_long_secret
CHAT_TIMEZONE_OFFSET=+03:00
SCHEDULER_INTERVAL_MS=60000
AUTH_MAX_AGE_SECONDS=86400
```

Важно:

- `DOMAIN` использует `Caddy`
- `PUBLIC_BASE_URL` должен быть полным HTTPS URL
- `DEFAULT_CHAT_ID` ставь уже для целевого чата

## 6. Подними сервис

Из корня проекта:

```bash
docker compose -f deploy/yandex-cloud/docker-compose.yml up -d --build
```

Проверка:

```bash
docker compose -f deploy/yandex-cloud/docker-compose.yml ps
docker compose -f deploy/yandex-cloud/docker-compose.yml logs -f
```

Когда `Caddy` увидит рабочий домен, он сам выпустит HTTPS-сертификат.

## 7. Проверь backend и miniapp

Открой:

```text
https://football.example.ru/health
https://football.example.ru
```

Ожидаемо:

- `/health` возвращает JSON
- `/` открывает miniapp

## 8. Обнови BotFather

В `@BotFather` обнови:

- `Menu Button`
- `Configure Mini App` / `Main Mini App`

URL:

```text
https://football.example.ru
```

## 9. Проверь бота в чате

В целевом чате:

```text
/chatid
/open
```

И проверь:

- бот отвечает
- открывается miniapp
- новый анонс игры парсится

## 10. Импорт истории

Если `history.txt` уже готов локально, импорт можно оставить с твоего компьютера:

```bash
node scripts/import-history-text-remote.js "/absolute/path/to/history.txt" --backend https://football.example.ru --chat-id -1001234567890 --token your_secret
```

## Обновление проекта

На VM:

```bash
cd footballmanager
git pull
docker compose -f deploy/yandex-cloud/docker-compose.yml up -d --build
```

## Почему это самый простой путь

Потому что текущий проект уже:

- работает как обычный Node.js процесс
- использует long polling
- хранит данные в `data/db.json`
- не требует обязательной переделки под webhook/serverless

То есть перенос на `Yandex Cloud VM` — это в основном инфраструктурный шаг, а не переписывание приложения.
