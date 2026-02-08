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

## Логирование и rate limit
- Каждый запрос логируется (method, path, status, длительность, ip, user-agent, user_id если есть токен).
- Rate limit per IP: `RATE_LIMIT_RPM` (HTTP 429 при превышении).

## API (черновик)
- Auth: `POST /api/auth/register`, `POST /api/auth/login` → JWT.
- Users: `POST /api/users` (legacy), `GET /api/users/{id}`, `GET /api/users/me`, `GET /api/users/search?q=`.
- Follow: `POST/DELETE /api/users/{id}/follow`, `GET /api/users/{id}/followers|following`.
- Media: `POST /api/media/upload?purpose=post|avatar|background` (Bearer, multipart `files[]`) → `{ items: [{ url }] }`.
- Posts: `POST /api/posts` (Bearer, `{content, media_urls[]?, media_url? (legacy), hashtags[]}`), `GET /api/posts`, `POST/DELETE /api/posts/{id}/like`.
- Comments: `POST /api/comments` `{post_id, content}` (Bearer), `GET /api/comments?post_id=...`, `DELETE /api/comments/{id}`.
- Hashtags: `GET /api/hashtags/search?q=`, `GET /api/hashtags/{name}/posts`.
- Health: `/healthz`.

## Run locally (Docker)
```bash
docker compose up --build
```

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
