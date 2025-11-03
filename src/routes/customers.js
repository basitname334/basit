import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const db = await getDB();
    const rows = await db.collection('customers').find({}).sort({ name: 1 }).toArray();
    const formatted = rows.map(r => ({
      id: r._id.toString(),
      name: r.name,
      phone: r.phone,
      email: r.email,
      address: r.address,
      created_at: r.created_at
    }));
    res.json(formatted);
  } catch (error) {
    console.error('Customers GET error:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

router.post('/', requireRole('admin'), async (req, res) => {
  try {
    const { name, phone, email, address } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    
    const db = await getDB();
    const result = await db.collection('customers').insertOne({
      name: name.trim(),
      phone: phone?.trim() || null,
      email: email?.trim() || null,
      address: address?.trim() || null,
      created_at: new Date().toISOString()
    });
    
    res.status(201).json({
      id: result.insertedId.toString(),
      name: name.trim(),
      phone,
      email,
      address
    });
  } catch (error) {
    console.error('Customers POST error:', error);
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

router.put('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, email, address } = req.body;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (phone !== undefined) update.phone = phone?.trim() || null;
    if (email !== undefined) update.email = email?.trim() || null;
    if (address !== undefined) update.address = address?.trim() || null;
    
    const result = await db.collection('customers').updateOne(
      { _id: objectId },
      { $set: update }
    );
    
    if (result.matchedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Customers PUT error:', error);
    res.status(500).json({ error: 'Failed to update customer' });
  }
});

router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const objectId = toObjectId(id);
    if (!objectId) return res.status(400).json({ error: 'invalid id' });
    
    const db = await getDB();
    // Check if any orders use this customer
    const hasOrders = await db.collection('orders').countDocuments({ customer_id: id });
    if (hasOrders > 0) {
      return res.status(400).json({ error: 'Cannot delete customer that has orders. Please remove or reassign orders first.' });
    }
    
    const result = await db.collection('customers').deleteOne({ _id: objectId });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (error) {
    console.error('Customers DELETE error:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

export default router;

