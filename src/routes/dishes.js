import { Router } from 'express';
import { db, transact } from '../sqlite.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const dishes = db.prepare('SELECT * FROM dishes ORDER BY name').all();
  const mapStmt = db.prepare(`
    SELECT di.*, i.name as ingredient_name
    FROM dish_ingredients di
    JOIN ingredients i ON i.id = di.ingredient_id
    WHERE di.dish_id = ?
    ORDER BY i.name
  `);
  const enriched = dishes.map(d => ({
    ...d,
    ingredients: mapStmt.all(d.id)
  }));
  res.json(enriched);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name, base_quantity, base_unit, price_per_base, cost_per_base, ingredients } = req.body;
  if (!name || !base_quantity || !base_unit) return res.status(400).json({ error: 'name, base_quantity, base_unit required' });
  transact(() => {
    const info = db.prepare('INSERT INTO dishes (name, base_quantity, base_unit, price_per_base, cost_per_base) VALUES (?,?,?,?,?)')
      .run(name.trim(), Number(base_quantity), base_unit.trim(),
        price_per_base != null ? Number(price_per_base) : null,
        cost_per_base != null ? Number(cost_per_base) : null);
    const dishId = info.lastInsertRowid;
    if (Array.isArray(ingredients)) {
      const ins = db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, amount_per_base, unit) VALUES (?,?,?,?)');
      for (const ing of ingredients) {
        ins.run(dishId, ing.ingredient_id, Number(ing.amount_per_base), ing.unit);
      }
    }
    const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dishId);
    res.status(201).json(dish);
  });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const { name, base_quantity, base_unit, price_per_base, cost_per_base, ingredients } = req.body;
  transact(() => {
    db.prepare('UPDATE dishes SET name = COALESCE(?, name), base_quantity = COALESCE(?, base_quantity), base_unit = COALESCE(?, base_unit), price_per_base = COALESCE(?, price_per_base), cost_per_base = COALESCE(?, cost_per_base) WHERE id = ?')
      .run(name ?? null, base_quantity ?? null, base_unit ?? null,
        price_per_base ?? null, cost_per_base ?? null, id);
    if (Array.isArray(ingredients)) {
      db.prepare('DELETE FROM dish_ingredients WHERE dish_id = ?').run(id);
      const ins = db.prepare('INSERT INTO dish_ingredients (dish_id, ingredient_id, amount_per_base, unit) VALUES (?,?,?,?)');
      for (const ing of ingredients) {
        ins.run(id, ing.ingredient_id, Number(ing.amount_per_base), ing.unit);
      }
    }
  });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const { id } = req.params;
  const info = db.prepare('DELETE FROM dishes WHERE id = ?').run(id);
  if (info.changes === 0) return res.status(404).json({ error: 'not found' });
  res.json({ ok: true });
});

export default router;

