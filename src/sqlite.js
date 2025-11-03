import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test if a path is actually persistent by writing and reading a test file
function testPersistentPath(testPath) {
  const testFile = path.join(testPath, '.persistence_test');
  try {
    // Write a test file
    fs.writeFileSync(testFile, 'test');
    // Read it back
    const content = fs.readFileSync(testFile, 'utf8');
    // Delete it
    fs.unlinkSync(testFile);
    return content === 'test';
  } catch (err) {
    return false;
  }
}

// Use persistent storage location for deployments
// Priority: 1. SQLITE_PATH env var, 2. Persistent disk (/tmp/data on Render), 3. Local dev path
function getDbPath() {
  if (process.env.SQLITE_PATH) {
    const dbPath = process.env.SQLITE_PATH;
    console.log(`[Database] Using SQLITE_PATH: ${dbPath}`);
    return dbPath;
  }
  
  // For production deployments (Render, Heroku, etc.), use a persistent location
  // Render mounts persistent disks at /tmp
  // Heroku ephemeral filesystem - need external storage or env var
  const persistentPath = process.env.PERSISTENT_DISK_PATH || '/tmp/data';
  
  // Check if persistent path exists or if we're in a deployment environment
  if (process.env.NODE_ENV === 'production' || process.env.RENDER || process.env.HEROKU) {
    // Ensure directory exists
    try {
      if (!fs.existsSync(persistentPath)) {
        fs.mkdirSync(persistentPath, { recursive: true });
      }
      
      // CRITICAL: Test that the persistent path is actually persistent
      // This prevents silent fallback to non-persistent storage
      const isPersistent = testPersistentPath(persistentPath);
      
      if (!isPersistent) {
        console.error(`[Database] ERROR: Persistent path ${persistentPath} is not writable or not persistent!`);
        console.error(`[Database] This will cause data loss on container restarts.`);
        console.error(`[Database] Please verify the persistent disk is mounted in your Render dashboard.`);
        // In production, we should fail loudly rather than silently use non-persistent storage
        if (process.env.RENDER || process.env.NODE_ENV === 'production') {
          console.error(`[Database] FAILING: Cannot use non-persistent storage in production.`);
          console.error(`[Database] Set SQLITE_PATH environment variable to a persistent location.`);
          throw new Error(`Persistent disk not available at ${persistentPath}. Data will be lost on restart.`);
        }
      } else {
        console.log(`[Database] ✓ Persistent disk verified at: ${persistentPath}`);
      }
      
      const dbPath = path.join(persistentPath, 'data.sqlite');
      return dbPath;
    } catch (err) {
      console.error(`[Database] ERROR: Could not use persistent path ${persistentPath}:`, err.message);
      // Only allow fallback in development
      if (process.env.NODE_ENV !== 'production' && !process.env.RENDER && !process.env.HEROKU) {
        console.warn(`[Database] Falling back to local development path`);
      } else {
        throw err; // Fail loudly in production
      }
    }
  }
  
  // Default: local development path (only for development)
  const devPath = path.join(__dirname, '..', 'data.sqlite');
  console.log(`[Database] Using local development path: ${devPath}`);
  return devPath;
}

export const dbPath = getDbPath();

// Ensure directory exists for the database file
const dbDir = path.dirname(dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

console.log(`[Database] Initializing SQLite database at: ${dbPath}`);
console.log(`[Database] Directory exists: ${fs.existsSync(dbDir)}`);
try {
  if (fs.existsSync(dbDir)) {
    fs.accessSync(dbDir, fs.constants.W_OK);
    console.log(`[Database] Directory is writable: ✓`);
  }
} catch (err) {
  console.warn(`[Database] Directory writability check failed: ${err.message}`);
}
console.log(`[Database] Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`[Database] Render: ${process.env.RENDER || 'not detected'}`);
if (fs.existsSync(dbPath)) {
  const stats = fs.statSync(dbPath);
  console.log(`[Database] Existing database file size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log(`[Database] Database file last modified: ${stats.mtime.toISOString()}`);
} else {
  console.log(`[Database] No existing database file found - will create new database`);
}

export const db = new Database(dbPath);

export function ensureSchema() {
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
  
  // Best-effort migration for adding Urdu name columns
  try { db.prepare("ALTER TABLE dishes ADD COLUMN name_ur TEXT").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE ingredients ADD COLUMN name_ur TEXT").run(); } catch (_) {}
  try { db.prepare("ALTER TABLE categories ADD COLUMN name_ur TEXT").run(); } catch (_) {}
  
  // Migration: add customer_id to orders table
  try {
    const tableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasCustomerId = tableInfo.find(col => col.name === 'customer_id');
    if (!hasCustomerId) {
      // Add customer_id column with a default customer if needed
      db.prepare("ALTER TABLE orders ADD COLUMN customer_id INTEGER").run();
      
      // Get existing order count to determine if this is a fresh DB or migration
      const orderCount = db.prepare("SELECT COUNT(*) as count FROM orders").get().count;
      const customerCount = db.prepare("SELECT COUNT(*) as count FROM customers").get().count;
      
      // Only create default customer if there are existing orders but no customers
      // This prevents creating "Default Customer" on fresh database deployments
      if (orderCount > 0 && customerCount === 0) {
        const defaultCustomer = db.prepare("INSERT INTO customers (name) VALUES (?)").run('Default Customer');
        const defaultCustomerId = defaultCustomer.lastInsertRowid;
        // Update all existing orders to use the default customer
        db.prepare("UPDATE orders SET customer_id = ? WHERE customer_id IS NULL").run(defaultCustomerId);
      } else if (customerCount > 0) {
        // If customers exist, assign orders to the first customer
        const firstCustomer = db.prepare("SELECT id FROM customers LIMIT 1").get();
        if (firstCustomer) {
          db.prepare("UPDATE orders SET customer_id = ? WHERE customer_id IS NULL").run(firstCustomer.id);
        }
      }
      
      // Make customer_id NOT NULL by recreating table (only if orders exist)
      if (orderCount > 0) {
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
    }
  } catch (err) {
    console.error('Error in customer_id migration:', err);
  }
  
  // Migration: add booking/delivery fields and number_of_persons to orders table
  try {
    const ordersTableInfo = db.prepare("PRAGMA table_info(orders)").all();
    const hasBookingDate = ordersTableInfo.find(col => col.name === 'booking_date');
    const hasDeliveryAddress = ordersTableInfo.find(col => col.name === 'delivery_address');
    const hasNumberOfPersons = ordersTableInfo.find(col => col.name === 'number_of_persons');
    
    if (!hasBookingDate) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN booking_date TEXT").run(); } catch (_) {}
    }
    if (!ordersTableInfo.find(col => col.name === 'booking_time')) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN booking_time TEXT").run(); } catch (_) {}
    }
    if (!ordersTableInfo.find(col => col.name === 'delivery_date')) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN delivery_date TEXT").run(); } catch (_) {}
    }
    if (!ordersTableInfo.find(col => col.name === 'delivery_time')) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN delivery_time TEXT").run(); } catch (_) {}
    }
    if (!hasDeliveryAddress) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN delivery_address TEXT").run(); } catch (_) {}
    }
    if (!hasNumberOfPersons) {
      try { db.prepare("ALTER TABLE orders ADD COLUMN number_of_persons INTEGER").run(); } catch (_) {}
    }
  } catch (err) {
    console.error('Error in orders migration:', err);
  }
  
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

