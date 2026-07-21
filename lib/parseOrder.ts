export interface OrderItem {
  name: string;
  price: number;
}

export interface ParsedOrder {
  items: OrderItem[];
  isCity: boolean;
}

export type ParseResult =
  | { ok: true; order: ParsedOrder }
  | { ok: false; error: string };

const CITY_WORDS = ["город", "г", "вгороде", "city"];
const OUTSIDE_WORDS = [
  "негород",
  "нг",
  "внегорода",
  "загород",
  "загородом",
  "область",
  "обл",
];

function normalizeWord(line: string): string {
  return line.trim().toLowerCase().replace(/[.,!?]/g, "").replace(/\s+/g, "");
}

/** Key used to look up a product name in the saved price catalog, ignoring case/spacing quirks. */
export function normalizeCatalogKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

// Matches a trailing price on a line, e.g. "Кроссовки Nike 15000", "Футболка - 5000 тг", "Шапка: 3500тг".
// The name capture is greedy so a name that itself ends in a number (e.g. "Elf 25") isn't
// mistaken for part of the price — the price is always the final, space-free digit run.
const ITEM_LINE = /^(.+\S)[\s:—-]+(\d+)\s*(?:тг|тенге|kzt|₸)?$/iu;

/** Parses a single "Название цена" line into an item, or null if it doesn't match that shape. */
export function parseNamePriceLine(line: string): OrderItem | null {
  const m = line.match(ITEM_LINE);
  if (!m) return null;
  const name = m[1].trim();
  const price = Number(m[2]);
  if (!name || !Number.isFinite(price) || price <= 0) return null;
  return { name, price };
}

export function parseOrderMessage(
  text: string,
  catalog: Map<string, OrderItem> = new Map()
): ParseResult {
  const rawLines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (rawLines.length === 0) {
    return { ok: false, error: "Пустое сообщение." };
  }

  let isCity: boolean | null = null;
  const itemLines: string[] = [];

  for (const line of rawLines) {
    const word = normalizeWord(line);
    if (CITY_WORDS.includes(word)) {
      isCity = true;
      continue;
    }
    if (OUTSIDE_WORDS.includes(word)) {
      isCity = false;
      continue;
    }
    itemLines.push(line);
  }

  if (isCity === null) {
    return {
      ok: false,
      error:
        "Не указано, город это или нет. Добавьте отдельной строкой «город» или «не город».",
    };
  }

  if (itemLines.length === 0) {
    return { ok: false, error: "Не найдено ни одного товара с ценой." };
  }

  const items: OrderItem[] = [];
  for (const line of itemLines) {
    const fromCatalog = catalog.get(normalizeCatalogKey(line));
    if (fromCatalog) {
      items.push(fromCatalog);
      continue;
    }

    const item = parseNamePriceLine(line);
    if (!item) {
      return {
        ok: false,
        error: `Не удалось распознать строку: «${line}». Формат: «Название цена», например «Кроссовки 15000», либо название товара из сохранённого прайса.`,
      };
    }
    items.push(item);
  }

  return { ok: true, order: { items, isCity } };
}
