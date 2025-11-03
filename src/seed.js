import dotenv from 'dotenv';
dotenv.config();
import { connectDB, getDB, toObjectId } from './mongodb.js';
import bcrypt from 'bcryptjs';

async function upsertUser(email, password, role) {
  const db = await getDB();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const exists = await db.collection('users').findOne({ email: normalizedEmail });
  if (exists) return exists._id.toString();
  const hash = bcrypt.hashSync(password, 10);
  const result = await db.collection('users').insertOne({
    email: normalizedEmail,
    password_hash: hash,
    role,
    created_at: new Date().toISOString()
  });
  console.log(`Created user ${normalizedEmail} (${role})`);
  return result.insertedId.toString();
}

async function upsertCategory(name) {
  const db = await getDB();
  const exists = await db.collection('categories').findOne({ name });
  if (exists) return exists._id.toString();
  const result = await db.collection('categories').insertOne({
    name,
    created_at: new Date().toISOString()
  });
  console.log(`Created category ${name}`);
  return result.insertedId.toString();
}

async function upsertIngredient(name, categoryId) {
  const db = await getDB();
  const exists = await db.collection('ingredients').findOne({ name });
  if (exists) return exists._id.toString();
  const result = await db.collection('ingredients').insertOne({
    name,
    category_id: categoryId,
    created_at: new Date().toISOString()
  });
  return result.insertedId.toString();
}

async function upsertDish(name, base_quantity, base_unit) {
  const db = await getDB();
  const exists = await db.collection('dishes').findOne({ name });
  if (exists) return exists._id.toString();
  const result = await db.collection('dishes').insertOne({
    name,
    base_quantity,
    base_unit,
    created_at: new Date().toISOString()
  });
  return result.insertedId.toString();
}

async function main() {
  try {
    await connectDB();
    
    await upsertUser('admin@example.com', 'admin123', 'admin');
    await upsertUser('user@example.com', 'user123', 'user');

    // Create categories first
    const grainsCategory = await upsertCategory('Grains');
    const liquidsCategory = await upsertCategory('Liquids');
    const seasoningsCategory = await upsertCategory('Seasonings');

    // Then create ingredients with category_id
    const rice = await upsertIngredient('Rice', grainsCategory);
    const water = await upsertIngredient('Water', liquidsCategory);
    const salt = await upsertIngredient('Salt', seasoningsCategory);

    const dishId = await upsertDish('Plain Boiled Rice', 1, 'kg');
    const db = await getDB();
    const dish = await db.collection('dishes').findOne({ _id: toObjectId(dishId) });
    
    if (!dish.ingredients || dish.ingredients.length === 0) {
      await db.collection('dishes').updateOne(
        { _id: toObjectId(dishId) },
        {
          $set: {
            ingredients: [
              { ingredient_id: rice, amount_per_base: 1, unit: 'kg' },
              { ingredient_id: water, amount_per_base: 1.5, unit: 'litre' },
              { ingredient_id: salt, amount_per_base: 10, unit: 'g' }
            ]
          }
        }
      );
      console.log('Seeded dish ingredients for Plain Boiled Rice');
    }

    console.log('Seed complete');
    process.exit(0);
  } catch (error) {
    console.error('Seed error:', error);
    process.exit(1);
  }
}

main();

