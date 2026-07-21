import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getDaySummary } from "../lib/db";
import { todayDateKey, parseDateInput, formatDateKeyRu } from "../lib/date";

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function money(n: number): string {
  return `${Math.round(n).toLocaleString("ru-RU")} тг`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const dateParam = typeof req.query.date === "string" ? req.query.date : undefined;
  const dateKey = dateParam ? parseDateInput(dateParam) : todayDateKey();

  if (!dateKey) {
    res.status(400).send("Неверный формат даты. Используйте ?date=21.07.2026");
    return;
  }

  const summary = await getDaySummary(dateKey);

  const rows = summary.orders
    .map((o) => {
      const itemsList = o.items.map((i) => `${escapeHtml(i.name)} — ${money(i.price)}`).join(", ");
      return `<tr>
        <td>#${o.id}</td>
        <td>${itemsList}</td>
        <td>${o.isCity ? "город" : "не город"}</td>
        <td>${money(o.itemsTotal)}</td>
        <td>${money(o.deliveryFee)}</td>
        <td><b>${money(o.total)}</b></td>
      </tr>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Итоги за ${formatDateKeyRu(dateKey)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { font-size: 1.4rem; }
  .stats { display: flex; gap: 1.5rem; flex-wrap: wrap; margin: 1rem 0 1.5rem; }
  .stat { background: #f4f4f5; border-radius: 8px; padding: 0.75rem 1rem; }
  .stat b { display: block; font-size: 1.2rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e5e5e5; }
  form { margin: 1rem 0; }
  input[type=text] { padding: 0.4rem; }
  button { padding: 0.4rem 0.8rem; }
</style>
</head>
<body>
  <h1>Итоги за ${formatDateKeyRu(dateKey)}</h1>
  <form method="get">
    <input type="text" name="date" placeholder="21.07.2026" value="${dateParam ?? ""}">
    <button type="submit">Показать</button>
  </form>
  <div class="stats">
    <div class="stat">Заказов<b>${summary.ordersCount}</b></div>
    <div class="stat">Город / не город<b>${summary.cityCount} / ${summary.outsideCount}</b></div>
    <div class="stat">Товары<b>${money(summary.itemsTotal)}</b></div>
    <div class="stat">Доставка<b>${money(summary.deliveryTotal)}</b></div>
    <div class="stat">Итого<b>${money(summary.grandTotal)}</b></div>
  </div>
  <table>
    <thead><tr><th>№</th><th>Товары</th><th>Тип</th><th>Товары, тг</th><th>Доставка</th><th>Итого</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="6">Заказов не было</td></tr>`}</tbody>
  </table>
</body>
</html>`;

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(200).send(html);
}
