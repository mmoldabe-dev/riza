import { DaySummary } from "./db";
import { formatDateKeyRu } from "./date";

function money(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} тг`;
}

export const HELP_TEXT = `Привет! Я считаю заказы и продажи за день.

<b>Чтобы добавить заказ</b>, пришли сообщение: каждая строка — товар и цена, и отдельная строка «город» или «не город». Например:

Кроссовки 15000
Футболка 5000
город

Доставка добавится к сумме автоматически: 1500 тг по городу, 2000 тг за городом.

<b>Команды:</b>
/today — итоги за сегодня
/date 21.07.2026 — итоги за конкретную дату
/undo — удалить последний добавленный заказ
/help — эта справка`;

export function formatOrderConfirmation(params: {
  items: { name: string; price: number }[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  isCity: boolean;
}): string {
  const lines = params.items.map((i) => `• ${i.name} — ${money(i.price)}`);
  return [
    "✅ Заказ добавлен",
    ...lines,
    `Доставка (${params.isCity ? "город" : "не город"}): ${money(params.deliveryFee)}`,
    `<b>Итого: ${money(params.total)}</b>`,
  ].join("\n");
}

export function formatDaySummary(summary: DaySummary): string {
  if (summary.ordersCount === 0) {
    return `📅 Итоги за ${formatDateKeyRu(summary.orderDate)}\n\nЗаказов не было.`;
  }
  return [
    `📅 Итоги за ${formatDateKeyRu(summary.orderDate)}`,
    "",
    `Заказов: ${summary.ordersCount} (город: ${summary.cityCount}, за городом: ${summary.outsideCount})`,
    `Товары: ${money(summary.itemsTotal)}`,
    `Доставка: ${money(summary.deliveryTotal)}`,
    `<b>Итого: ${money(summary.grandTotal)}</b>`,
  ].join("\n");
}
