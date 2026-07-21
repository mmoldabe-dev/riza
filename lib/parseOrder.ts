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

// Matches a trailing price on a line, e.g. "Кроссовки Nike 15000", "Футболка - 5 000 тг", "Шапка: 3500тг"
const ITEM_LINE = /^(.+?)[\s:—-]+([\d][\d\s]*)\s*(?:тг|тенге|kzt|₸)?$/iu;

export function parseOrderMessage(text: string): ParseResult {
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
    const m = line.match(ITEM_LINE);
    if (!m) {
      return {
        ok: false,
        error: `Не удалось распознать строку: «${line}». Формат: «Название цена», например «Кроссовки 15000».`,
      };
    }
    const name = m[1].trim();
    const price = Number(m[2].replace(/\s+/g, ""));
    if (!name || !Number.isFinite(price) || price <= 0) {
      return {
        ok: false,
        error: `Не удалось распознать строку: «${line}».`,
      };
    }
    items.push({ name, price });
  }

  return { ok: true, order: { items, isCity } };
}
