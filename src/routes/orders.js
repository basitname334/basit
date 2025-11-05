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

// Create order with multiple dishes
router.post('/', (req, res) => {
  const { customer_id, dishes, person_count, booking_date, booking_time, delivery_date, delivery_time, delivery_address, notes } = req.body;
  
  if (!customer_id) return res.status(400).json({ error: 'customer_id required' });
  if (!Array.isArray(dishes) || dishes.length === 0) return res.status(400).json({ error: 'at least one dish required' });
  
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customer_id);
  if (!customer) return res.status(404).json({ error: 'customer not found' });
  
  let orderId;
  transact(() => {
    // Create the order
    const orderInfo = db.prepare(`
      INSERT INTO orders (user_id, customer_id, person_count, booking_date, booking_time, delivery_date, delivery_time, delivery_address, notes)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(
      req.user.id,
      customer_id,
      person_count || null,
      booking_date || null,
      booking_time || null,
      delivery_date || null,
      delivery_time || null,
      delivery_address || null,
      notes || null
    );
    orderId = orderInfo.lastInsertRowid;
    
    // Process each dish
    for (const dishData of dishes) {
      const { dish_id, requested_quantity, requested_unit, overrides } = dishData;
      if (!dish_id || !requested_quantity || !requested_unit) continue;
      
      const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dish_id);
      if (!dish) continue;
      
      if (dish.base_unit !== requested_unit) continue;
      
      const scale = computeScale(dish.base_quantity, requested_quantity);
      const mappings = db.prepare('SELECT * FROM dish_ingredients WHERE dish_id = ?').all(dish_id);
      const mapByIngredient = new Map(mappings.map(m => [m.ingredient_id, m]));
      
      // Create order item
      const itemInfo = db.prepare(`
        INSERT INTO order_items (order_id, dish_id, requested_quantity, requested_unit, scale_factor)
        VALUES (?,?,?,?,?)
      `).run(orderId, dish_id, Number(requested_quantity), requested_unit, scale);
      const itemId = itemInfo.lastInsertRowid;
      
      // Create order ingredients
      const ins = db.prepare('INSERT INTO order_ingredients (order_item_id, ingredient_id, scaled_amount, unit) VALUES (?,?,?,?)');
      
      if (Array.isArray(overrides) && overrides.length > 0) {
        for (const ov of overrides) {
          const ingId = Number(ov.ingredient_id);
          const map = mapByIngredient.get(ingId);
          if (!map) continue;
          const amount = Number(ov.scaled_amount);
          const unit = ov.unit || map.unit;
          if (!(amount >= 0)) continue;
          ins.run(itemId, ingId, amount, unit);
        }
      } else {
        for (const m of mappings) {
          const scaled = m.amount_per_base * scale;
          ins.run(itemId, m.ingredient_id, scaled, m.unit);
        }
      }
    }
  });
  
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(orderId);
  
  res.status(201).json(order);
});

// Get all orders with items
router.get('/', (req, res) => {
  const rows = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.user_id = ? OR ? = 'admin'
    ORDER BY o.created_at DESC
  `).all(req.user.id, req.user.role);
  
  // Get items for each order
  const ordersWithItems = rows.map(order => {
    const items = db.prepare(`
      SELECT oi.*, d.name as dish_name
      FROM order_items oi
      JOIN dishes d ON d.id = oi.dish_id
      WHERE oi.order_id = ?
      ORDER BY oi.id
    `).all(order.id);
    
    return {
      ...order,
      dishes: items.map(item => ({
        id: item.id,
        dish_id: item.dish_id,
        dish_name: item.dish_name,
        requested_quantity: item.requested_quantity,
        requested_unit: item.requested_unit,
        scale_factor: item.scale_factor
      }))
    };
  });
  
  res.json(ordersWithItems);
});

// Get single order with full details
router.get('/:id', (req, res) => {
  const { id } = req.params;
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(id);
  
  if (!order) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  
  const items = db.prepare(`
    SELECT oi.*, d.name as dish_name
    FROM order_items oi
    JOIN dishes d ON d.id = oi.dish_id
    WHERE oi.order_id = ?
    ORDER BY oi.id
  `).all(id);
  
  const itemsWithIngredients = items.map(item => {
    const ingredients = db.prepare(`
      SELECT oi.*, i.name as ingredient_name
      FROM order_ingredients oi
      JOIN ingredients i ON i.id = oi.ingredient_id
      WHERE oi.order_item_id = ?
      ORDER BY i.name
    `).all(item.id);
    
    return {
      ...item,
      ingredients: ingredients.map(ing => ({
        name: ing.ingredient_name,
        amount: ing.scaled_amount,
        unit: ing.unit
      }))
    };
  });
  
  res.json({
    ...order,
    items: itemsWithIngredients
  });
});

// Update order
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { customer_id, dishes, person_count, booking_date, booking_time, delivery_date, delivery_time, delivery_address, notes } = req.body;
  
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  
  transact(() => {
    // Update order
    db.prepare(`
      UPDATE orders 
      SET customer_id = COALESCE(?, customer_id),
          person_count = COALESCE(?, person_count),
          booking_date = COALESCE(?, booking_date),
          booking_time = COALESCE(?, booking_time),
          delivery_date = COALESCE(?, delivery_date),
          delivery_time = COALESCE(?, delivery_time),
          delivery_address = COALESCE(?, delivery_address),
          notes = COALESCE(?, notes)
      WHERE id = ?
    `).run(customer_id, person_count, booking_date, booking_time, delivery_date, delivery_time, delivery_address, notes, id);
    
    // If dishes are provided, update items
    if (Array.isArray(dishes)) {
      // Delete existing items and recreate
      db.prepare('DELETE FROM order_items WHERE order_id = ?').run(id);
      
      for (const dishData of dishes) {
        const { dish_id, requested_quantity, requested_unit, overrides } = dishData;
        if (!dish_id || !requested_quantity || !requested_unit) continue;
        
        const dish = db.prepare('SELECT * FROM dishes WHERE id = ?').get(dish_id);
        if (!dish) continue;
        
        const scale = computeScale(dish.base_quantity, requested_quantity);
        const mappings = db.prepare('SELECT * FROM dish_ingredients WHERE dish_id = ?').all(dish_id);
        
        const itemInfo = db.prepare(`
          INSERT INTO order_items (order_id, dish_id, requested_quantity, requested_unit, scale_factor)
          VALUES (?,?,?,?,?)
        `).run(id, dish_id, Number(requested_quantity), requested_unit, scale);
        const itemId = itemInfo.lastInsertRowid;
        
        const ins = db.prepare('INSERT INTO order_ingredients (order_item_id, ingredient_id, scaled_amount, unit) VALUES (?,?,?,?)');
        for (const m of mappings) {
          const scaled = m.amount_per_base * scale;
          ins.run(itemId, m.ingredient_id, scaled, m.unit);
        }
      }
    }
  });
  
  res.json({ ok: true });
});

// Delete order
router.delete('/:id', (req, res) => {
  const { id } = req.params;
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  
  db.prepare('DELETE FROM orders WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Get slips
router.get('/:id/slips', (req, res) => {
  const { id } = req.params;
  const order = db.prepare(`
    SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email, c.address as customer_address
    FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = ?
  `).get(id);
  if (!order) return res.status(404).json({ error: 'not found' });
  if (req.user.role !== 'admin' && order.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  
  // Get all items with their ingredients
  const items = db.prepare(`
    SELECT oi.*, d.name as dish_name
    FROM order_items oi
    JOIN dishes d ON d.id = oi.dish_id
    WHERE oi.order_id = ?
    ORDER BY oi.id
  `).all(id);
  
  // Aggregate ingredients across all dishes
  const ingredientMap = new Map();
  const dishList = [];
  
  for (const item of items) {
    dishList.push({
      dish_name: item.dish_name,
      quantity: item.requested_quantity,
      unit: item.requested_unit
    });
    
    const ingredients = db.prepare(`
      SELECT oi.*, i.name as ingredient_name
      FROM order_ingredients oi
      JOIN ingredients i ON i.id = oi.ingredient_id
      WHERE oi.order_item_id = ?
      ORDER BY i.name
    `).all(item.id);
    
    for (const ing of ingredients) {
      const key = `${ing.ingredient_name}_${ing.unit}`;
      if (ingredientMap.has(key)) {
        ingredientMap.set(key, {
          ...ingredientMap.get(key),
          amount: ingredientMap.get(key).amount + ing.scaled_amount
        });
      } else {
        ingredientMap.set(key, {
          name: ing.ingredient_name,
          amount: ing.scaled_amount,
          unit: ing.unit
        });
      }
    }
  }
  
  res.json({
    ingredientSlip: {
      order_id: order.id,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      dishes: dishList,
      items: Array.from(ingredientMap.values())
    },
    orderSlip: {
      order_id: order.id,
      customer_name: order.customer_name,
      customer_phone: order.customer_phone,
      customer_email: order.customer_email,
      customer_address: order.customer_address || order.delivery_address,
      person_count: order.person_count,
      booking_date: order.booking_date,
      booking_time: order.booking_time,
      delivery_date: order.delivery_date,
      delivery_time: order.delivery_time,
      dishes: dishList,
      created_at: order.created_at,
      notes: order.notes
    }
  });
});

export default router;
