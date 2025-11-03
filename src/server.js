import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { connectDB, getDB } from './mongodb.js';
import authRouter from './routes/auth.js';
import categoriesRouter from './routes/categories.js';
import ingredientsRouter from './routes/ingredients.js';
import dishesRouter from './routes/dishes.js';
import customersRouter from './routes/customers.js';
import ordersRouter from './routes/orders.js';
import reportsRouter from './routes/reports.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB
connectDB().catch(console.error);

async function ensureDefaultUsers() {
  const db = await getDB();
  const defaults = [
    { email: 'admin@example.com', password: 'admin123', role: 'admin' },
    { email: 'user@example.com', password: 'user123', role: 'user' },
  ];
  for (const u of defaults) {
    const email = u.email;
    const exists = await db.collection('users').findOne({ email });
    if (!exists) {
      const hash = bcrypt.hashSync(u.password, 10);
      await db.collection('users').insertOne({
        email,
        password_hash: hash,
        role: u.role,
        created_at: new Date().toISOString()
      });
      console.log(`Created default user ${email} (${u.role})`);
    }
  }
}

// Initialize default users after connection
connectDB().then(() => {
  ensureDefaultUsers().catch(console.error);
});

// Enhanced health check endpoint with database status
app.get('/api/health', async (req, res) => {
  const healthStatus = {
    ok: true,
    timestamp: new Date().toISOString(),
    database: {
      type: 'MongoDB',
      connected: false
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      render: !!process.env.RENDER
    }
  };

  // Test database connection
  try {
    const db = await getDB();
    await db.admin().ping();
    healthStatus.database.connected = true;
  } catch (err) {
    healthStatus.database.connected = false;
    healthStatus.database.error = err.message;
    healthStatus.ok = false;
  }

  const statusCode = healthStatus.ok ? 200 : 503;
  res.status(statusCode).json(healthStatus);
});

// Keep-alive endpoint for external monitoring services
// Use this with a service like UptimeRobot or cron to prevent Render spin-down
app.get('/api/ping', (req, res) => {
  res.json({ 
    pong: true, 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/dishes', dishesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reports', reportsRouter);

const PORT = process.env.PORT || 4000;
app.listen(PORT, async () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Using MongoDB`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  try {
    await connectDB();
    console.log('MongoDB connected successfully');
  } catch (err) {
    console.error('Failed to connect to MongoDB:', err);
  }
});

