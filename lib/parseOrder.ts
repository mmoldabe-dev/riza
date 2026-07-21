export interface CatalogItem {
  name: string;
  price: number;
}

export interface OrderItem extends CatalogItem {
  quantity: number;
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

// Trailing quantity marker, e.g. "x3", "х2" (Cyrillic х), "*4". Only applies to order lines,
// never to catalog price definitions.
const QUANTITY_SUFFIX = /^(.*\S)\s*[xх*]\s*(\d+)$/iu;

/** Parses a single "Название цена" line into a catalog item, or null if it doesn't match that shape. */
export function parseNamePriceLine(line: string): CatalogItem | null {
  const m = line.match(ITEM_LINE);
  if (!m) return null;
  const name = m[1].trim();
  const price = Number(m[2]);
  if (!name || !Number.isFinite(price) || price <= 0) return null;
  return { name, price };
}

/** Parses one order line: strips an optional "x<n>" quantity suffix, then resolves the
 * remainder against the catalog (exact name match) or as an explicit "Название цена". */
export function parseOrderLine(
  line: string,
  catalog: Map<string, CatalogItem>
): OrderItem | null {
  let remainder = line;
  let quantity = 1;

  const qm = line.match(QUANTITY_SUFFIX);
  if (qm) {
    const n = Number(qm[2]);
    if (Number.isFinite(n) && n > 0) {
      remainder = qm[1].trim();
      quantity = n;
    }
  }

  const fromCatalog = catalog.get(normalizeCatalogKey(remainder));
  if (fromCatalog) {
    return { ...fromCatalog, quantity };
  }

  const parsed = parseNamePriceLine(remainder);
  if (!parsed) return null;
  return { ...parsed, quantity };
}

export function parseOrderMessage(
  text: string,
  catalog: Map<string, CatalogItem> = new Map()
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
    const item = parseOrderLine(line, catalog);
    if (!item) {
      return {
        ok: false,
        error: `Не удалось распознать строку: «${line}». Формат: «Название цена» (можно добавить «x3» для количества), например «Кроссовки 15000 x2», либо название товара из сохранённого прайса.`,
      };
    }
    items.push(item);
  }

  return { ok: true, order: { items, isCity } };
}
