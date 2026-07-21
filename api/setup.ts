import type { VercelRequest, VercelResponse } from "@vercel/node";

// Visit this endpoint once after deploying (with the secret query param) to register
// the Telegram webhook, e.g. https://<project>.vercel.app/api/setup?secret=<TELEGRAM_WEBHOOK_SECRET>
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;

  if (!botToken) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN is not set in project env vars" });
    return;
  }
  if (!secret) {
    res.status(500).json({ error: "TELEGRAM_WEBHOOK_SECRET is not set in project env vars" });
    return;
  }
  if (req.query.secret !== secret) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const webhookUrl = `https://${host}/api/telegram`;

  const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, secret_token: secret }),
  });
  const body = await tgRes.json();

  res.status(tgRes.ok ? 200 : 500).json({ webhookUrl, telegram: body });
}
