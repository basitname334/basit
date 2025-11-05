import dotenv from 'dotenv';
dotenv.config();
import { db, ensureSchema } from './sqlite.js';
import bcrypt from 'bcryptjs';

ensureSchema();

function upsertUser(email, password, role) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (exists) return exists.id;
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?,?,?)').run(normalizedEmail, hash, role);
  console.log(`Created user ${normalizedEmail} (${role})`);
  return info.lastInsertRowid;
}

function upsertCategory(name) {
  const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(name);
  if (exists) return exists.id;
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(name);
  console.log(`Created category ${name}`);
  return info.lastInsertRowid;
}

function upsertIngredient(name, categoryId) {
  const exists = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(name);
  if (exists) return exists.id;
  const info = db.prepare('INSERT INTO ingredients (name, category_id) VALUES (?, ?)').run(name, categoryId);
  return info.lastInsertRowid;
}

function upsertDish(name, base_quantity, base_unit) {
  const exists = db.prepare('SELECT id FROM dishes WHERE name = ?').get(name);
  if (exists) return exists.id;
  const info = db.prepare('INSERT INTO dishes (name, base_quantity, base_unit) VALUES (?,?,?)').run(name, base_quantity, base_unit);
  return info.lastInsertRowid;
}

function upsertCustomer(name, phone, email, address) {
  const exists = db.prepare('SELECT id FROM customers WHERE name = ?').get(name);
  if (exists) return exists.id;
  const info = db.prepare('INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)')
    .run(name.trim(), phone?.trim() || null, email?.trim() || null, address?.trim() || null);
  console.log(`Created customer ${name}`);
  return info.lastInsertRowid;
}

function main() {
  console.log('Starting database seed...');
  
  // Ensure default users exist
  upsertUser('admin@example.com', 'admin123', 'admin');
  upsertUser('user@example.com', 'user123', 'user');

  // Create categories first
  const grainsCategory = upsertCategory('Grains');
  const liquidsCategory = upsertCategory('Liquids');
  const seasoningsCategory = upsertCategory('Seasonings');
  const vegetablesCategory = upsertCategory('Vegetables');
  const proteinsCategory = upsertCategory('Proteins');

  // Then create ingredients with category_id
  const rice = upsertIngredient('Rice', grainsCategory);
  const water = upsertIngredient('Water', liquidsCategory);
  const salt = upsertIngredient('Salt', seasoningsCategory);
  upsertIngredient('Black Pepper', seasoningsCategory);
  upsertIngredient('Turmeric', seasoningsCategory);
  upsertIngredient('Onion', vegetablesCategory);
  upsertIngredient('Garlic', vegetablesCategory);
  upsertIngredient('Chicken', proteinsCategory);
  upsertIngredient('Beef', proteinsCategory);

  // Create default customer
  upsertCustomer('Default Customer', null, null, null);
  upsertCustomer('John Doe', '1234567890', 'john@example.com', '123 Main St');
  upsertCustomer('Jane Smith', '0987654321', 'jane@example.com', '456 Oak Ave');

  // Create sample dish
  const dishId = upsertDish('Plain Boiled Rice', 1, 'kg');
  const haveMap = db.prepare('SELECT 1 FROM dish_ingredients WHERE dish_id = ?').get(dishId);
  if (!haveMap) {
    db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, amount_per_base, unit) VALUES (?,?,?,?)').run(dishId, rice, 1, 'kg');
    db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, amount_per_base, unit) VALUES (?,?,?,?)').run(dishId, water, 1.5, 'litre');
    db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, amount_per_base, unit) VALUES (?,?,?,?)').run(dishId, salt, 10, 'g');
    console.log('Seeded dish ingredients for Plain Boiled Rice');
  }

  console.log('✅ Seed complete!');
  console.log('Default users:');
  console.log('  - admin@example.com / admin123 (admin)');
  console.log('  - user@example.com / user123 (user)');
}

main();

