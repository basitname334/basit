import { Router } from 'express';
import { db } from '../sqlite.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT i.*, c.name as category_name 
    FROM ingredients i 
    JOIN categories c ON i.category_id = c.id 
    ORDER BY i.name
  `).all();
  res.json(rows);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, category_id } = req.body;
  if (!name || !category_id) return res.status(400).json({ error: 'name and category_id required' });
  try {
    // Verify category exists
    const category = db.prepare('SELECT id, name FROM categories WHERE id = ?').get(category_id);
    if (!category) return res.status(400).json({ error: 'category not found' });
    
    const info = db.prepare('INSERT INTO ingredients (name, category_id) VALUES (?, ?)').run(name.trim(), category_id);
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), category_id, category_name: category.name });
  } catch (e) {
    res.status(400).json({ error: 'duplicate or invalid' });
  }
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, category_id } = req.body;
  
  // If category_id is provided, verify it exists
  if (category_id !== undefined && category_id !== null) {
    const category = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
    if (!category) return res.status(400).json({ error: 'category not found' });
  }
  
  const stmt = db.prepare('UPDATE ingredients SET name = COALESCE(?, name), category_id = COALESCE(?, category_id) WHERE id = ?');
  const info = stmt.run(name ?? null, category_id ?? null, id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM ingredients WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

export default router;

