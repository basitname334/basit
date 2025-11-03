import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
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

// Trust proxy for correct protocol/host when behind reverse proxies
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', true);
}

// CORS: allow configured origin(s) or fallback to * for dev
const corsOrigin = process.env.CORS_ORIGIN || '*';
app.use(cors({ origin: corsOrigin === '*' ? true : corsOrigin, credentials: true }));

// Body parsers with sensible limits
app.use(express.json({ limit: process.env.BODY_LIMIT || '10mb' }));
app.use(express.urlencoded({ extended: false, limit: process.env.BODY_LIMIT || '10mb' }));

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

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.use('/api/auth', authRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/ingredients', ingredientsRouter);
app.use('/api/dishes', dishesRouter);
app.use('/api/customers', customersRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/reports', reportsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'not_found' });
});

// Global error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'internal_error' });
});

const PORT = process.env.PORT || 4000;
const server = app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
  console.log(`Using SQLite at: ${dbPath}`);
});

function shutdown(signal) {
  console.log(`\n${signal} received. Shutting down...`);
  server.close(() => {
    try { db.close(); } catch (_) {}
    process.exit(0);
  });
  // Fallback exit if close hangs
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

