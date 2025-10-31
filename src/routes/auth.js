import { Router } from 'express';
import { db } from '../sqlite.js';
import bcrypt from 'bcryptjs';
import { signToken } from '../auth.js';
import { dbPath } from '../sqlite.js';

const router = Router();

router.post('/register', (req, res) => {
  const { email, password, role } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'invalid role' });
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizedEmail);
  if (existing) return res.status(409).json({ error: 'email already exists' });
  const password_hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)').run(normalizedEmail, password_hash, role);
  const user = { id: info.lastInsertRowid, email: normalizedEmail, role };
  const token = signToken(user);
  res.json({ token, user });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const normalizedPassword = String(password || '').trim();
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(normalizedEmail);
  if (!user) return res.status(401).json({ error: 'invalid credentials' });
  const ok = bcrypt.compareSync(normalizedPassword, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const token = signToken(user);
  res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
});

// DEV: List users (email and role) to verify DB contents
router.get('/dev-users', (req, res) => {
  try {
    const users = db.prepare('SELECT email, role FROM users ORDER BY id').all();
    res.json({ dbPath, users });
  } catch (e) {
    res.status(500).json({ error: 'failed to fetch users' });
  }
});

export default router;

