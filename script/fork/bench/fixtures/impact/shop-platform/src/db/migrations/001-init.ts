/** Initial schema. Later changes go in new migration files, added to `MIGRATIONS`. */
export const up = `
CREATE TABLE customers (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL);
CREATE TABLE products (id TEXT PRIMARY KEY, title TEXT NOT NULL, price_cents INTEGER NOT NULL);
CREATE TABLE orders (id TEXT PRIMARY KEY, customer_id TEXT NOT NULL, status TEXT NOT NULL, total_cents INTEGER NOT NULL, discount_code TEXT, created_at TEXT NOT NULL);
CREATE TABLE order_items (order_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INTEGER NOT NULL);
`
