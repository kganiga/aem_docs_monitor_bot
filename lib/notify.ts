/**
 * Direct HTTPS call to Telegram's Bot API. Deliberately not using a
 * wrapper library here -- sendMessage is one HTTP call, a full bot
 * library would be dead weight for this one use.
 */
const MAX_MESSAGE_LEN = 3500;

export async function sendUpdateNotification(url: string, diffExcerpt: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
  }

  let text = `📄 Doc updated:\n${url}\n\n${diffExcerpt}`;
  if (text.length > MAX_MESSAGE_LEN) {
    text = text.slice(0, MAX_MESSAGE_LEN) + "\n... (truncated, see URL)";
  }

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram send failed: ${resp.status} ${body}`);
  }
}

export async function sendPlainMessage(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error("TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
  }

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Telegram send failed: ${resp.status} ${body}`);
  }
}
