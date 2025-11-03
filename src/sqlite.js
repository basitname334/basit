import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve a durable default DB location outside synced folders (e.g., OneDrive)
function resolveDefaultDbPath() {
  const home = os.homedir();
  let baseDir;
  if (process.platform === 'win32') {
    baseDir = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  } else if (process.platform === 'darwin') {
    baseDir = path.join(home, 'Library', 'Application Support');
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
  }
  const appDir = path.join(baseDir, 'POS-System');
  try { fs.mkdirSync(appDir, { recursive: true }); } catch (_) {}
  return path.join(appDir, 'data.sqlite');
}

// Backward compatibility: keep using repo-adjacent DB if it already exists
const legacyRepoDbPath = path.join(__dirname, '..', 'data.sqlite');
const chosenDefaultPath = fs.existsSync(legacyRepoDbPath) ? legacyRepoDbPath : resolveDefaultDbPath();

export const dbPath = process.env.SQLITE_PATH || chosenDefaultPath;

// Ensure directory exists for custom SQLITE_PATH or default
try {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
} catch (_) {}
export const db = new Database(dbPath);

export function ensureSchema() {
  // Improve durability and reduce lock contention
  try { db.pragma('journal_mode = WAL'); } catch (_) {}
  try { db.pragma('busy_timeout = 5000'); } catch (_) {}
  try { db.pragma('synchronous = NORMAL'); } catch (_) {}

  const schema = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('admin','user')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  category_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS dishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  base_quantity REAL NOT NULL,
  base_unit TEXT NOT NULL,
  price_per_base REAL,
  cost_per_base REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS dish_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dish_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  amount_per_base REAL NOT NULL,
  unit TEXT NOT NULL,
  FOREIGN KEY(dish_id) REFERENCES dishes(id) ON DELETE CASCADE,
  FOREIGN KEY(ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE,
  UNIQUE(dish_id, ingredient_id)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  customer_id INTEGER NOT NULL,
  dish_id INTEGER NOT NULL,
  requested_quantity REAL NOT NULL,
  requested_unit TEXT NOT NULL,
  scale_factor REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY(user_id) REFERENCES users(id),
  FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
  FOREIGN KEY(dish_id) REFERENCES dishes(id)
);

CREATE TABLE IF NOT EXISTS order_ingredients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER NOT NULL,
  ingredient_id INTEGER NOT NULL,
  scaled_amount REAL NOT NULL,
  unit TEXT NOT NULL,
  FOREIGN KEY(order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY(ingredient_id) REFERENCES ingredients(id)
);
`;

  db.exec(schema);

  // Best-effort migration for older databases missing pricing columns
  try { db.prepare("ALTER TABLE dishes ADD COLUMN price_per_base REAL").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE dishes ADD COLUMN cost_per_base REAL").run(); } catch (_) {}
  
  // Migration: add customer_id to orders table
  try {
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasCustomerId = tableInfo.find(col => col.name === 'customer_id');
    if (!hasCustomerId) {
      // Add customer_id column with a default customer if needed
      db.prepare("ALTER TABLE orders ADD COLUMN customer_id INTEGER").run();
      
      // Create a default customer if no customers exist
      const customerCount = db.prepare("SELECT COUNT(*) as count FROM customers").get().count;
      if (customerCount === 0) {
        const defaultCustomer = db.prepare("INSERT INTO customers (name) VALUES (?)").run('Default Customer');
        const defaultCustomerId = defaultCustomer.lastInsertRowid;
        // Update all existing orders to use the default customer
        db.prepare("UPDATE orders SET customer_id = ? WHERE customer_id IS NULL").run(defaultCustomerId);
      }
      
      // Make customer_id NOT NULL by recreating table
      db.exec(`
        CREATE TABLE orders_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          customer_id INTEGER NOT NULL,
          dish_id INTEGER NOT NULL,
          requested_quantity REAL NOT NULL,
          requested_unit TEXT NOT NULL,
          scale_factor REAL NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(user_id) REFERENCES users(id),
          FOREIGN KEY(customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
          FOREIGN KEY(dish_id) REFERENCES dishes(id)
        );
        INSERT INTO orders_new (id, user_id, customer_id, dish_id, requested_quantity, requested_unit, scale_factor, created_at)
        SELECT id, user_id, COALESCE(customer_id, (SELECT id FROM customers LIMIT 1)), dish_id, requested_quantity, requested_unit, scale_factor, created_at FROM orders;
        DROP TABLE orders;
        ALTER TABLE orders_new RENAME TO orders;
      `);
    }
  } catch (_) {}
  
  // Migration: convert category text to category_id foreign key
  try {
    const tableInfo = db.prepare("PRAGMA table_info(ingredients)").all();
    const hasCategory = tableInfo.find(col => col.name === 'category');
    const hasCategoryId = tableInfo.find(col => col.name === 'category_id');
    const hasCategoriesTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='categories'").get();
    
    if (hasCategory && !hasCategoryId) {
      // Create categories table if it doesn't exist
      if (!hasCategoriesTable) {
        db.exec(`
          CREATE TABLE categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
          );
        `);
        
        // Migrate existing categories to the categories table
        const existingCategories = db.prepare("SELECT DISTINCT category FROM ingredients WHERE category IS NOT NULL AND category != ''").all();
        for (const cat of existingCategories) {
          try {
            db.prepare("INSERT INTO categories (name) VALUES (?)").run(cat.category);
          } catch (_) {} // Ignore duplicates
        }
      }
      
      // Add category_id column and populate it
      db.prepare("ALTER TABLE ingredients ADD COLUMN category_id INTEGER").run();
      const updateStmt = db.prepare(`
        UPDATE ingredients 
        SET category_id = (SELECT id FROM categories WHERE categories.name = ingredients.category LIMIT 1)
        WHERE category IS NOT NULL
      `);
      updateStmt.run();
      
      // Create new table with proper foreign key
      db.exec(`
        CREATE TABLE ingredients_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          category_id INTEGER NOT NULL,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          FOREIGN KEY(category_id) REFERENCES categories(id) ON DELETE RESTRICT
        );
        INSERT INTO ingredients_new (id, name, category_id, created_at)
        SELECT id, name, category_id, created_at FROM ingredients WHERE category_id IS NOT NULL;
        DROP TABLE ingredients;
        ALTER TABLE ingredients_new RENAME TO ingredients;
      `);
    }
  } catch (_) {}
}

export function transact(fn) {
  const doTxn = db.transaction(fn);
  return doTxn();
}

