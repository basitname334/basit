import { Router } from 'express';
import { db } from '../sqlite.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(rows);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name } = req.body;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO categories (name) VALUES (?)').run(trimmed);
    res.status(201).json({ id: info.lastInsertRowid, name: trimmed });
  } catch (e) {
    const msg = (e && e.message) || '';
    if (msg.includes('UNIQUE constraint failed') || msg.toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'category already exists' });
    }
    res.status(400).json({ error: 'invalid request' });
  }
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  const stmt = db.prepare('UPDATE categories SET name = COALESCE(?, name) WHERE id = ?');
  const info = stmt.run(name ?? null, id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  // Check if any ingredients use this category
  const hasIngredients = db.prepare('SELECT COUNT(*) as count FROM ingredients WHERE category_id = ?').get(id);
  if (hasIngredients.count > 0) {
    return res.status(400).json({ error: 'Cannot delete category that has ingredients. Please remove or reassign ingredients first.' });
  }
  const info = db.prepare('DELETE FROM categories WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

export default router;

