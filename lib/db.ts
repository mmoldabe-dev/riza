import { createPool } from "@vercel/postgres";
import { OrderItem } from "./parseOrder";

// Accept whichever env var name the connected Postgres provider ends up using
// (Vercel's own Postgres storage sets POSTGRES_URL; a manually pasted Neon
// connection string is usually called DATABASE_URL).
const connectionString =
  process.env.POSTGRES_URL ?? process.env.DATABASE_URL;

const pool = createPool({ connectionString });
const sql = pool.sql;

let schemaReady: Promise<void> | null = null;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = sql`
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
    `.then(() => undefined);
  }
  return schemaReady;
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
  const { rows } = await sql`
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
    items: r.items,
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  };
}

export async function deleteLastOrder(chatId: number): Promise<SavedOrder | null> {
  await ensureSchema();
  const { rows } = await sql`
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
    items: r.items,
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  };
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
}

export async function getDaySummary(dateKey: string): Promise<DaySummary> {
  await ensureSchema();
  const { rows } = await sql`
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
    items: r.items,
    itemsTotal: Number(r.items_total),
    deliveryFee: Number(r.delivery_fee),
    total: Number(r.total),
  }));

  const cityCount = orders.filter((o) => o.isCity).length;
  const itemsTotal = orders.reduce((s, o) => s + o.itemsTotal, 0);
  const deliveryTotal = orders.reduce((s, o) => s + o.deliveryFee, 0);

  return {
    orderDate: dateKey,
    ordersCount: orders.length,
    cityCount,
    outsideCount: orders.length - cityCount,
    itemsTotal,
    deliveryTotal,
    grandTotal: itemsTotal + deliveryTotal,
    orders,
  };
}
