import { Router } from 'express';
import { db, transact } from '../sqlite.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.use(requireAuth);

function computeScale(baseQuantity, requestedQuantity) {
  const b = Number(baseQuantity);
  const r = Number(requestedQuantity);
  if (!(b > 0) || !(r > 0)) throw new Error('Invalid quantities');
  return r / b;
}

router.post('/', (req, res) => {
  const { dish_id, customer_id, requested_quantity, requested_unit, overrides } = req.body;
  if (!dish_id || !customer_id || !requested_quantity || !requested_unit) return res.status(400).json({ error: 'dish_id, customer_id, requested_quantity, requested_unit required' });
  const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dish_id);
  if (!dish) return res.status(404).json({ error: 'dish not found' });
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'customer not found' });
  if (dish.base_unit !== requested_unit) return res.status(400).json({ error: `unit mismatch: dish base is ${dish.base_unit}` });
  const scale = computeScale(dish.base_quantity, requested_quantity);
  const mappings = db.prepare('SELECT * FROM dish_ingredients WHERE dish_id = ?').all(dish_id);
  const mapByIngredient = new Map(mappings.map(m => [m.ingredient_id, m]));
  let orderId;
  transact(() => {
    const info = db.prepare('INSERT INTO orders (user_id, customer_id, dish_id, requested_quantity, requested_unit, scale_factor) VALUES (?,?,?,?,?,?)')
      .run(req.user.id, customer_id, dish_id, Number(requested_quantity), requested_unit, scale);
    orderId = info.lastInsertRowid;
    const ins = db.prepare('INSERT INTO order_ingredients (order_id, ingredient_id, scaled_amount, unit) VALUES (?,?,?,?)');
    if (Array.isArray(overrides) && overrides.length > 0) {
      for (const ov of overrides) {
        const ingId = Number(ov.ingredient_id);
        const map = mapByIngredient.get(ingId);
        if (!map) continue; // ignore unknown ingredients
        const amount = Number(ov.scaled_amount);
        const unit = ov.unit || map.unit;
        if (!(amount >= 0)) continue;
        ins.run(orderId, ingId, amount, unit);
      }
    } else {
      for (const m of mappings) {
        const scaled = m.amount_per_base * scale;
        ins.run(orderId, m.ingredient_id, scaled, m.unit);
      }
    }
  });
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  res.status(201).json(order);
});

router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, d.name as dish_name, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
    FROM orders o
    JOIN dishes d ON d.id = o.dish_id
    JOIN customers c ON c.id = o.customer_id
    WHERE o.user_id = ? OR ? = 'admin'
    ORDER BY o.created_at DESC
  `).all(req.user.id, req.user.role);
  res.json(rows);
});

router.get('/:id/slips', (req, res) => {
  const { id } = req.params;
  const order = db.prepare(`
    SELECT o.*, d.name as dish_name, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address
    FROM orders o
    JOIN dishes d ON d.id = o.dish_id
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(id);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const items = db.prepare(`
    SELECT oi.*, i.name as ingredient_name
    FROM order_ingredients oi
    JOIN ingredients i ON i.id = oi.ingredient_id
    WHERE oi.order_id = ?
    ORDER BY i.name
  `).all(id);
  res.json({
    ingredientSlip: {
      order_id: order.id,
      dish_name: order.dish_name,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      requested_quantity: order.requested_quantity,
      requested_unit: order.requested_unit,
      scale_factor: order.scale_factor,
      items: items.map(x => ({ name: x.ingredient_name, amount: x.scaled_amount, unit: x.unit }))
    },
    orderSlip: {
      order_id: order.id,
      dish_name: order.dish_name,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_email: order.customer_email,
      customer_address: order.customer_address,
      quantity: order.requested_quantity,
      unit: order.requested_unit,
      created_at: order.created_at
    }
  });
});

export default router;

