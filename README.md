# aem-docs-watcher-next

A Telegram bot that watches Adobe Experience Manager (AEM) Cloud Service
documentation on Experience League and messages you when a page's content
actually changes. Runs entirely on Vercel + Upstash Redis — no server to
manage.

## What it does

- **Tracks 355 AEM Cloud Service doc pages** — both the Sites
  feature/admin/authoring docs and the separate developer-facing
  "implementing" docs (component development, extending AEM, deploying,
  developer tools, etc.).
- **Discovers the URL list itself**, fresh, from Adobe's own sitemap on
  every run (`lib/discover.ts`) — pages Adobe adds or removes are picked
  up automatically, nothing to maintain by hand.
- **Diffs real content**, not raw HTML: strips nav/sidebar/cookie-banner/
  related-articles junk (`lib/scraper.ts`), hashes what's left, and only
  flags a page as "changed" when that hash moves.
- **Notifies over Telegram**: a diff excerpt for each page that changed,
  plus one consolidated summary per run (timestamp in IST, pages checked,
  and counts + URL lists for updated / added / removed / failed).
- **Runs two ways**: automatically once a day via Vercel Cron, or
  on-demand — message the bot `/check` any time.
- **Multiple people can subscribe**: `/subscribe` opts a chat into the
  daily summary + change alerts; `/unsubscribe` opts out. The bot owner
  (`TELEGRAM_CHAT_ID`) always gets them regardless. `/check` itself stays
  personal — the reply goes only to whoever asked — but a real page
  change found during anyone's `/check` still broadcasts to everyone
  subscribed, since that's genuinely new information for the whole group.
- **State lives in Upstash Redis** (hosted, free tier) — the one piece
  that isn't self-hosted; serverless functions have no persistent local
  disk, so something external has to hold state between runs.

## Setup

### 1. Clone and install
```bash
git clone https://github.com/kganiga/aem_docs_monitor_bot.git
cd aem_docs_monitor_bot
npm install
```

### 2. Telegram bot
Message `@BotFather` → `/newbot` → copy the token. Message your new bot
once (anything), then get your chat ID from `@userinfobot` (it replies
instantly with your numeric `Id`) — needed since Telegram won't let a bot
message you first.

### 3. Upstash Redis (free tier)
Go to [upstash.com](https://upstash.com), create a free Redis database.
Copy the REST URL and REST token — you'll need both.

### 4. Deploy to Vercel
Push this repo to your own GitHub, import it in Vercel (auto-deploys on
every push to `master` after that). Before the first deploy, set these
environment variables in the Vercel project settings:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
CRON_SECRET=<any random string you generate yourself>
TELEGRAM_WEBHOOK_SECRET=<another random string you generate yourself>
```

`CRON_SECRET` and `TELEGRAM_WEBHOOK_SECRET` aren't from anywhere else —
invent these yourself (e.g. `openssl rand -hex 32`) so the API routes can
verify a request actually came from Vercel Cron / Telegram, not from
whoever finds the URL. Changing an env var requires a redeploy to take
effect on an existing deployment.

### 5. Register the Telegram webhook
Once deployed, tell Telegram where to send updates:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-vercel-app>.vercel.app/api/telegram-webhook" \
  -d "secret_token=<same value as TELEGRAM_WEBHOOK_SECRET>"
```

Verify it took: `curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"`
should show your URL with no `last_error_message`.

### 6. First run
Message your bot `/check`, or wait for the daily cron
(`0 8 * * *` in `vercel.json` — UTC; adjust for your timezone). The first
run seeds Redis with baseline content hashes for all 355 pages — expect a
summary showing everything under "Added", nothing under "Updated" (there's
nothing yet to diff against).

## Using it day to day

- **Daily automatic:** Vercel Cron hits `/api/cron` once a day.
- **On-demand:** message your bot `/check` any time — same scan, same
  summary format, immediate, replies only to you.
- **`/subscribe`** to have another Telegram chat also receive the daily
  summary and change alerts; **`/unsubscribe`** to stop.
- Every scan sends one summary message (timestamp in IST, checked count,
  and what's updated/added/removed/failed) to whoever should see it, plus
  an individual message with a diff excerpt for each page whose content
  actually changed, broadcast to the owner and all subscribers.

## Before you trust this for real

**Verify content extraction isn't picking up junk.** Run locally:
```bash
node scripts/debug-scrape.mjs https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/sites-cloud-changes
```
Read the output. Nav links / cookie banners / related-articles text
instead of the article body means `CONTENT_SELECTORS` in
`lib/scraper.ts` needs adjusting based on the real page HTML.

**Re-generate the fallback list occasionally.** `lib/scan.ts` pulls the
live URL list from Adobe's sitemap on every run — `config/urls_verified.json`
is only the fallback `lib/discover.ts` falls back to if that live fetch
ever fails or looks malformed. Regenerate it with:
```bash
node scripts/validate-urls.mjs
```

> **Provenance note (2026-08-29):** the original 105-URL list was
> mechanically generated and only 2 samples were ever confirmed live — 74
> of them had gone dead (Adobe restructures doc paths over time, e.g.
> `administering/msm/*` → `administering/reusing-content/msm/*`), and the
> list only covered Sites docs, missing the separate `implementing/`
> developer docs tree entirely. Both gaps are why `lib/discover.ts` now
> derives the list from Adobe's sitemap live on every run instead of a
> static file that can silently rot.

## What this costs you, honestly

- One more account to manage (Upstash), one more thing that could change
  its free-tier terms later.
- Less polite scraping than a slow sequential crawl would be — batches of
  20 concurrent requests once a day. Still nowhere near hammering the
  site, but a real trade-off, not a free improvement.
- Fetching Adobe's full sitemap (~75MB, every product/locale, no
  server-side filtering available) on every run costs a few seconds of
  function time, in exchange for never needing to hand-maintain a URL
  list again.
- More moving parts to reason about when something breaks: was it the
  Vercel deploy, the cron trigger, the Telegram webhook registration, or
  Upstash — versus one process on a box you fully control.
- In exchange: no server to patch, no SSH, deploys on git push.

The content selector (`CONTENT_SELECTORS` in `lib/scraper.ts`) remains a
best-effort guess tuned against real Experience League HTML, not a
guarantee it'll hold for every future template change — check #1 above
periodically.
