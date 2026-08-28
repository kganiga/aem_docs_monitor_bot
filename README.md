# aem-docs-watcher-next

Same bot, rearchitected for Vercel: Next.js API routes, triggered either
by Vercel Cron (daily) or by a `/check` command sent to your Telegram bot
(on-demand). No server to manage — but see "What this costs you" below,
this isn't free of trade-offs, just a different set of them.

## What changed from the Python/VM version, concretely

- **Trigger:** Vercel Cron (daily, free on Hobby) + Telegram webhook
  (`/check` command) instead of a single cron line on a VM.
- **Fetching:** batched concurrent requests (10 at a time) instead of
  sequential-with-delay — required to fit inside the serverless timeout.
  This is objectively less polite to Adobe's servers than the original
  one-at-a-time approach; 10 concurrent requests once a day is still
  light, but it's a real trade-off, not a free improvement.
- **Storage:** Upstash Redis (hosted, free tier) instead of a local
  SQLite file. **This is the one piece that isn't self-hosted** — see
  `lib/db.ts` for why serverless functions require this.
- **Language:** TypeScript/Node instead of Python. `cheerio` replaces
  `BeautifulSoup`, `diff` (jsdiff) replaces `difflib`, native `fetch`
  replaces `requests`.

## Setup

### 1. Telegram bot (same as before)
Message `@BotFather` → `/newbot` → copy the token. Message your bot once,
then get your chat ID from `@userinfobot` or the `getUpdates` endpoint.

### 2. Upstash Redis (free tier)
Go to [upstash.com](https://upstash.com), create a free Redis database.
Copy the REST URL and REST token it gives you — you'll need both.

### 3. Deploy to Vercel
Push this to a GitHub repo, import it in Vercel. Before your first deploy,
set these environment variables in the Vercel project settings:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
CRON_SECRET=<any random string you generate yourself>
TELEGRAM_WEBHOOK_SECRET=<another random string you generate yourself>
```

`CRON_SECRET` and `TELEGRAM_WEBHOOK_SECRET` aren't from anywhere else —
you're inventing these yourself (e.g. `openssl rand -hex 32`) so that
your API routes can verify a request actually came from Vercel Cron / Telegram,
and not from some random person who found your URL.

### 4. Register the Telegram webhook
Once deployed, tell Telegram where to send updates (replace both placeholders):

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://<your-vercel-app>.vercel.app/api/telegram-webhook" \
  -d "secret_token=<same value as TELEGRAM_WEBHOOK_SECRET>"
```

## Before you trust this for real — same two checks as the Python version, still required

**1. Validate the URL list.** Run locally:
```bash
npm install
node scripts/validate-urls.mjs
```
Writes `config/urls_verified.json`. `lib/scan.ts` imports that file
directly, so re-run this whenever `config/urls.json` changes and check
the output before trusting it.

> **Provenance note (2026-08-29):** the original 105-URL list was
> mechanically generated and only 2 samples were ever confirmed live —
> 74 of them turned out to be dead links (Adobe had restructured several
> doc paths, e.g. `administering/msm/*` moved to
> `administering/reusing-content/msm/*`). Both `config/urls.json` and
> `config/urls_verified.json` were regenerated from Adobe's own sitemap
> (`https://experienceleague.adobe.com/en/sitemap.xml`, filtered to the
> `experience-manager-cloud-service/content/sites/` path) and every one
> of the resulting 140 URLs was confirmed with a live `200 OK` before
> being committed. Re-run `validate-urls.mjs` periodically — sitemaps
> and doc structures both drift over time.

**2. Verify content extraction isn't picking up junk.** Run locally:
```bash
node scripts/debug-scrape.mjs https://experienceleague.adobe.com/en/docs/experience-manager-cloud-service/content/sites/sites-cloud-changes
```
Read the output. Nav links / cookie banners / related-articles text
instead of the article body means `CONTENT_SELECTORS` in
`lib/scraper.ts` needs adjusting based on the real page HTML.

## Using it

- **Daily automatic:** Vercel Cron hits `/api/cron` once a day
  (`0 8 * * *` in `vercel.json` — **this is UTC**, adjust for your
  timezone; 8am UTC is 1:30pm IST).
- **On-demand:** message your bot `/check` any time.
- First run of either seeds Redis with baseline hashes — no
  notifications that first time, same as the original version.

## What this costs you, honestly, compared to the VM/Pi version

- One more account to manage (Upstash), one more thing that could
  change its free-tier terms later — the exact pattern that ruled out
  Oracle, Fly.io, and Netlify earlier in this build. Nothing stops that
  from eventually happening to Upstash too.
- Less polite scraping (concurrent batches vs. sequential-with-delay).
- More moving parts to reason about when something breaks: was it the
  Vercel deploy, the cron trigger, the Telegram webhook registration,
  or Upstash — versus one Python process and one cron line on a box
  you fully control.
- In exchange: no server to patch, no SSH, deploys on git push.

Same unresolved item as before, unavoidable no matter the architecture:
the content selector is a best-effort guess, not verified against live
Adobe HTML from this build environment. Check #2 above before turning
on real notifications.
