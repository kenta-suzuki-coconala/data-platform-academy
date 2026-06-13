// 決定的にPlayground用サンプルデータ(seed.sql)を生成する。
// 共通サンプルドメイン: customers / products / orders / order_items / events
import { writeFileSync } from 'node:fs'

// --- 決定的乱数(乱数シードでseed.sqlを再現可能に) ---
let s = 1234567
const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const pick = (a) => a[Math.floor(rnd() * a.length)]
const between = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1))
const pad = (n) => String(n).padStart(2, '0')
const dateStr = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

const countries = ['JP', 'JP', 'JP', 'US', 'US', 'GB', 'DE', 'FR', 'IN', 'BR']
const firstNames = ['Aoi','Haruto','Yui','Sota','Mei','Ren','Hina','Kai','Sara','Riku','Emma','Liam','Olivia','Noah','Mia','Lucas','Ava','Leo','Zoe','Max']
const categories = ['Electronics','Books','Home','Toys','Sports','Beauty']
const productNames = {
  Electronics:['Wireless Earbuds','USB-C Charger','Mechanical Keyboard','4K Webcam','Portable SSD'],
  Books:['Data Modeling 101','SQL Cookbook','The Data Warehouse','Streaming Systems','Clean Pipelines'],
  Home:['Ceramic Mug','LED Desk Lamp','Throw Blanket','Spice Rack'],
  Toys:['Building Blocks','Puzzle 1000pc','RC Car'],
  Sports:['Yoga Mat','Water Bottle','Resistance Bands','Running Socks'],
  Beauty:['Face Serum','Hand Cream','Lip Balm'],
}
const statuses = ['completed','completed','completed','completed','cancelled','pending']
const eventTypes = ['view','view','view','add_to_cart','add_to_cart','purchase']

// --- products ---
const products = []
let pid = 1
for (const cat of categories) {
  for (const name of productNames[cat]) {
    products.push({ product_id: pid++, name, category: cat, price: between(5, 200) * 1.0 + 0.99 })
  }
}

// --- customers ---
const customers = []
const NCUST = 40
for (let i = 1; i <= NCUST; i++) {
  const m = between(1, 11)
  customers.push({
    customer_id: i,
    name: `${pick(firstNames)} ${String.fromCharCode(65 + between(0, 25))}.`,
    country: pick(countries),
    signup_date: dateStr(2024, m, between(1, 28)),
  })
}

// --- orders + order_items + events ---
const orders = []
const orderItems = []
const events = []
let oid = 1, oiid = 1, eid = 1
for (let i = 0; i < 160; i++) {
  const cust = pick(customers)
  const m = between(1, 12)
  const d = between(1, 28)
  const status = pick(statuses)
  const order = { order_id: oid++, customer_id: cust.customer_id, order_date: dateStr(2025, m, d), status }
  orders.push(order)
  const nItems = between(1, 4)
  for (let j = 0; j < nItems; j++) {
    const prod = pick(products)
    orderItems.push({
      order_item_id: oiid++,
      order_id: order.order_id,
      product_id: prod.product_id,
      quantity: between(1, 3),
      unit_price: prod.price,
    })
  }
}
// events (ファネル: view > add_to_cart > purchase)
for (let i = 0; i < 600; i++) {
  const cust = pick(customers)
  const m = between(1, 12)
  const d = between(1, 28)
  const h = between(0, 23)
  events.push({
    event_id: eid++,
    customer_id: cust.customer_id,
    event_type: pick(eventTypes),
    event_time: `${dateStr(2025, m, d)} ${pad(h)}:${pad(between(0,59))}:00`,
  })
}

// --- SQL生成 ---
const q = (v) => (typeof v === 'number' ? v : `'${String(v).replace(/'/g, "''")}'`)
const insert = (table, cols, rows) => {
  const lines = rows.map((r) => `  (${cols.map((c) => q(r[c])).join(', ')})`)
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES\n${lines.join(',\n')};\n`
}

let sql = `-- Datable Playground サンプルデータ (自動生成: data/gen_seed.mjs)
-- 共通サンプルドメイン: EC事業の生データ
PRAGMA foreign_keys = OFF;

CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name        TEXT,
  country     TEXT,
  signup_date TEXT
);
CREATE TABLE products (
  product_id INTEGER PRIMARY KEY,
  name       TEXT,
  category   TEXT,
  price      REAL
);
CREATE TABLE orders (
  order_id    INTEGER PRIMARY KEY,
  customer_id INTEGER,
  order_date  TEXT,
  status      TEXT
);
CREATE TABLE order_items (
  order_item_id INTEGER PRIMARY KEY,
  order_id      INTEGER,
  product_id    INTEGER,
  quantity      INTEGER,
  unit_price    REAL
);
CREATE TABLE events (
  event_id    INTEGER PRIMARY KEY,
  customer_id INTEGER,
  event_type  TEXT,
  event_time  TEXT
);

`
sql += insert('customers', ['customer_id','name','country','signup_date'], customers) + '\n'
sql += insert('products', ['product_id','name','category','price'], products) + '\n'
sql += insert('orders', ['order_id','customer_id','order_date','status'], orders) + '\n'
sql += insert('order_items', ['order_item_id','order_id','product_id','quantity','unit_price'], orderItems) + '\n'
sql += insert('events', ['event_id','customer_id','event_type','event_time'], events) + '\n'

writeFileSync(new URL('./seed.sql', import.meta.url), sql)
console.log(`seed.sql generated: ${customers.length} customers, ${products.length} products, ${orders.length} orders, ${orderItems.length} order_items, ${events.length} events`)
