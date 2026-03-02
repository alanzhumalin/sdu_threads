# SDU Student Social Website

A social networking website for students of **SDU University (Kazakhstan)**.  
Students use it to share university life moments (campus, exams, events, daily life) and stay connected in one place.

---

## Key Features

### Posts (Feed)
- Create posts with:
  - **Text description**
  - Optional **hashtags**
  - Optional **media attachments** (photo or video)
- View the main feed where all posts are displayed.
- Interact with posts:
  - **Like**
  - **Comment**
  - **Repost (share)**

### Following (Subscriptions)
- Subscribe to (follow) other users.
- See subscriber/following counts on profiles.

### Search
A search page for discovering people and content:
- Search students by:
  - **Account name**
  - **Username**
- Search by **hashtag**
  - View posts that include a selected hashtag.

### Notifications
A notifications page that shows:
- Incoming activity (e.g., likes, comments, reposts, new followers)
- **Mentions** (when someone tags/mentions you in a post)

### Profiles
Each user has a profile page that includes:
- **Avatar** (can be an image, GIF, or video)
  - If the avatar is a GIF/video, it loops continuously on the profile.
- **Background (cover) image**
- User details:
  - Full name
  - Username
  - Bio (profile description)
- Stats:
  - Subscribers (followers)
  - Subscriptions (following)
- Tabs:
  - **Posts**: all posts created by the user
  - **Liked**: posts liked by the user

### Creating Posts
Students can create posts from:
- The **main feed page**
- Their **profile page**

---

## Purpose
The main goal of this website is to help SDU students maintain connections and share updates through a single dedicated platform.

---

## Environment variables
Create `.env` from `.env.example` before running locally. Key values:
- `APP_ENV`, `APP_PORT` — backend mode and port.
- `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (по умолчанию 55432) — database credentials.
- `DATABASE_URL` — Postgres connection string used by the backend.
- `JWT_SECRET`, `JWT_TTL_HOURS` — ключ и срок жизни JWT (по умолчанию 24ч).
- `RATE_LIMIT_RPM` — лимит запросов в минуту на IP (по умолчанию 120).
- `ADMIN_*` — (опционально) bootstrap admin пользователя (создаётся при старте backend, если не существует):
  - `ADMIN_EMAIL`, `ADMIN_PASSWORD`
  - `ADMIN_USERNAME`, `ADMIN_FULL_NAME` (необязательно)
- `S3_*` — (опционально) S3-совместимое хранилище для медиа (посты/аватар/фон):
  - `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`
  - `S3_ACCESS_KEY`, `S3_SECRET_KEY`
  - `S3_USE_SSL`
  - `S3_SIGNATURE_VERSION` (`v4` по умолчанию; `v2` если провайдер требует)
  - `S3_PUBLIC_BASE_URL` (используется для построения публичных URL)
  - `S3_PREFIX` (опционально; если пусто — без префикса в ключах)
- `MODERATION_*` — внешний FastAPI сервис модерации:
  - `MODERATION_ENABLED` (`true|false`)
  - `MODERATION_URL` (по умолчанию `http://moderation:8001`)
  - `MODERATION_TIMEOUT_MS`
  - `MODERATION_FAIL_CLOSED` (если `true`, при недоступности сервиса контент блокируется)
  - `MODERATION_TEXT_THRESHOLD`, `MODERATION_IMAGE_THRESHOLD`
  - `MODERATION_STORY_MAX_IMAGE_BYTES` (лимит байт для модерации изображения сторис; `0` = без лимита)
  - `MODERATION_SUGGESTIVE_THRESHOLD`, `MODERATION_SUGGESTIVE_GATE_THRESHOLD`, `MODERATION_SUGGESTIVE_STRONG_THRESHOLD`, `MODERATION_BLOCK_SUGGESTIVE`
  - `MODERATION_STORY_SUGGESTIVE_THRESHOLD`, `MODERATION_STORY_SUGGESTIVE_GATE_THRESHOLD`, `MODERATION_STORY_SUGGESTIVE_STRONG_THRESHOLD` (отдельные пороги для сторис)
  - `MODERATION_PROFILE_SUGGESTIVE_THRESHOLD`, `MODERATION_PROFILE_SUGGESTIVE_GATE_THRESHOLD`, `MODERATION_PROFILE_SUGGESTIVE_STRONG_THRESHOLD` (отдельные пороги для avatar/background)
  - `MODERATION_TEXT_MODEL`, `MODERATION_IMAGE_MODEL`, `MODERATION_SUGGESTIVE_MODEL`
  - `MODERATION_TEXT_MODEL_REQUIRED`, `MODERATION_IMAGE_MODEL_REQUIRED`, `MODERATION_SUGGESTIVE_MODEL_REQUIRED`
  - `MODERATION_INFER_MAX_SIDE` (resize только для ML-инференса; исходный файл не меняется)
  - `MODERATION_PRELOAD_MODELS` (прогрев моделей на старте сервиса)
  - `MODERATION_SUGGESTIVE_BG_WARMUP` (фоновый прогрев optional suggestive-модели без блокировки запросов)
  - `MODERATION_BLOCKED_TERMS` (дополнительные слова через запятую)
  - По умолчанию:
    - текст: `s-nlp/russian_toxicity_classifier`
    - NSFW изображения: `Falconsai/nsfw_image_detection`
    - suggestive/купальники: `prithivMLmods/Mature-Content-Detection` (класс `Enticing or Sensual`)
- `CACHE_*` — backend query-cache (L1 memory + Redis L2):
  - `CACHE_ENABLED`
  - `CACHE_REDIS_ADDR`, `CACHE_REDIS_PASSWORD`, `CACHE_REDIS_DB`
  - `CACHE_KEY_PREFIX`
  - `CACHE_L1_MAX_ENTRIES`, `CACHE_L1_CLEANUP_SEC`
  - Кэшируются read-endpoints: `/api/users/search`, `/api/hashtags/search`, `/api/hashtags/popular`, `/api/top-users`, `/api/posts` (только для неавторизованных).
  - Инвалидация:
    - `follow/unfollow` → `top-users`
    - создание поста/комментария с хэштегами → `hashtags:*`
    - создание поста/комментария/like/unlike → публичный feed-cache
    - регистрация/обновление профиля → `users/search` (и `top-users` для profile update)
- `TELEGRAM_*` — Telegram-бот для уведомлений о новых сообщениях в личном чате:
  - `TELEGRAM_NOTIFICATIONS_ENABLED` (`true|false`)
  - `TELEGRAM_BOT_TOKEN` (токен от BotFather)
  - `TELEGRAM_BOT_USERNAME` (без `@`, опционально; если пусто — backend попробует получить через `getMe`)
  - `TELEGRAM_LINK_TTL_MIN` (время жизни кода привязки аккаунта)
  - `TELEGRAM_BOT_POLL_TIMEOUT_SEC` (long-poll timeout для `getUpdates`)
  - `TELEGRAM_NOTIFY_PREVIEW_RUNES` (макс. длина превью текста в push)
  - `APP_PUBLIC_URL` (публичный URL сайта для ссылки “Открыть чат” внутри Telegram)
- Translation (временно отключено): endpoint `/api/translate` и UI-кнопка перевода выключены.

## Логирование и rate limit
- Каждый запрос логируется (method, path, status, длительность, ip, user-agent, user_id если есть токен).
- Rate limit per IP: `RATE_LIMIT_RPM` (HTTP 429 при превышении).

## API (черновик)
- Auth: `POST /api/auth/register`, `POST /api/auth/login` → JWT.
- Users: `POST /api/users` (legacy), `GET /api/users/{id}`, `GET /api/users/me`, `GET /api/users/search?q=`.
- Follow: `POST/DELETE /api/users/{id}/follow`, `GET /api/users/{id}/followers|following`.
- Media: `POST /api/media/upload?purpose=post|story|avatar|background` (Bearer, multipart `files[]`) → `{ items: [{ url }] }`.
  - `purpose=post`: фото до `10MB` и видео до `40MB` (до 5 файлов).
  - `purpose=story`: фото без лимита и видео до `40MB` (до 5 файлов).
- Posts: `POST /api/posts` (Bearer, `{content, media_urls[]?, media_url? (legacy), hashtags[]}`), `GET /api/posts`, `POST/DELETE /api/posts/{id}/like`.
- Stories:
  - `GET /api/stories` — активные сторис (24 часа), сгруппированные по пользователю.
  - `GET /api/stories/{user_id}` — активные сторис конкретного пользователя.
  - `POST /api/stories` (Bearer) — создать сторис (`content` + `media{url,type,width,height}`).
- Comments: `POST /api/comments` `{post_id, content}` (Bearer), `GET /api/comments?post_id=...`, `DELETE /api/comments/{id}`.
- Telegram notifications:
  - `GET /api/telegram/status` (Bearer)
  - `POST /api/telegram/connect` (Bearer) → создать одноразовый код привязки для `/start <code>` в боте
  - `DELETE /api/telegram/connect` (Bearer) → отключить Telegram-уведомления
- Контент автоматически проходит модерацию (текст + NSFW изображения) при создании постов/комментариев и обновлении avatar/background.
- Moderation: `GET /api/moderation/logs?scope=&query=&limit=&offset=` (для moderator/admin) — логи блокировок с причиной, score, labels.
- Hashtags: `GET /api/hashtags/search?q=`, `GET /api/hashtags/{name}/posts`.
- Health: `/healthz`.

## Run locally (Docker)
```bash
docker compose up --build
```

## Load testing (500 users)
Набор скриптов находится в `load/`:
- HTTP/API (k6): `load/k6/http-500.js`
- WebSocket chats list (Artillery): `load/artillery/ws-chats-500.yml`

Перед тестом (важно):
- Используй staging/локальный стенд, не production.
- Для честного теста подними `RATE_LIMIT_RPM` в `.env` (иначе быстро упрёшься в 429).

### 1) Получить JWT для тестов
```bash
LOGIN=someone PASSWORD='your_password' BASE_URL=http://localhost ./load/scripts/get-token.sh
```

### 2) HTTP нагрузка 500 VU (k6)
```bash
TOKEN='<jwt>' BASE_URL=http://localhost TARGET_VUS=500 RAMP_UP=3m HOLD=10m RAMP_DOWN=2m THINK_SEC=1 k6 run load/k6/http-500.js
```

Полезные флаги:
- `ENABLE_WRITE=true WRITE_RATIO=0.03` — добавить небольшую долю write-запросов.
- `ALLOW_429=true` — учитывать 429 как допустимый статус (если проверяешь поведение под rate-limit).

### 3) WebSocket нагрузка ~500 подключений (Artillery)
```bash
TOKEN='<jwt>' WS_BASE_URL=ws://localhost artillery run load/artillery/ws-chats-500.yml
```

### Docker-вариант (если локально нет k6/Artillery)
```bash
TOKEN='<jwt>' docker run --rm -i \
  -e BASE_URL=http://host.docker.internal \
  -e TOKEN="$TOKEN" \
  -e TARGET_VUS=500 -e RAMP_UP=3m -e HOLD=10m -e RAMP_DOWN=2m \
  grafana/k6 run - < load/k6/http-500.js
```

```bash
TOKEN='<jwt>' docker run --rm -it \
  -v "$PWD:/work" -w /work \
  -e TOKEN="$TOKEN" \
  -e WS_BASE_URL=ws://host.docker.internal \
  artilleryio/artillery:latest run load/artillery/ws-chats-500.yml
```

## DB backup/restore (db.dump)
- Каждые 60 минут автоматически создаётся дамп Postgres в формате `.dump` (pg_dump custom) в файле `db.dump` в корне репозитория.
- При старте проекта, если `db.dump` существует и база данных пустая, данные автоматически восстанавливаются из `db.dump`.
- Если нужно восстановить `db.dump` на новом сервере: положите `db.dump` в корень проекта и запустите `docker compose down -v && docker compose up --build`.

## Cloudflare + HTTPS (Origin Certificate)
- Nginx слушает `80` и `443`. Для production за Cloudflare используйте режим SSL/TLS `Full (strict)`.
- Сгенерируйте в Cloudflare `Origin Certificate` и положите файлы:
  - `nginx/certs/cert.pem`
  - `nginx/certs/key.pem`
- Эти файлы игнорируются git и монтируются в контейнер Nginx в `/etc/nginx/certs`.
- Для локальной разработки, если сертификаты не заданы, Nginx автоматически генерирует self-signed сертификат.

## Frontend build (Dockerfile)
Сборка фронта теперь в образе Nginx (multi-stage). Команда:
```bash
docker compose up --build nginx
```
Стадия 1: Node 20 `npm ci && npm run build` из `frontend/`.  
Стадия 2: Nginx собирает статик из `dist` и использует `nginx/nginx.conf`.

## Terms Used
- **Subscriber / Subscription** = follower / following
- **Repost** = resharing someone else’s post
- **Mention** = tagging a user in a post
