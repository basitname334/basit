import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.collection('categories').find({}).sort({ name: 1 }).toArray();
    const formatted = rows.map(r => ({ id: r._id.toString(), name: r.name, name_ur: r.name_ur, created_at: r.created_at }));
    res.json(formatted);
  } catch (error) {
    console.error('Categories GET error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    
    const db = await getDB();
    const result = await db.collection('categories').insertOne({
      name: name.trim(),
      created_at: new Date().toISOString()
    });
    res.status(201).json({ id: result.insertedId.toString(), name: name.trim() });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'duplicate or invalid' });
    } else {
      console.error('Categories POST error:', error);
      res.status(500).json({ error: 'Failed to create category' });
    }
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const update = {};
    if (name !== undefined) update.name = name.trim();
    
    const result = await db.collection('categories').updateOne(
      { _id: objectId },
      { $set: update }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Categories PUT error:', error);
    res.status(500).json({ error: 'Failed to update category' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    // Check if any ingredients use this category (category_id is stored as string)
    const hasIngredients = await db.collection('ingredients').countDocuments({ category_id: id });
    if (hasIngredients > 0) {
      return res.status(400).json({ error: 'Cannot delete category that has ingredients. Please remove or reassign ingredients first.' });
    }
    
    const result = await db.collection('categories').deleteOne({ _id: objectId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Categories DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

export default router;

