/**
 * Receives Telegram updates. Verifies the request actually came from
 * Telegram via the secret token you set when registering the webhook
 * (see README) -- without this check, anyone who finds this URL could
 * trigger your bot or waste your Upstash/Telegram quota.
 *
 * Responds to /check by running the same scan the cron job runs.
 * This is the "user prompts the bot, it does the background work"
 * flow you asked for.
 */
import { NextRequest, NextResponse } from "next/server";
import { runScan } from "@/lib/scan";
import { sendPlainMessage } from "@/lib/notify";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (!process.env.TELEGRAM_WEBHOOK_SECRET || secret !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const update = await req.json();
  const text: string | undefined = update?.message?.text;

  if (text?.trim() === "/check") {
    try {
      await sendPlainMessage("Checking now — this takes a minute, hang on...");
    } catch (notifyErr) {
      console.error("Failed to send 'checking now' Telegram message:", notifyErr);
    }
    try {
      const summary = await runScan();
      const parts = [
        summary.changed.length > 0
          ? `${summary.changed.length} page(s) changed (sent above)`
          : "no content changes",
      ];
      if (summary.newlyTracked.length > 0) {
        parts.push(`${summary.newlyTracked.length} new page(s) discovered`);
      }
      if (summary.failed.length > 0) {
        parts.push(`${summary.failed.length} failed to fetch`);
      }
      await sendPlainMessage(`Done. ${parts.join(", ")}.`);
    } catch (err) {
      console.error("Scan or notify failed:", err);
      try {
        await sendPlainMessage(`Scan failed: ${String(err)}`);
      } catch (notifyErr) {
        console.error("Failed to send scan-failure Telegram message:", notifyErr);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
