import { DaySummary } from "./db";
import { formatDateKeyRu } from "./date";
import { CatalogItem, OrderItem } from "./parseOrder";

function money(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} тг`;
}

export const HELP_TEXT = `Привет! Я считаю заказы и продажи за день.

<b>Чтобы добавить заказ текстом</b>, пришли сообщение: каждая строка — товар и цена, и отдельная строка «город» или «не город». Например:

Кроссовки 15000
Футболка 5000 x2
город

Для количества добавьте «x2», «x3» и т.д. в конце строки. Доставка добавится к сумме автоматически: 1500 тг по городу, 2000 тг за городом.

Если товар есть в сохранённом прайсе (см. /price), можно писать просто его название (с количеством или без) без цены — цена подставится сама. Указанная вручную цена всегда важнее цены из прайса.

<b>Или собери заказ кнопками:</b> /order — покажет товары из прайса, дальше просто нажимай.

<b>Команды:</b>
/order — собрать заказ кнопками
/today — итоги за сегодня
/date 21.07.2026 — итоги за конкретную дату
/undo — удалить последний добавленный заказ
/price — сохранить/обновить прайс-лист (каждая строка «Название цена»)
/prices — показать сохранённый прайс-лист
/help — эта справка`;

function formatOrderItemLine(i: OrderItem): string {
  const qtyPart = i.quantity > 1 ? ` × ${i.quantity}` : "";
  return `• ${i.name}${qtyPart} — ${money(i.price * i.quantity)}`;
}

export function formatOrderConfirmation(params: {
  items: OrderItem[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  isCity: boolean;
}): string {
  const lines = params.items.map(formatOrderItemLine);
  return [
    "✅ Заказ добавлен",
    ...lines,
    `Доставка (${params.isCity ? "город" : "не город"}): ${money(params.deliveryFee)}`,
    `<b>Итого: ${money(params.total)}</b>`,
  ].join("\n");
}

export function formatCatalogSaved(items: CatalogItem[]): string {
  const lines = items.map((i) => `• ${i.name} — ${money(i.price)}`);
  return ["✅ Прайс сохранён", ...lines].join("\n");
}

export function formatCatalogList(catalog: Map<string, CatalogItem>): string {
  if (catalog.size === 0) {
    return "Прайс пуст. Добавьте его командой /price, например:\n/price\nWaka 10 13000\nRif 15000";
  }
  const lines = [...catalog.values()]
    .sort((a, b) => a.name.localeCompare(b.name, "ru"))
    .map((i) => `• ${i.name} — ${money(i.price)}`);
  return ["💰 Прайс-лист", ...lines].join("\n");
}

export function formatDaySummary(summary: DaySummary): string {
  if (summary.ordersCount === 0) {
    return `📅 Итоги за ${formatDateKeyRu(summary.orderDate)}\n\nЗаказов не было.`;
  }
  const breakdownLines = summary.productBreakdown.map(
    (p) => `• ${p.name} — ${p.quantity} шт — ${money(p.revenue)}`
  );
  return [
    `📅 Итоги за ${formatDateKeyRu(summary.orderDate)}`,
    "",
    `Заказов: ${summary.ordersCount} (город: ${summary.cityCount}, за городом: ${summary.outsideCount})`,
    "",
    "<b>Продано по товарам:</b>",
    ...breakdownLines,
    "",
    `Товары: ${money(summary.itemsTotal)}`,
    `Доставка: ${money(summary.deliveryTotal)}`,
    `<b>Итого: ${money(summary.grandTotal)}</b>`,
  ].join("\n");
}
