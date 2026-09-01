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
 *  - /diff <url>: change broadcasts are a one-line digest, not the full
 *    diff (see lib/notify.ts) -- this retrieves the full diff for a
 *    specific page on request, replying only to whoever asked.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { sendToRequester } from "@/lib/notify";
import { formatScanSummary } from "@/lib/summary";
import { addSubscriber, removeSubscriber, getLastDiff } from "@/lib/db";

export const maxDuration = 60;

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

  if (command?.startsWith("/diff ")) {
    const url = command.slice("/diff ".length).trim();
    try {
      const diff = await getLastDiff(url);
      await sendToRequester(
        chatId,
        diff
          ? `📄 Full diff for ${url}:\n\n${diff}`
          : `No stored diff for that URL — either it hasn't changed recently, or the URL doesn't match exactly (copy it from the notification message).`
      );
    } catch (err) {
      console.error("Failed to process /diff:", err);
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
