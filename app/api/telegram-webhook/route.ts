/**
 * Receives Telegram updates. Verifies the request actually came from
 * Telegram via the secret token you set when registering the webhook
 * (see README) -- without this check, anyone who finds this URL could
 * trigger your bot or waste your Upstash/Telegram quota. Note this only
 * verifies the request is genuinely from Telegram, not who sent the
 * message -- any Telegram user who finds the bot can use these commands.
 *
 * Commands:
 *  - /check: runs the same scan the cron job runs, replies only to
 *    whoever sent it. Real page-change notifications from that scan
 *    still broadcast to everyone subscribed (see lib/notify.ts) -- a
 *    change is real information, not something to keep from other
 *    subscribers just because someone else triggered the check.
 *  - /subscribe, /unsubscribe: opt in/out of the daily broadcast (scan
 *    summary + change notifications). The bot owner (TELEGRAM_CHAT_ID)
 *    always gets the broadcast regardless of this list.
 *  - /lastScan, /lastModified: answer from the last scan's persisted
 *    result (lib/db.ts setLastScanSummary/getLastScanSummary) instead of
 *    triggering a new scan -- "when did we last check" and "what changed
 *    last time" are questions about history, not new work.
 *  - /sitemap: every tracked page, grouped by section, titles as
 *    clickable links -- sent as a few HTML-formatted messages since 355
 *    pages don't fit in one (see lib/sitemap.ts).
 *  - /help: lists these commands.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { sendToRequester } from "@/lib/notify";
import { formatScanSummary, formatChangedDetails, formatIST } from "@/lib/summary";
import { formatSitemapMessages } from "@/lib/sitemap";
import { addSubscriber, removeSubscriber, listAllPageInfo, getLastScanSummary } from "@/lib/db";

export const maxDuration = 60;

const HELP_TEXT = `Commands:
/check - run a scan now, replies here with the result
/subscribe - get the daily scan summary and change alerts
/unsubscribe - stop getting them
/lastScan - when the last scan ran and how many pages it checked
/lastModified - what changed in the last scan
/sitemap - every tracked page, grouped by section
/help - this message`;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await req.json();
  const text: string | undefined = update?.message?.text;
  const chatId: string | undefined = update?.message?.chat?.id?.toString();

  if (!chatId) {
    return NextResponse.json({ ok: true });
  }

  const command = text?.trim();

  if (command === "/help" || command === "/start") {
    await sendToRequester(chatId, HELP_TEXT).catch((e) => console.error("Failed to send /help:", e));
    return NextResponse.json({ ok: true });
  }

  if (command === "/subscribe") {
    try {
      await addSubscriber(chatId);
      await sendToRequester(
        chatId,
        "✅ Subscribed — you'll get the daily scan summary and page-change alerts here from now on."
      );
    } catch (err) {
      console.error("Failed to process /subscribe:", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/unsubscribe") {
    try {
      await removeSubscriber(chatId);
      await sendToRequester(chatId, "Unsubscribed. Message /subscribe any time to opt back in.");
    } catch (err) {
      console.error("Failed to process /unsubscribe:", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/lastScan") {
    try {
      const last = await getLastScanSummary();
      await sendToRequester(
        chatId,
        last
          ? `Last scan: ${formatIST(last.timestamp)}\n${last.checked} page(s) checked.`
          : "No scan has completed yet."
      );
    } catch (err) {
      console.error("Failed to process /lastScan:", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/lastModified") {
    try {
      const last = await getLastScanSummary();
      if (!last) {
        await sendToRequester(chatId, "No scan has completed yet.");
      } else if (last.changedDetails.length === 0) {
        await sendToRequester(chatId, `No pages were modified in the last scan (${formatIST(last.timestamp)}).`);
      } else {
        const lines = [`Modified in the last scan — ${formatIST(last.timestamp)}:`, "", ...formatChangedDetails(last.changedDetails)];
        await sendToRequester(chatId, lines.join("\n").trimEnd());
      }
    } catch (err) {
      console.error("Failed to process /lastModified:", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/sitemap") {
    try {
      const pages = await listAllPageInfo();
      const messages = formatSitemapMessages(pages);
      // ~19 messages for the full 355-page list -- small pacing delay so
      // this doesn't trip Telegram's flood control on rapid same-chat sends.
      for (let i = 0; i < messages.length; i++) {
        await sendToRequester(chatId, messages[i], "HTML");
        if (i < messages.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 400));
        }
      }
    } catch (err) {
      console.error("Failed to process /sitemap:", err);
    }
    return NextResponse.json({ ok: true });
  }

  if (command === "/check") {
    try {
      await sendToRequester(chatId, "Checking now — this takes a minute, hang on...");
    } catch (notifyErr) {
      console.error("Failed to send 'checking now' Telegram message:", notifyErr);
    }
    try {
      const summary = await runScan();
      await sendToRequester(chatId, formatScanSummary(summary));
    } catch (err) {
      console.error("Scan or notify failed:", err);
      try {
        await sendToRequester(chatId, `Scan failed: ${String(err)}`);
      } catch (notifyErr) {
        console.error("Failed to send scan-failure Telegram message:", notifyErr);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
