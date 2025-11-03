import { Router } from 'express';
import { db } from '../sqlite.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM customers ORDER BY name').all();
  res.json(rows);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, phone, email, address } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  try {
    const info = db.prepare('INSERT INTO customers (name, phone, email, address) VALUES (?, ?, ?, ?)')
      .run(name.trim(), phone?.trim() || null, email?.trim() || null, address?.trim() || null);
    res.status(201).json({ id: info.lastInsertRowid, name: name.trim(), phone, email, address });
  } catch (e) {
    res.status(400).json({ error: 'duplicate or invalid' });
  }
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, phone, email, address } = req.body;
  const stmt = db.prepare('UPDATE customers SET name = COALESCE(?, name), phone = COALESCE(?, phone), email = COALESCE(?, email), address = COALESCE(?, address) WHERE id = ?');
  const info = stmt.run(name ?? null, phone ?? null, email ?? null, address ?? null, id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  // Check if any orders use this customer
  const hasOrders = db.prepare('SELECT COUNT(*) as count FROM orders WHERE customer_id = ?').get(id);
  if (hasOrders.count > 0) {
    return res.status(400).json({ error: 'Cannot delete customer that has orders. Please remove or reassign orders first.' });
  }
  const info = db.prepare('DELETE FROM customers WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

export default router;

