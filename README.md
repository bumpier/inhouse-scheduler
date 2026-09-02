# Inhouse Scheduler

Agency social scheduler. Drop videos into an account set → random slots inside the set's posting window → AI captions from the audio transcript → one review screen → Zernio publishes to Instagram, TikTok and Facebook.

## How it works

1. **Upload** a video to an account set. It immediately gets a random slot: `postsPerDay` per day inside the set's window, never within 10 minutes of another post on that set, walking forward day by day until every video has a slot (14 videos at 2/day = 7 days out).
2. The **worker** extracts the audio (ffmpeg), transcribes it (Whisper), writes a caption (GPT) using the set's brand guidance, and runs the banned-word check. A caption that trips the list is regenerated once; if it still trips, or the AI fails, the set's **default caption** is used. The transcript is also checked — hits show as a yellow warning because the *video* is the risk, not the caption.
3. **Review**: edit captions/times inline, then approve.
4. Approved posts are handed to Zernio **3 days before their slot** (`SUBMIT_LEAD_DAYS`). Zernio media uploads expire after 7 days, so the app owns the long-range schedule and Zernio only ever holds the near-term queue.
5. Zernio publishes. Status comes back via webhook (or polling). Once **published**, the video file is deleted from the server. Failed posts keep their file so you can retry.

## Requirements

- A VPS (Ubuntu 22.04/24.04, 2+ GB RAM). A domain pointed at it (A record) — Caddy gets HTTPS automatically.
- Zernio account + API key. Instagram accounts must be **Business or Creator**; Facebook must be a **Page** you admin.
- OpenAI API key.

## Deploy (Ubuntu)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER && newgrp docker

# 2. Get the code
git clone https://github.com/YOUR-ORG/inhouse-scheduler.git
cd inhouse-scheduler

# 3. Configure
cp .env.example .env
nano .env        # fill in every value — see below

# 4. Run
docker compose up -d --build
docker compose logs -f app worker   # watch first boot
```

Open `https://your-domain` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### `.env` values

| Key | What |
|---|---|
| `DOMAIN` | e.g. `scheduler.yourdomain.com` (Caddy uses it for HTTPS). |
| `APP_URL` | `https://scheduler.yourdomain.com` — must match, no trailing slash |
| `POSTGRES_PASSWORD` | anything random |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first login; add more users in Settings afterwards |
| `ZERNIO_API_KEY` | from Zernio dashboard |
| `ZERNIO_WEBHOOK_SECRET` | `openssl rand -hex 32` — then paste the same value into the Zernio webhook (below) |
| `OPENAI_API_KEY` | from OpenAI |
| `SUBMIT_LEAD_DAYS` | keep at 3 (must stay under 6) |

### Zernio webhook (recommended; otherwise status is polled every 30 s near post time)

Zernio dashboard → Webhooks → add:
- URL: `https://your-domain/api/zernio/webhook`
- Secret: the value of `ZERNIO_WEBHOOK_SECRET`
- Events: all `post.*`

### First set

Account sets → create → Connect Instagram / TikTok / Facebook (Zernio's OAuth page, then you're sent back) → fill in caption guidance and a default caption → Save. Then Upload.

**Do one real test post first** with one account before loading 10+ sets. Confirm TikTok's allowed privacy level (unaudited API access often only allows "SELF_ONLY" = private) and that Instagram accepts the video spec (vertical, ≤ 90 s for reels per Zernio docs, ≤ 300 MB).

## Operating

```bash
docker compose logs -f worker            # caption + submission log
docker compose pull && docker compose up -d --build   # update after git pull
docker compose exec db pg_dump -U scheduler scheduler > backup.sql   # backup
```

Nightly backup: `crontab -e` →
`0 3 * * * cd /path/to/inhouse-scheduler && docker compose exec -T db pg_dump -U scheduler scheduler | gzip > /root/backups/scheduler-$(date +\%F).sql.gz`
Then copy `/root/backups` off the box (rclone to Drive/S3, or similar). Videos are disposable; the database is not.

Disk: videos are deleted on publish. If a set has a backlog of failed posts, their files stay until you retry or cancel them. `docker system prune` occasionally for old images.

## Pushing to GitHub (first time)

```bash
cd inhouse-scheduler
git init && git add -A && git commit -m "Initial import"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/inhouse-scheduler.git
git push -u origin main
```

## Local development

```bash
npm install
cp .env.example .env   # point DATABASE_URL at a local Postgres
npx prisma db push
npm run dev            # web on :3000
npm run worker         # in a second terminal
npm test               # scheduler + blocklist unit tests
```

Set `ZERNIO_BASE_URL` / `OPENAI_BASE_URL` to mock servers to develop without spending money.

## Layout

```
src/app/            Next.js pages + server actions + API routes
  (app)/review      review table
  (app)/upload      drop zone
  (app)/schedule    queue + status + retry/cancel
  (app)/sets        account sets, connect accounts, per-set settings
  (app)/settings    users, global banned words, integration status
  api/upload        streamed upload + sha256 dedupe + slot assignment
  api/video/[id]    preview stream
  api/zernio/*      OAuth return + signed webhook
src/lib/
  scheduler.ts      random slot picker (pure, tested)
  blocklist.ts      banned-word matcher with leetspeak/spacing normalisation (pure, tested)
  pipeline.ts       caption pipeline, Zernio submission, status sync, cleanup
  zernio.ts         REST client
  ai.ts             ffmpeg + Whisper + caption prompt
src/worker/         30-second loop calling pipeline functions
prisma/schema.prisma
```

## Known limits / v2 ideas

- One caption for all platforms (per-platform variants are a small change: `customContent` per target).
- No per-client user permissions — every user sees every set.
- Slot times are per set, not per platform; all platforms in a set post the same video at the same time.
- Video thumbnails are the raw `<video>` element; no poster generation.
