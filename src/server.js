import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';
import { db, ensureSchema, dbPath } from './sqlite.js';
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

ensureSchema();

function ensureDefaultUsers() {
  const defaults = [
    { email: 'admin@example.com', password: 'admin123', role: 'admin' },
    { email: 'user@example.com', password: 'user123', role: 'user' },
  ];
  for (const u of defaults) {
    const email = u.email;
    const exists = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (!exists) {
      const hash = bcrypt.hashSync(u.password, 10);
      db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?,?,?)').run(email, hash, u.role);
      console.log(`Created default user ${email} (${u.role})`);
    }
  }
}

ensureDefaultUsers();

// Enhanced health check endpoint with database status
app.get('/api/health', (req, res) => {
  const healthStatus = {
    ok: true,
    timestamp: new Date().toISOString(),
    database: {
      path: dbPath,
      exists: fs.existsSync(dbPath),
      writable: false,
      size: null,
      lastModified: null
    },
    environment: {
      nodeEnv: process.env.NODE_ENV || 'development',
      render: !!process.env.RENDER,
      persistentDiskPath: process.env.PERSISTENT_DISK_PATH || '/tmp/data'
    }
  };

  // Check database file status
  if (fs.existsSync(dbPath)) {
    try {
      const stats = fs.statSync(dbPath);
      healthStatus.database.size = stats.size;
      healthStatus.database.lastModified = stats.mtime.toISOString();
      fs.accessSync(path.dirname(dbPath), fs.constants.W_OK);
      healthStatus.database.writable = true;
    } catch (err) {
      healthStatus.database.error = err.message;
    }
  } else {
    // Check if directory is writable
    try {
      const dbDir = path.dirname(dbPath);
      if (fs.existsSync(dbDir)) {
        fs.accessSync(dbDir, fs.constants.W_OK);
        healthStatus.database.writable = true;
      }
    } catch (err) {
      healthStatus.database.error = `Directory not writable: ${err.message}`;
    }
  }

  // Test database connection
  try {
    db.prepare('SELECT 1').get();
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
app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Using SQLite at: ${dbPath}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  if (process.env.SQLITE_PATH) {
    console.log(`Database path from SQLITE_PATH env var: ${process.env.SQLITE_PATH}`);
  }
});

