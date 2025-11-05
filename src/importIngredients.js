import dotenv from 'dotenv';
dotenv.config();
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { db, ensureSchema } from './sqlite.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

ensureSchema();

function upsertCategory(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const exists = db.prepare('SELECT id FROM categories WHERE name = ?').get(trimmed);
  if (exists) return exists.id;
  const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
  console.log(`Created category: ${trimmed}`);
  return info.lastInsertRowid;
}

function upsertIngredient(name, categoryId) {
  const trimmed = name.trim();
  if (!trimmed || !categoryId) return null;
  const exists = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(trimmed);
  if (exists) {
    // Update category if it changed
    db.prepare('UPDATE ingredients SET category_id = ? WHERE id = ?').run(categoryId, exists.id);
    return exists.id;
  }
  const info = db.prepare('INSERT INTO ingredients (name, category_id) VALUES (?, ?)').run(trimmed, categoryId);
  console.log(`  Created ingredient: ${trimmed}`);
  return info.lastInsertRowid;
}

function parseCSV(csvContent) {
  const lines = csvContent.split(/\r?\n/).filter(line => line.trim());
  const data = [];
  
  // Skip header row (first line)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Handle CSV parsing - split by comma, but handle quoted values
    let parts = [];
    let currentPart = '';
    let inQuotes = false;
    
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        parts.push(currentPart.trim());
        currentPart = '';
      } else {
        currentPart += char;
      }
    }
    parts.push(currentPart.trim());
    
    if (parts.length >= 2) {
      // Remove quotes and trim
      const ingredientName = parts[0].replace(/^["']|["']$/g, '').trim();
      const categoryName = parts[1].replace(/^["']|["']$/g, '').trim();
      
      if (ingredientName && categoryName) {
        data.push({
          ingredient: ingredientName,
          category: categoryName
        });
      }
    }
  }
  
  return data;
}

function main() {
  const csvPath = process.argv[2] || 'c:\\Users\\dell\\Downloads\\Ingredients_List_Urdu - Sheet1.csv';
  
  console.log('Starting ingredient import from CSV...');
  console.log(`Reading CSV from: ${csvPath}`);
  
  if (!fs.existsSync(csvPath)) {
    console.error(`❌ CSV file not found at: ${csvPath}`);
    console.error('Usage: node importIngredients.js <path-to-csv-file>');
    process.exit(1);
  }
  
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const data = parseCSV(csvContent);
  
  console.log(`\nFound ${data.length} ingredients to import\n`);
  
  // First, collect all unique categories
  const categoryMap = new Map();
  const ingredientList = [];
  
  for (const item of data) {
    if (!categoryMap.has(item.category)) {
      categoryMap.set(item.category, null); // Will be set to ID after creation
    }
    ingredientList.push(item);
  }
  
  // Create all categories first
  console.log('Creating categories...');
  for (const [categoryName, _] of categoryMap) {
    const categoryId = upsertCategory(categoryName);
    categoryMap.set(categoryName, categoryId);
  }
  
  // Now create ingredients with their categories
  console.log('\nCreating ingredients...');
  let createdCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;
  
  for (const item of ingredientList) {
    const categoryId = categoryMap.get(item.category);
    if (!categoryId) {
      console.warn(`⚠️  Skipping ingredient "${item.ingredient}" - category "${item.category}" not found`);
      skippedCount++;
      continue;
    }
    
    const existing = db.prepare('SELECT id FROM ingredients WHERE name = ?').get(item.ingredient);
    if (existing) {
      // Update category if it changed
      const current = db.prepare('SELECT category_id FROM ingredients WHERE id = ?').get(existing.id);
      if (current.category_id !== categoryId) {
        db.prepare('UPDATE ingredients SET category_id = ? WHERE id = ?').run(categoryId, existing.id);
        console.log(`  Updated ingredient: ${item.ingredient} (category changed)`);
        updatedCount++;
      } else {
        console.log(`  Skipped (exists): ${item.ingredient}`);
        skippedCount++;
      }
    } else {
      upsertIngredient(item.ingredient, categoryId);
      createdCount++;
    }
  }
  
  console.log('\n✅ Import complete!');
  console.log(`  Categories: ${categoryMap.size} (${Array.from(categoryMap.keys()).join(', ')})`);
  console.log(`  Ingredients created: ${createdCount}`);
  console.log(`  Ingredients updated: ${updatedCount}`);
  console.log(`  Ingredients skipped: ${skippedCount}`);
  
  // Display summary
  const totalCategories = db.prepare('SELECT COUNT(*) as count FROM categories').get().count;
  const totalIngredients = db.prepare('SELECT COUNT(*) as count FROM ingredients').get().count;
  console.log(`\n📊 Database Summary:`);
  console.log(`  Total Categories: ${totalCategories}`);
  console.log(`  Total Ingredients: ${totalIngredients}`);
}

main();

