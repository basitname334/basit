import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const dishes = await db.collection('dishes').find({}).sort({ name: 1 }).toArray();
    
    // Enrich dishes with ingredient names
    const enriched = await Promise.all(dishes.map(async (d) => {
      const ingredients = d.ingredients || [];
      const ingredientIds = ingredients.map(ing => ing.ingredient_id).filter(Boolean);
      const ingredientObjectIds = ingredientIds.map(id => toObjectId(id)).filter(Boolean);
      const ingredientDocs = ingredientObjectIds.length > 0 ? await db.collection('ingredients').find({
        _id: { $in: ingredientObjectIds }
      }).toArray() : [];
      const ingredientMap = new Map(ingredientDocs.map(i => [i._id.toString(), i.name]));
      
      return {
        id: d._id.toString(),
        name: d.name,
        name_ur: d.name_ur,
        base_quantity: d.base_quantity,
        base_unit: d.base_unit,
        price_per_base: d.price_per_base,
        cost_per_base: d.cost_per_base,
        created_at: d.created_at,
        ingredients: ingredients.map(ing => ({
          ingredient_id: ing.ingredient_id,
          ingredient_name: ingredientMap.get(ing.ingredient_id) || null,
          amount_per_base: ing.amount_per_base,
          unit: ing.unit
        }))
      };
    }));
    
    res.json(enriched);
  } catch (error) {
    console.error('Dishes GET error:', error);
    res.status(500).json({ error: 'Failed to fetch dishes' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, base_quantity, base_unit, price_per_base, cost_per_base, ingredients } = req.body;
    if (!name || !base_quantity || !base_unit) return res.status(400).json({ error: 'name, base_quantity, base_unit required' });
    
    const db = await getDB();
    const dishData = {
      name: name.trim(),
      base_quantity: Number(base_quantity),
      base_unit: base_unit.trim(),
      price_per_base: price_per_base != null ? Number(price_per_base) : null,
      cost_per_base: cost_per_base != null ? Number(cost_per_base) : null,
      ingredients: Array.isArray(ingredients) ? ingredients.map(ing => ({
        ingredient_id: ing.ingredient_id,
        amount_per_base: Number(ing.amount_per_base),
        unit: ing.unit
      })) : [],
      created_at: new Date().toISOString()
    };
    
    const result = await db.collection('dishes').insertOne(dishData);
    const dish = await db.collection('dishes').findOne({ _id: result.insertedId });
    
    res.status(201).json({
      id: dish._id.toString(),
      name: dish.name,
      base_quantity: dish.base_quantity,
      base_unit: dish.base_unit,
      price_per_base: dish.price_per_base,
      cost_per_base: dish.cost_per_base,
      created_at: dish.created_at
    });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'duplicate or invalid' });
    } else {
      console.error('Dishes POST error:', error);
      res.status(500).json({ error: 'Failed to create dish' });
    }
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, base_quantity, base_unit, price_per_base, cost_per_base, ingredients } = req.body;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (base_quantity !== undefined) update.base_quantity = Number(base_quantity);
    if (base_unit !== undefined) update.base_unit = base_unit.trim();
    if (price_per_base !== undefined) update.price_per_base = price_per_base != null ? Number(price_per_base) : null;
    if (cost_per_base !== undefined) update.cost_per_base = cost_per_base != null ? Number(cost_per_base) : null;
    if (Array.isArray(ingredients)) {
      update.ingredients = ingredients.map(ing => ({
        ingredient_id: ing.ingredient_id,
        amount_per_base: Number(ing.amount_per_base),
        unit: ing.unit
      }));
    }
    
    const result = await db.collection('dishes').updateOne(
      { _id: objectId },
      { $set: update }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Dishes PUT error:', error);
    res.status(500).json({ error: 'Failed to update dish' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const result = await db.collection('dishes').deleteOne({ _id: objectId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Dishes DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete dish' });
  }
});

export default router;

