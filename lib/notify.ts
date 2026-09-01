/**
 * Direct HTTPS calls to Telegram's Bot API. Deliberately not using a
 * wrapper library here -- sendMessage is one HTTP call, a full bot
 * library would be dead weight for this one use.
 *
 * Two delivery modes:
 *  - sendToRequester: replies to whoever's chat sent a command (/check,
 *    /subscribe, ...) -- personal, immediate, not seen by anyone else.
 *  - broadcast: the single consolidated scan-result message (counts +
 *    a digest for each page that changed, see lib/summary.ts) goes to
 *    the owner (TELEGRAM_CHAT_ID) plus everyone who has /subscribe'd
 *    (lib/db.ts) -- a real content change is genuinely relevant to
 *    everyone watching, not just whoever happened to trigger the scan.
 */
import { listSubscribers, removeSubscriber } from "./db";

const MAX_MESSAGE_LEN = 3500;

class TelegramSendError extends Error {
  constructor(public chatId: string, public telegramStatus: number, body: string) {
    super(`Telegram send failed (chat ${chatId}): ${telegramStatus} ${body}`);
  }
}

async function sendToChat(chatId: string, text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error("TELEGRAM_BOT_TOKEN not set");
  }

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new TelegramSendError(chatId, resp.status, body);
  }
}

function truncate(text: string): string {
  return text.length > MAX_MESSAGE_LEN
    ? text.slice(0, MAX_MESSAGE_LEN) + "\n... (truncated)"
    : text;
}

export async function sendToRequester(chatId: string, text: string): Promise<void> {
  await sendToChat(chatId, truncate(text));
}

export async function broadcast(text: string): Promise<void> {
  const ownerChatId = process.env.TELEGRAM_CHAT_ID;
  if (!ownerChatId) {
    throw new Error("TELEGRAM_CHAT_ID not set");
  }

  const subscribers = await listSubscribers();
  const recipients = [...new Set([ownerChatId, ...subscribers])];
  const message = truncate(text);
  const results = await Promise.allSettled(recipients.map((id) => sendToChat(id, message)));

  let failures = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status !== "rejected") continue;
    failures++;
    const chatId = recipients[i];
    console.error(`broadcast: send to ${chatId} failed:`, r.reason);
    // A subscriber who blocked the bot will fail every future broadcast
    // forever unless removed -- the owner's env-configured chat ID is
    // exempt, they're not part of the subscriber set to begin with.
    if (r.reason instanceof TelegramSendError && r.reason.telegramStatus === 403 && chatId !== ownerChatId) {
      await removeSubscriber(chatId).catch((e) => console.error(`Failed to remove blocked subscriber ${chatId}:`, e));
    }
  }

  if (failures === recipients.length) {
    throw new Error(`broadcast failed for all ${recipients.length} recipient(s)`);
  }
}
