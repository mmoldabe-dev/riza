import { OrderItem, parseNamePriceLine } from "./parseOrder";

export type CatalogParseResult =
  | { ok: true; items: OrderItem[] }
  | { ok: false; error: string };

/** Parses the body of a /price command: one "Название цена" per line. */
export function parseCatalogUpdate(text: string): CatalogParseResult {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { ok: false, error: "Пустой список. Формат: «Название цена» на каждой строке." };
  }

  const items: OrderItem[] = [];
  for (const line of lines) {
    const item = parseNamePriceLine(line);
    if (!item) {
      return {
        ok: false,
        error: `Не удалось распознать строку: «${line}». Формат: «Название цена», например «Waka 10 13000».`,
      };
    }
    items.push(item);
  }

  return { ok: true, items };
}
