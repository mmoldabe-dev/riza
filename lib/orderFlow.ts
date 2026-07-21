import { CatalogItem, OrderItem } from "./parseOrder";
import { InlineKeyboard } from "./telegram";
import { Draft } from "./db";

function money(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} тг`;
}

export function emptyDraft(): Draft {
  return {
    items: [],
    state: "picking_product",
    currentKey: null,
    currentQuantity: 1,
    messageId: null,
  };
}

export function draftItemsTotal(items: OrderItem[]): number {
  return items.reduce((s, i) => s + i.price * i.quantity, 0);
}

export function renderProductList(
  catalog: Map<string, CatalogItem>,
  draft: Draft
): { text: string; keyboard: InlineKeyboard } {
  const lines = ["🛒 Выберите товар:"];
  if (draft.items.length > 0) {
    lines.push("", "В заказе:");
    for (const item of draft.items) {
      lines.push(`• ${item.name} × ${item.quantity} — ${money(item.price * item.quantity)}`);
    }
    lines.push("", `Сумма товаров: ${money(draftItemsTotal(draft.items))}`);
  }

  const keyboard: InlineKeyboard = [];
  const entries = [...catalog.entries()].sort((a, b) =>
    a[1].name.localeCompare(b[1].name, "ru")
  );
  for (let i = 0; i < entries.length; i += 2) {
    const row = entries
      .slice(i, i + 2)
      .map(([key, item]) => ({
        text: `${item.name} — ${money(item.price)}`,
        callback_data: `pick:${key}`,
      }));
    keyboard.push(row);
  }

  const controlRow = [];
  if (draft.items.length > 0) {
    controlRow.push({ text: "✅ Завершить выбор", callback_data: "finish" });
  }
  controlRow.push({ text: "❌ Отмена", callback_data: "cancel" });
  keyboard.push(controlRow);

  return { text: lines.join("\n"), keyboard };
}

export function renderQuantity(
  item: CatalogItem,
  quantity: number
): { text: string; keyboard: InlineKeyboard } {
  const text = [
    item.name,
    `Цена: ${money(item.price)} за шт.`,
    "",
    `Количество: ${quantity}`,
    `Сумма: ${money(item.price * quantity)}`,
  ].join("\n");

  const keyboard: InlineKeyboard = [
    [
      { text: "➖", callback_data: "qty:dec" },
      { text: String(quantity), callback_data: "noop" },
      { text: "➕", callback_data: "qty:inc" },
    ],
    [
      { text: "✅ Добавить", callback_data: "qty:confirm" },
      { text: "⬅️ Назад", callback_data: "qty:back" },
    ],
  ];

  return { text, keyboard };
}

export function renderCityChoice(draft: Draft): { text: string; keyboard: InlineKeyboard } {
  const lines = ["Заказ:"];
  for (const item of draft.items) {
    lines.push(`• ${item.name} × ${item.quantity} — ${money(item.price * item.quantity)}`);
  }
  lines.push("", `Сумма товаров: ${money(draftItemsTotal(draft.items))}`, "", "Это по городу или нет?");

  const keyboard: InlineKeyboard = [
    [
      { text: "🏙 Город", callback_data: "city:city" },
      { text: "🚚 Не город", callback_data: "city:outside" },
    ],
    [
      { text: "⬅️ Назад", callback_data: "city:back" },
      { text: "❌ Отмена", callback_data: "cancel" },
    ],
  ];

  return { text: lines.join("\n"), keyboard };
}
