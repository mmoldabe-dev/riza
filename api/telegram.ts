import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendMessage, TelegramUpdate } from "../lib/telegram";
import { parseOrderMessage } from "../lib/parseOrder";
import { parseCatalogUpdate } from "../lib/catalog";
import { deliveryFee } from "../lib/pricing";
import {
  insertOrder,
  deleteLastOrder,
  getDaySummary,
  upsertCatalogItems,
  getCatalog,
} from "../lib/db";
import { todayDateKey, parseDateInput, formatDateKeyRu } from "../lib/date";
import {
  HELP_TEXT,
  formatOrderConfirmation,
  formatDaySummary,
  formatCatalogSaved,
  formatCatalogList,
} from "../lib/format";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    res.status(200).send("ok");
    return;
  }

  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (secret && req.headers["x-telegram-bot-api-secret-token"] !== secret) {
    res.status(401).send("unauthorized");
    return;
  }

  const update = req.body as TelegramUpdate;
  const chatId = update.message?.chat.id;
  const text = update.message?.text;

  if (!chatId || !text) {
    res.status(200).send("ok");
    return;
  }

  try {
    await routeMessage(chatId, text.trim());
  } catch (err) {
    console.error(err);
    await sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте ещё раз.");
  }

  res.status(200).send("ok");
}

async function routeMessage(chatId: number, text: string): Promise<void> {
  const lower = text.toLowerCase();

  if (lower === "/start" || lower === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  if (lower === "/today" || lower === "сегодня") {
    const summary = await getDaySummary(todayDateKey());
    await sendMessage(chatId, formatDaySummary(summary));
    return;
  }

  if (lower.startsWith("/date") || lower.startsWith("/итоги")) {
    const arg = text.replace(/^\/\S+\s*/, "").trim();
    const dateKey = arg ? parseDateInput(arg) : todayDateKey();
    if (!dateKey) {
      await sendMessage(
        chatId,
        "Не понял дату. Формат: /date 21.07.2026"
      );
      return;
    }
    const summary = await getDaySummary(dateKey);
    await sendMessage(chatId, formatDaySummary(summary));
    return;
  }

  if (lower === "/prices" || lower === "/price_list") {
    const catalog = await getCatalog(chatId);
    await sendMessage(chatId, formatCatalogList(catalog));
    return;
  }

  if (lower.startsWith("/price")) {
    const lines = text.split("\n");
    const inlineRest = lines[0].replace(/^\/\S+\s*/, "");
    const body = [inlineRest, ...lines.slice(1)]
      .map((l) => l.trim())
      .filter((l) => l.length > 0)
      .join("\n");

    const parsed = parseCatalogUpdate(body);
    if (!parsed.ok) {
      await sendMessage(chatId, `❗ ${parsed.error}`);
      return;
    }
    await upsertCatalogItems(chatId, parsed.items);
    await sendMessage(chatId, formatCatalogSaved(parsed.items));
    return;
  }

  if (lower === "/undo") {
    const removed = await deleteLastOrder(chatId);
    if (!removed) {
      await sendMessage(chatId, "Нечего отменять — заказов не найдено.");
    } else {
      await sendMessage(
        chatId,
        `🗑 Последний заказ удалён (итого был ${Math.round(removed.total).toLocaleString("ru-RU")} тг, за ${formatDateKeyRu(removed.orderDate)}).`
      );
    }
    return;
  }

  const catalog = await getCatalog(chatId);
  const parsed = parseOrderMessage(text, catalog);
  if (!parsed.ok) {
    await sendMessage(chatId, `❗ ${parsed.error}\n\nОтправьте /help для примера формата.`);
    return;
  }

  const { items, isCity } = parsed.order;
  const itemsTotal = items.reduce((s, i) => s + i.price, 0);
  const fee = deliveryFee(isCity);
  const total = itemsTotal + fee;

  await insertOrder({
    chatId,
    orderDate: todayDateKey(),
    isCity,
    items,
    itemsTotal,
    deliveryFee: fee,
    total,
    rawText: text,
  });

  await sendMessage(
    chatId,
    formatOrderConfirmation({ items, itemsTotal, deliveryFee: fee, total, isCity })
  );
}
