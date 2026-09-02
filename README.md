# Inhouse Scheduler

Agency social scheduler. Drop videos into an account set → random slots inside the set's posting window → AI captions from the audio transcript → one review screen → Zernio publishes to Instagram, TikTok and Facebook.

## How it works

1. **Upload** a video to an account set. It immediately gets a random slot: `postsPerDay` per day inside the set's window, never within 10 minutes of another post on that set, walking forward day by day until every video has a slot (14 videos at 2/day = 7 days out).
2. The **worker** extracts the audio (ffmpeg), transcribes it (Whisper), writes a caption (GPT) using the set's brand guidance, and runs the banned-word check. A caption that trips the list is regenerated once; if it still trips, or the AI fails, the set's **default caption** is used. The transcript is also checked — hits show as a yellow warning because the *video* is the risk, not the caption.
3. **Review**: edit captions/times inline, then approve.
4. Approved posts are handed to Zernio **3 days before their slot** (`SUBMIT_LEAD_DAYS`). Zernio media uploads expire after 7 days, so the app owns the long-range schedule and Zernio only ever holds the near-term queue.
5. Zernio publishes. Status comes back via webhook (or polling). Once **published**, the video file is deleted from the server. Failed posts keep their file so you can retry.

## Requirements

- A VPS (Ubuntu 22.04+, 2+ GB RAM) with **nginx** already installed, and a subdomain pointed at it (A record).
- Zernio account + API key. Instagram accounts must be **Business or Creator**; Facebook must be a **Page** you admin.
- OpenAI API key.

The app runs in Docker and listens on `127.0.0.1:3000` only. Your existing nginx keeps ports 80/443 and proxies to it, so anything already hosted on the box is untouched.

> **Docker and ufw:** Docker writes its own iptables rules and bypasses `ufw`. Any port published as `3000:3000` would be reachable from the internet regardless of your firewall. That's why the compose file binds to `127.0.0.1:3000`. Don't change it.

## Deploy (Ubuntu + existing nginx)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sudo sh

# 2. Get the code
sudo git clone https://github.com/bumpier/inhouse-scheduler.git /opt/inhouse-scheduler
cd /opt/inhouse-scheduler

# 3. Configure
cp .env.example .env
nano .env        # fill in every value — see below

# 4. Start (does not touch nginx or ports 80/443)
docker compose up -d --build
docker compose logs -f app worker      # watch first boot
curl -I http://127.0.0.1:3000/login    # expect 200
```

Then add the nginx vhost:

```bash
# 5. Install the vhost
sudo cp deploy/nginx-scheduler.conf /etc/nginx/sites-available/scheduler
sudo ln -s /etc/nginx/sites-available/scheduler /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# 6. HTTPS
sudo certbot --nginx -d scheduler.shifalabsops.com
```

`nginx -t` before reload is the safety net — if the new file is wrong it fails there and your existing site keeps running.

The vhost sets `client_max_body_size 1G`; nginx's 1 MB default would reject every video upload.

Open `https://scheduler.shifalabsops.com` and sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

### `.env` values

| Key | What |
|---|---|
| `APP_URL` | `https://scheduler.shifalabsops.com` — must match the vhost, no trailing slash |
| `APP_PORT` | `3000`; change only if that localhost port is already taken |
| `POSTGRES_PASSWORD` | anything random |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | first login; add more users in Settings afterwards |
| `ZERNIO_API_KEY` | from Zernio dashboard |
| `ZERNIO_WEBHOOK_SECRET` | `openssl rand -hex 32` — then paste the same value into the Zernio webhook (below) |
| `OPENAI_API_KEY` | from OpenAI |
| `SUBMIT_LEAD_DAYS` | keep at 3 (must stay under 6) |

### Zernio webhook (recommended; otherwise status is polled every 30 s near post time)

Zernio dashboard → Webhooks → add:
- URL: `https://scheduler.shifalabsops.com/api/zernio/webhook` (exact path — `/api/` alone will 404)
- Secret: the value of `ZERNIO_WEBHOOK_SECRET`
- Events: all `post.*`

### First set

Account sets → create → Connect Instagram / TikTok / Facebook (Zernio's OAuth page, then you're sent back) → fill in caption guidance and a default caption → Save. Then Upload.

**Do one real test post first** with one account before loading 10+ sets. Confirm TikTok's allowed privacy level (unaudited API access often only allows "SELF_ONLY" = private) and that Instagram accepts the video spec (vertical, ≤ 90 s for reels per Zernio docs, ≤ 300 MB).

## Secrets

**This repository is public.** No secrets are committed — every key lives in `.env` on the server, which is gitignored and must stay that way.

- Never `git add -f .env`, and never paste a real key into `.env.example`, the README, or an issue.
- If a key does get committed, deleting it in a later commit is **not** enough — it stays in the history and public repos are scraped within minutes. Rotate the key immediately (new Zernio API key, new OpenAI key), then clean history with `git filter-repo` or delete and recreate the repo.
- `SESSION_SECRET` and `ZERNIO_WEBHOOK_SECRET` are generated per install (`openssl rand -hex 32`) and are never shared between environments.
- Back up `.env` somewhere private (password manager). It is the one file on the VPS that isn't in git and can't be regenerated.

## Operating

```bash
docker compose logs -f worker            # caption + submission log
git pull && docker compose up -d --build              # update
docker compose exec db pg_dump -U scheduler scheduler > backup.sql   # backup
```

Nightly backup: `crontab -e` →
`0 3 * * * cd /path/to/inhouse-scheduler && docker compose exec -T db pg_dump -U scheduler scheduler | gzip > /root/backups/scheduler-$(date +\%F).sql.gz`
Then copy `/root/backups` off the box (rclone to Drive/S3, or similar). Videos are disposable; the database is not.

Disk: videos are deleted on publish. If a set has a backlog of failed posts, their files stay until you retry or cancel them. `docker system prune` occasionally for old images.

## Git

Remote is already configured (`https://github.com/bumpier/inhouse-scheduler.git`, branch `main`).

```bash
git add -A && git commit -m "what changed"
git push
```

To deploy the change on the VPS:

```bash
cd /opt/inhouse-scheduler
git pull && docker compose up -d --build
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
