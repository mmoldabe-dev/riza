import { neon } from "@neondatabase/serverless";
import { CatalogItem, OrderItem, normalizeCatalogKey } from "./parseOrder";

// Accept whichever env var name the connected Postgres provider ends up using
// (Vercel's own Postgres storage sets POSTGRES_URL; a manually pasted Neon
// connection string is usually called DATABASE_URL).
const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("POSTGRES_URL or DATABASE_URL must be set");
}

// neon()'s tagged template returns the rows array directly (not { rows }).
const sql = neon(connectionString);

let schemaReady: Promise<void> | null = null;

async function createSchema(): Promise<void> {
  await sql`
    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      chat_id BIGINT NOT NULL,
      order_date DATE NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      is_city BOOLEAN NOT NULL,
      items JSONB NOT NULL,
      items_total NUMERIC NOT NULL,
      delivery_fee NUMERIC NOT NULL,
      total NUMERIC NOT NULL,
      raw_text TEXT
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS catalog (
      chat_id BIGINT NOT NULL,
      name_key TEXT NOT NULL,
      name TEXT NOT NULL,
      price NUMERIC NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (chat_id, name_key)
    );
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS drafts (
      chat_id BIGINT PRIMARY KEY,
      items JSONB NOT NULL DEFAULT '[]',
      state TEXT NOT NULL DEFAULT 'picking_product',
      current_key TEXT,
      current_quantity INTEGER NOT NULL DEFAULT 1,
      message_id BIGINT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `;
}

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema();
  }
  return schemaReady;
}

export async function upsertCatalogItems(
  chatId: number,
  items: CatalogItem[]
): Promise<void> {
  await ensureSchema();
  for (const item of items) {
    await sql`
      INSERT INTO catalog (chat_id, name_key, name, price, updated_at)
      VALUES (${chatId}, ${normalizeCatalogKey(item.name)}, ${item.name}, ${item.price}, now())
      ON CONFLICT (chat_id, name_key)
      DO UPDATE SET name = excluded.name, price = excluded.price, updated_at = now();
    `;
  }
}

export async function getCatalog(chatId: number): Promise<Map<string, CatalogItem>> {
  await ensureSchema();
  const rows = await sql`
    SELECT name_key, name, price FROM catalog WHERE chat_id = ${chatId};
  `;
  const map = new Map<string, CatalogItem>();
  for (const r of rows) {
    map.set(r.name_key, { name: r.name, price: Number(r.price) });
  }
  return map;
}

export interface SavedOrder {
  id: number;
  chatId: number;
  orderDate: string;
  isCity: boolean;
  items: OrderItem[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
}

function normalizeStoredItems(items: OrderItem[]): OrderItem[] {
  // Defensive default for any pre-existing rows saved before quantity support.
  return items.map((i) => ({ ...i, quantity: i.quantity ?? 1 }));
}

export async function insertOrder(params: {
  chatId: number;
  orderDate: string;
  isCity: boolean;
  items: OrderItem[];
  itemsTotal: number;
  deliveryFee: number;
  total: number;
  rawText: string;
}): Promise<SavedOrder> {
  await ensureSchema();
  const rows = await sql`
    INSERT INTO orders (chat_id, order_date, is_city, items, items_total, delivery_fee, total, raw_text)
    VALUES (
      ${params.chatId},
      ${params.orderDate},
      ${params.isCity},
      ${JSON.stringify(params.items)}::jsonb,
      ${params.itemsTotal},
      ${params.deliveryFee},
      ${params.total},
      ${params.rawText}
    )
    RETURNING id, chat_id, order_date::text AS order_date, is_city, items, items_total, delivery_fee, total;
  `;
  const r = rows[0];
  return {
    id: r.id,
    chatId: r.chat_id,
    orderDate: r.order_date,
    isCity: r.is_city,
    items: normalizeStoredItems(r.items),
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  };
}

export async function deleteLastOrder(chatId: number): Promise<SavedOrder | null> {
  await ensureSchema();
  const rows = await sql`
    DELETE FROM orders
    WHERE id = (
      SELECT id FROM orders WHERE chat_id = ${chatId} ORDER BY created_at DESC LIMIT 1
    )
    RETURNING id, chat_id, order_date::text AS order_date, is_city, items, items_total, delivery_fee, total;
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    chatId: r.chat_id,
    orderDate: r.order_date,
    isCity: r.is_city,
    items: normalizeStoredItems(r.items),
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  };
}

export interface ProductBreakdownRow {
  name: string;
  quantity: number;
  revenue: number;
}

export interface DaySummary {
  orderDate: string;
  ordersCount: number;
  cityCount: number;
  outsideCount: number;
  itemsTotal: number;
  deliveryTotal: number;
  grandTotal: number;
  orders: SavedOrder[];
  productBreakdown: ProductBreakdownRow[];
}

export async function getDaySummary(dateKey: string): Promise<DaySummary> {
  await ensureSchema();
  const rows = await sql`
    SELECT id, chat_id, order_date::text AS order_date, is_city, items, items_total, delivery_fee, total
    FROM orders
    WHERE order_date = ${dateKey}
    ORDER BY created_at ASC;
  `;

  const orders: SavedOrder[] = rows.map((r) => ({
    id: r.id,
    chatId: r.chat_id,
    orderDate: r.order_date,
    isCity: r.is_city,
    items: normalizeStoredItems(r.items),
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  }));

  const cityCount = orders.filter((o) => o.isCity).length;
  const itemsTotal = orders.reduce((s, o) => s + o.itemsTotal, 0);
  const deliveryTotal = orders.reduce((s, o) => s + o.deliveryFee, 0);

  const breakdownMap = new Map<string, ProductBreakdownRow>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = normalizeCatalogKey(item.name);
      const existing = breakdownMap.get(key);
      const revenue = item.price * item.quantity;
      if (existing) {
        existing.quantity += item.quantity;
        existing.revenue += revenue;
      } else {
        breakdownMap.set(key, { name: item.name, quantity: item.quantity, revenue });
      }
    }
  }
  const productBreakdown = [...breakdownMap.values()].sort((a, b) => b.quantity - a.quantity);

  return {
    orderDate: dateKey,
    ordersCount: orders.length,
    cityCount,
    outsideCount: orders.length - cityCount,
    itemsTotal,
    deliveryTotal,
    grandTotal: itemsTotal + deliveryTotal,
    orders,
    productBreakdown,
  };
}

export type DraftState = "picking_product" | "picking_quantity" | "picking_city";

export interface Draft {
  items: OrderItem[];
  state: DraftState;
  currentKey: string | null;
  currentQuantity: number;
  messageId: number | null;
}

export async function getDraft(chatId: number): Promise<Draft | null> {
  await ensureSchema();
  const rows = await sql`
    SELECT items, state, current_key, current_quantity, message_id
    FROM drafts WHERE chat_id = ${chatId};
  `;
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    items: normalizeStoredItems(r.items),
    state: r.state,
    currentKey: r.current_key,
    currentQuantity: r.current_quantity,
    messageId: r.message_id,
  };
}

export async function saveDraft(chatId: number, draft: Draft): Promise<void> {
  await ensureSchema();
  await sql`
    INSERT INTO drafts (chat_id, items, state, current_key, current_quantity, message_id, updated_at)
    VALUES (
      ${chatId},
      ${JSON.stringify(draft.items)}::jsonb,
      ${draft.state},
      ${draft.currentKey},
      ${draft.currentQuantity},
      ${draft.messageId},
      now()
    )
    ON CONFLICT (chat_id) DO UPDATE SET
      items = excluded.items,
      state = excluded.state,
      current_key = excluded.current_key,
      current_quantity = excluded.current_quantity,
      message_id = excluded.message_id,
      updated_at = now();
  `;
}

export async function clearDraft(chatId: number): Promise<void> {
  await ensureSchema();
  await sql`DELETE FROM drafts WHERE chat_id = ${chatId};`;
}
