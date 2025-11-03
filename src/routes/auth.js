import { Router } from 'express';
import { getDB } from '../mongodb.js';
import bcrypt from 'bcryptjs';
import { signToken } from '../auth.js';

const router = Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, role } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });
    if (!['admin', 'user'].includes(role)) return res.status(400).json({ error: 'invalid role' });
    
    const db = await getDB();
    const existing = await db.collection('users').findOne({ email: normalizedEmail });
    if (existing) return res.status(409).json({ error: 'email already exists' });
    
    const password_hash = bcrypt.hashSync(password, 10);
    const result = await db.collection('users').insertOne({
      email: normalizedEmail,
      password_hash,
      role,
      created_at: new Date().toISOString()
    });
    
    const user = { id: result.insertedId.toString(), email: normalizedEmail, role };
    const token = signToken(user);
    res.json({ token, user });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedPassword = String(password || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    
    const db = await getDB();
    const user = await db.collection('users').findOne({ email: normalizedEmail });
    if (!user) return res.status(401).json({ error: 'invalid credentials' });
    
    const ok = bcrypt.compareSync(normalizedPassword, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'invalid credentials' });
    
    const token = signToken({ id: user._id.toString(), email: user.email, role: user.role });
    res.json({ token, user: { id: user._id.toString(), email: user.email, role: user.role } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// DEV: List users (email and role) to verify DB contents
router.get('/dev-users', async (req, res) => {
  try {
    const db = await getDB();
    const users = await db.collection('users').find({}, { projection: { email: 1, role: 1 } }).sort({ _id: 1 }).toArray();
    const formattedUsers = users.map(u => ({ email: u.email, role: u.role }));
    res.json({ users: formattedUsers });
  } catch (e) {
    res.status(500).json({ error: 'failed to fetch users' });
  }
});

export default router;

