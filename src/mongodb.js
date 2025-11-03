import { MongoClient, ObjectId } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config();

// MongoDB connection string
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://abasit5612345_db_user:9JxWHL7XmxR0IVof@cluster0.jlfxnb0.mongodb.net/?appName=Cluster0';
const DB_NAME = process.env.DB_NAME || 'pos_db';

let client = null;
let db = null;

export async function connectDB() {
  if (db) {
    return db;
  }

  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db(DB_NAME);
    console.log(`[Database] Connected to MongoDB: ${DB_NAME}`);
    await ensureIndexes();
    return db;
  } catch (error) {
    console.error('[Database] Connection error:', error);
    throw error;
  }
}

export async function closeDB() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    console.log('[Database] MongoDB connection closed');
  }
}

// Create indexes for better performance
async function ensureIndexes() {
  try {
    // Users collection
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    
    // Categories collection
    await db.collection('categories').createIndex({ name: 1 }, { unique: true });
    
    // Ingredients collection
    await db.collection('ingredients').createIndex({ name: 1 }, { unique: true });
    await db.collection('ingredients').createIndex({ category_id: 1 });
    
    // Dishes collection
    await db.collection('dishes').createIndex({ name: 1 }, { unique: true });
    
    // Customers collection
    await db.collection('customers').createIndex({ name: 1 });
    
    // Orders collection
    await db.collection('orders').createIndex({ user_id: 1 });
    await db.collection('orders').createIndex({ customer_id: 1 });
    await db.collection('orders').createIndex({ dish_id: 1 });
    await db.collection('orders').createIndex({ created_at: -1 });
    
    console.log('[Database] Indexes ensured');
  } catch (error) {
    console.error('[Database] Error ensuring indexes:', error);
  }
}

// Get database instance
export async function getDB() {
  if (!db) {
    await connectDB();
  }
  return db;
}

// Helper function to convert MongoDB ObjectId to string for responses
export function toObjectId(id) {
  return ObjectId.isValid(id) ? new ObjectId(id) : null;
}

