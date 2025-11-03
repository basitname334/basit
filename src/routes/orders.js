import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth } from '../auth.js';

const router = Router();

router.use(requireAuth);

function computeScale(baseQuantity, requestedQuantity) {
  const b = Number(baseQuantity);
  const r = Number(requestedQuantity);
  if (!(b > 0) || !(r > 0)) throw new Error('Invalid quantities');
  return r / b;
}

router.post('/', async (req, res) => {
  try {
    const { dish_id, customer_id, requested_quantity, requested_unit, overrides, booking_date, booking_time, delivery_date, delivery_time, delivery_address, number_of_persons } = req.body;
    if (!dish_id || !customer_id || !requested_quantity || !requested_unit) {
      return res.status(400).json({ error: 'dish_id, customer_id, requested_quantity, requested_unit required' });
    }
    
    const db = await getDB();
    const dish = await db.collection('dishes').findOne({ _id: toObjectId(dish_id) });
    if (!dish) return res.status(404).json({ error: 'dish not found' });
    
    const customer = await db.collection('customers').findOne({ _id: toObjectId(customer_id) });
    if (!customer) return res.status(404).json({ error: 'customer not found' });
    
    if (dish.base_unit !== requested_unit) {
      return res.status(400).json({ error: `unit mismatch: dish base is ${dish.base_unit}` });
    }
    
    const scale = computeScale(dish.base_quantity, requested_quantity);
    const mappings = dish.ingredients || [];
    const mapByIngredient = new Map(mappings.map(m => [m.ingredient_id, m]));
    
    let orderIngredients = [];
    if (Array.isArray(overrides) && overrides.length > 0) {
      for (const ov of overrides) {
        const ingId = ov.ingredient_id;
        const map = mapByIngredient.get(ingId);
        if (!map) continue;
        const amount = Number(ov.scaled_amount);
        const unit = ov.unit || map.unit;
        if (!(amount >= 0)) continue;
        orderIngredients.push({
          ingredient_id: ingId,
          scaled_amount: amount,
          unit: unit
        });
      }
    } else {
      orderIngredients = mappings.map(m => ({
        ingredient_id: m.ingredient_id,
        scaled_amount: m.amount_per_base * scale,
        unit: m.unit
      }));
    }
    
    const order = {
      user_id: req.user.id,
      customer_id: customer_id,
      dish_id: dish_id,
      requested_quantity: Number(requested_quantity),
      requested_unit: requested_unit,
      scale_factor: scale,
      booking_date: booking_date || null,
      booking_time: booking_time || null,
      delivery_date: delivery_date || null,
      delivery_time: delivery_time || null,
      delivery_address: delivery_address || null,
      number_of_persons: number_of_persons ? Number(number_of_persons) : null,
      ingredients: orderIngredients,
      created_at: new Date().toISOString()
    };
    
    const result = await db.collection('orders').insertOne(order);
    const createdOrder = await db.collection('orders').findOne({ _id: result.insertedId });
    
    res.status(201).json({
      id: createdOrder._id.toString(),
      user_id: createdOrder.user_id,
      customer_id: createdOrder.customer_id,
      dish_id: createdOrder.dish_id,
      requested_quantity: createdOrder.requested_quantity,
      requested_unit: createdOrder.requested_unit,
      scale_factor: createdOrder.scale_factor,
      booking_date: createdOrder.booking_date,
      booking_time: createdOrder.booking_time,
      delivery_date: createdOrder.delivery_date,
      delivery_time: createdOrder.delivery_time,
      delivery_address: createdOrder.delivery_address,
      number_of_persons: createdOrder.number_of_persons,
      created_at: createdOrder.created_at
    });
  } catch (error) {
    console.error('Orders POST error:', error);
    res.status(500).json({ error: 'Failed to create order' });
  }
});

router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const query = req.user.role !== 'admin' ? { user_id: req.user.id } : {};
    const orders = await db.collection('orders').find(query).sort({ created_at: -1 }).toArray();
    
    // Enrich with dish and customer info
    const dishIds = [...new Set(orders.map(o => o.dish_id))];
    const customerIds = [...new Set(orders.map(o => o.customer_id))];
    
    const dishes = await db.collection('dishes').find({
      _id: { $in: dishIds.map(id => toObjectId(id)).filter(Boolean) }
    }).toArray();
    const customers = await db.collection('customers').find({
      _id: { $in: customerIds.map(id => toObjectId(id)).filter(Boolean) }
    }).toArray();
    
    const dishMap = new Map(dishes.map(d => [d._id.toString(), d.name]));
    const customerMap = new Map(customers.map(c => [c._id.toString(), c]));
    
    const enriched = orders.map(o => ({
      id: o._id.toString(),
      user_id: o.user_id,
      customer_id: o.customer_id,
      dish_id: o.dish_id,
      dish_name: dishMap.get(o.dish_id) || null,
      customer_name: customerMap.get(o.customer_id)?.name || null,
      customer_phone: customerMap.get(o.customer_id)?.phone || null,
      customer_email: customerMap.get(o.customer_id)?.email || null,
      requested_quantity: o.requested_quantity,
      requested_unit: o.requested_unit,
      scale_factor: o.scale_factor,
      booking_date: o.booking_date,
      booking_time: o.booking_time,
      delivery_date: o.delivery_date,
      delivery_time: o.delivery_time,
      delivery_address: o.delivery_address,
      number_of_persons: o.number_of_persons,
      created_at: o.created_at
    }));
    
    res.json(enriched);
  } catch (error) {
    console.error('Orders GET error:', error);
    res.status(500).json({ error: 'Failed to fetch orders' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: objectId });
    if (!order) return res.status(404).json({ error: 'not found' });
    
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    
    const dish = await db.collection('dishes').findOne({ _id: toObjectId(order.dish_id) });
    const customer = await db.collection('customers').findOne({ _id: toObjectId(order.customer_id) });
    
    res.json({
      id: order._id.toString(),
      user_id: order.user_id,
      customer_id: order.customer_id,
      dish_id: order.dish_id,
      dish_name: dish?.name || null,
      customer_name: customer?.name || null,
      customer_phone: customer?.phone || null,
      customer_email: customer?.email || null,
      requested_quantity: order.requested_quantity,
      requested_unit: order.requested_unit,
      scale_factor: order.scale_factor,
      booking_date: order.booking_date,
      booking_time: order.booking_time,
      delivery_date: order.delivery_date,
      delivery_time: order.delivery_time,
      delivery_address: order.delivery_address,
      number_of_persons: order.number_of_persons,
      created_at: order.created_at
    });
  } catch (error) {
    console.error('Orders GET by ID error:', error);
    res.status(500).json({ error: 'Failed to fetch order' });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: objectId });
    if (!order) return res.status(404).json({ error: 'order not found' });
    
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    
    const { customer_id, dish_id, requested_quantity, requested_unit, booking_date, booking_time, delivery_date, delivery_time, delivery_address, number_of_persons } = req.body;
    
    let scale = order.scale_factor;
    let dish = await db.collection('dishes').findOne({ _id: toObjectId(dish_id || order.dish_id) });
    if (!dish) return res.status(404).json({ error: 'dish not found' });
    
    const finalDishId = dish_id || order.dish_id;
    const finalCustomerId = customer_id ? customer_id : order.customer_id;
    const finalQuantity = requested_quantity ? Number(requested_quantity) : order.requested_quantity;
    const finalUnit = requested_unit || order.requested_unit;
    
    if (dish.base_unit !== finalUnit) {
      return res.status(400).json({ error: `unit mismatch: dish base is ${dish.base_unit}` });
    }
    
    if (requested_quantity || requested_unit || dish_id) {
      scale = computeScale(dish.base_quantity, finalQuantity);
    }
    
    const update = {
      customer_id: finalCustomerId,
      dish_id: finalDishId,
      requested_quantity: finalQuantity,
      requested_unit: finalUnit,
      scale_factor: scale,
      booking_date: booking_date !== undefined ? booking_date : order.booking_date,
      booking_time: booking_time !== undefined ? booking_time : order.booking_time,
      delivery_date: delivery_date !== undefined ? delivery_date : order.delivery_date,
      delivery_time: delivery_time !== undefined ? delivery_time : order.delivery_time,
      delivery_address: delivery_address !== undefined ? delivery_address : order.delivery_address,
      number_of_persons: number_of_persons !== undefined ? (number_of_persons ? Number(number_of_persons) : null) : order.number_of_persons
    };
    
    // Recalculate ingredients if quantity/unit/dish changed
    if (requested_quantity || requested_unit || dish_id) {
      const mappings = dish.ingredients || [];
      update.ingredients = mappings.map(m => ({
        ingredient_id: m.ingredient_id,
        scaled_amount: m.amount_per_base * scale,
        unit: m.unit
      }));
    }
    
    await db.collection('orders').updateOne(
      { _id: objectId },
      { $set: update }
    );
    
    const updatedOrder = await db.collection('orders').findOne({ _id: objectId });
    res.json({
      id: updatedOrder._id.toString(),
      user_id: updatedOrder.user_id,
      customer_id: updatedOrder.customer_id,
      dish_id: updatedOrder.dish_id,
      requested_quantity: updatedOrder.requested_quantity,
      requested_unit: updatedOrder.requested_unit,
      scale_factor: updatedOrder.scale_factor,
      booking_date: updatedOrder.booking_date,
      booking_time: updatedOrder.booking_time,
      delivery_date: updatedOrder.delivery_date,
      delivery_time: updatedOrder.delivery_time,
      delivery_address: updatedOrder.delivery_address,
      number_of_persons: updatedOrder.number_of_persons,
      created_at: updatedOrder.created_at
    });
  } catch (error) {
    console.error('Orders PUT error:', error);
    res.status(500).json({ error: 'Failed to update order' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: objectId });
    if (!order) return res.status(404).json({ error: 'order not found' });
    
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    
    await db.collection('orders').deleteOne({ _id: objectId });
    res.status(204).send();
  } catch (error) {
    console.error('Orders DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete order' });
  }
});

router.get('/:id/slips', async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const order = await db.collection('orders').findOne({ _id: objectId });
    if (!order) return res.status(404).json({ error: 'not found' });
    
    if (req.user.role !== 'admin' && order.user_id !== req.user.id) {
      return res.status(403).json({ error: 'forbidden' });
    }
    
    const dish = await db.collection('dishes').findOne({ _id: toObjectId(order.dish_id) });
    const customer = await db.collection('customers').findOne({ _id: toObjectId(order.customer_id) });
    
    const ingredientIds = (order.ingredients || []).map(ing => toObjectId(ing.ingredient_id)).filter(Boolean);
    const ingredients = await db.collection('ingredients').find({
      _id: { $in: ingredientIds }
    }).toArray();
    const ingredientMap = new Map(ingredients.map(i => [i._id.toString(), i.name]));
    
    const items = (order.ingredients || []).map(oi => ({
      name: ingredientMap.get(oi.ingredient_id) || null,
      amount: oi.scaled_amount,
      unit: oi.unit
    })).sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    res.json({
      ingredientSlip: {
        order_id: order._id.toString(),
        dish_name: dish?.name || null,
        customer_name: customer?.name || null,
        customer_phone: customer?.phone || null,
        requested_quantity: order.requested_quantity,
        requested_unit: order.requested_unit,
        scale_factor: order.scale_factor,
        items: items
      },
      orderSlip: {
        order_id: order._id.toString(),
        dish_name: dish?.name || null,
        customer_name: customer?.name || null,
        customer_phone: customer?.phone || null,
        customer_email: customer?.email || null,
        customer_address: customer?.address || null,
        quantity: order.requested_quantity,
        unit: order.requested_unit,
        created_at: order.created_at
      }
    });
  } catch (error) {
    console.error('Orders slips GET error:', error);
    res.status(500).json({ error: 'Failed to fetch order slips' });
  }
});

export default router;
