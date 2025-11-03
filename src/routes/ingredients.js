import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const ingredients = await db.collection('ingredients').find({}).sort({ name: 1 }).toArray();
    const categoryIds = [...new Set(ingredients.map(i => i.category_id))];
    const categories = await db.collection('categories').find({
      _id: { $in: categoryIds.map(id => toObjectId(id)).filter(Boolean) }
    }).toArray();
    const categoryMap = new Map(categories.map(c => [c._id.toString(), c.name]));
    
    const formatted = ingredients.map(i => ({
      id: i._id.toString(),
      name: i.name,
      name_ur: i.name_ur,
      category_id: i.category_id,
      category_name: categoryMap.get(i.category_id) || null,
      created_at: i.created_at
    }));
    
    res.json(formatted);
  } catch (error) {
    console.error('Ingredients GET error:', error);
    res.status(500).json({ error: 'Failed to fetch ingredients' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, category_id } = req.body;
    if (!name || !category_id) return res.status(400).json({ error: 'name and category_id required' });
    
    const db = await getDB();
    const categoryObjectId = toObjectId(category_id);
    if (!categoryObjectId) return res.status(400).json({ error: 'invalid category_id' });
    
    // Verify category exists
    const category = await db.collection('categories').findOne({ _id: categoryObjectId });
    if (!category) return res.status(400).json({ error: 'category not found' });
    
    const result = await db.collection('ingredients').insertOne({
      name: name.trim(),
      category_id: category_id,
      created_at: new Date().toISOString()
    });
    
    res.status(201).json({
      id: result.insertedId.toString(),
      name: name.trim(),
      category_id,
      category_name: category.name
    });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'duplicate or invalid' });
    } else {
      console.error('Ingredients POST error:', error);
      res.status(500).json({ error: 'Failed to create ingredient' });
    }
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category_id } = req.body;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    
    // If category_id is provided, verify it exists
    if (category_id !== undefined && category_id !== null) {
      const categoryObjectId = toObjectId(category_id);
      if (!categoryObjectId) return res.status(400).json({ error: 'invalid category_id' });
      const category = await db.collection('categories').findOne({ _id: categoryObjectId });
      if (!category) return res.status(400).json({ error: 'category not found' });
    }
    
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (category_id !== undefined && category_id !== null) update.category_id = category_id;
    
    const result = await db.collection('ingredients').updateOne(
      { _id: objectId },
      { $set: update }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Ingredients PUT error:', error);
    res.status(500).json({ error: 'Failed to update ingredient' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const result = await db.collection('ingredients').deleteOne({ _id: objectId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Ingredients DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete ingredient' });
  }
});

export default router;

