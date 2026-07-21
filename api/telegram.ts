import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
  sendMessage,
  editMessageText,
  answerCallbackQuery,
  TelegramUpdate,
} from "../lib/telegram";
import { parseOrderMessage } from "../lib/parseOrder";
import { parseCatalogUpdate } from "../lib/catalog";
import { deliveryFee } from "../lib/pricing";
import {
  insertOrder,
  deleteLastOrder,
  getDaySummary,
  upsertCatalogItems,
  getCatalog,
  getDraft,
  saveDraft,
  clearDraft,
} from "../lib/db";
import { todayDateKey, parseDateInput, formatDateKeyRu } from "../lib/date";
import {
  HELP_TEXT,
  formatOrderConfirmation,
  formatDaySummary,
  formatCatalogSaved,
  formatCatalogList,
} from "../lib/format";
import {
  emptyDraft,
  renderProductList,
  renderQuantity,
  renderCityChoice,
  draftItemsTotal,
} from "../lib/orderFlow";

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

  try {
    if (update.callback_query) {
      await routeCallback(update.callback_query);
    } else if (update.message?.chat.id && update.message.text) {
      await routeMessage(update.message.chat.id, update.message.text.trim());
    }
  } catch (err) {
    console.error(err);
    const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
    if (chatId) {
      await sendMessage(chatId, "⚠️ Произошла ошибка. Попробуйте ещё раз.");
    }
  }

  res.status(200).send("ok");
}

async function routeMessage(chatId: number, text: string): Promise<void> {
  const lower = text.toLowerCase();

  if (lower === "/start" || lower === "/help") {
    await sendMessage(chatId, HELP_TEXT);
    return;
  }

  if (lower === "/order" || lower === "/заказ") {
    const catalog = await getCatalog(chatId);
    if (catalog.size === 0) {
      await sendMessage(
        chatId,
        "Прайс пуст — сначала сохраните товары командой /price, либо пишите заказ текстом (см. /help)."
      );
      return;
    }
    const draft = emptyDraft();
    const { text: msgText, keyboard } = renderProductList(catalog, draft);
    const messageId = await sendMessage(chatId, msgText, keyboard);
    draft.messageId = messageId;
    await saveDraft(chatId, draft);
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
      await sendMessage(chatId, "Не понял дату. Формат: /date 21.07.2026");
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
  const itemsTotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
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

async function routeCallback(
  callback: NonNullable<TelegramUpdate["callback_query"]>
): Promise<void> {
  const chatId = callback.message?.chat.id;
  const messageId = callback.message?.message_id;
  const data = callback.data;

  if (!chatId || !messageId || !data) {
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "noop") {
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "cancel") {
    await clearDraft(chatId);
    await editMessageText(chatId, messageId, "Отменено.");
    await answerCallbackQuery(callback.id);
    return;
  }

  const draft = await getDraft(chatId);
  if (!draft) {
    await answerCallbackQuery(callback.id, "Сессия истекла, начните заново: /order");
    return;
  }

  const catalog = await getCatalog(chatId);

  if (data.startsWith("pick:")) {
    const key = data.slice("pick:".length);
    const item = catalog.get(key);
    if (!item) {
      await answerCallbackQuery(callback.id, "Товар не найден в прайсе");
      return;
    }
    const existing = draft.items.find((i) => i.name === item.name);
    draft.state = "picking_quantity";
    draft.currentKey = key;
    draft.currentQuantity = existing?.quantity ?? 1;
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderQuantity(item, draft.currentQuantity);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "qty:inc" || data === "qty:dec") {
    if (!draft.currentKey) {
      await answerCallbackQuery(callback.id);
      return;
    }
    const item = catalog.get(draft.currentKey);
    if (!item) {
      await answerCallbackQuery(callback.id, "Товар не найден в прайсе");
      return;
    }
    draft.currentQuantity =
      data === "qty:inc"
        ? draft.currentQuantity + 1
        : Math.max(1, draft.currentQuantity - 1);
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderQuantity(item, draft.currentQuantity);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "qty:confirm") {
    if (!draft.currentKey) {
      await answerCallbackQuery(callback.id);
      return;
    }
    const item = catalog.get(draft.currentKey);
    if (!item) {
      await answerCallbackQuery(callback.id, "Товар не найден в прайсе");
      return;
    }
    draft.items = draft.items.filter((i) => i.name !== item.name);
    draft.items.push({ name: item.name, price: item.price, quantity: draft.currentQuantity });
    draft.state = "picking_product";
    draft.currentKey = null;
    draft.currentQuantity = 1;
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderProductList(catalog, draft);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id, "Добавлено");
    return;
  }

  if (data === "qty:back") {
    draft.state = "picking_product";
    draft.currentKey = null;
    draft.currentQuantity = 1;
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderProductList(catalog, draft);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "finish") {
    if (draft.items.length === 0) {
      await answerCallbackQuery(callback.id, "Сначала выберите хотя бы один товар");
      return;
    }
    draft.state = "picking_city";
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderCityChoice(draft);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "city:back") {
    draft.state = "picking_product";
    await saveDraft(chatId, draft);
    const { text, keyboard } = renderProductList(catalog, draft);
    await editMessageText(chatId, messageId, text, keyboard);
    await answerCallbackQuery(callback.id);
    return;
  }

  if (data === "city:city" || data === "city:outside") {
    const isCity = data === "city:city";
    const itemsTotal = draftItemsTotal(draft.items);
    const fee = deliveryFee(isCity);
    const total = itemsTotal + fee;

    await insertOrder({
      chatId,
      orderDate: todayDateKey(),
      isCity,
      items: draft.items,
      itemsTotal,
      deliveryFee: fee,
      total,
      rawText: "[кнопки /order]",
    });
    await clearDraft(chatId);

    const text = formatOrderConfirmation({
      items: draft.items,
      itemsTotal,
      deliveryFee: fee,
      total,
      isCity,
    });
    await editMessageText(chatId, messageId, text);
    await answerCallbackQuery(callback.id, "Заказ сохранён");
    return;
  }

  await answerCallbackQuery(callback.id);
}
