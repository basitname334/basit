import { Router } from 'express';
import { getDB, toObjectId } from '../mongodb.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// Helper function to format date
function formatDate(date, format) {
  const d = new Date(date);
  if (format === 'yearly') return d.getFullYear().toString();
  if (format === 'monthly') return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// range: daily | monthly | yearly
router.get('/', async (req, res) => {
  try {
    const range = (req.query.range || 'daily').toString();
    
    const db = await getDB();
    
    // Get all orders with dish information
    const orders = await db.collection('orders').find({}).toArray();
    const dishIds = [...new Set(orders.map(o => o.dish_id))];
    const dishes = await db.collection('dishes').find({
      _id: { $in: dishIds.map(id => toObjectId(id)).filter(Boolean) }
    }).toArray();
    const dishMap = new Map(dishes.map(d => [d._id.toString(), d]));
    
    // Group by period
    const periodMap = new Map();
    
    for (const order of orders) {
      const period = formatDate(order.created_at, range);
      const dish = dishMap.get(order.dish_id);
      
      if (!periodMap.has(period)) {
        periodMap.set(period, {
          period,
          orders_count: 0,
          revenue: 0,
          cost: 0,
          profit: 0
        });
      }
      
      const periodData = periodMap.get(period);
      periodData.orders_count += 1;
      
      const pricePerBase = dish?.price_per_base || 0;
      const costPerBase = dish?.cost_per_base || 0;
      const revenue = pricePerBase * order.scale_factor;
      const cost = costPerBase * order.scale_factor;
      
      periodData.revenue += revenue;
      periodData.cost += cost;
      periodData.profit += (revenue - cost);
    }
    
    const rows = Array.from(periodMap.values())
      .map(r => ({
        period: r.period,
        orders_count: r.orders_count,
        revenue: Number(r.revenue.toFixed(2)),
        cost: Number(r.cost.toFixed(2)),
        profit: Number(r.profit.toFixed(2))
      }))
      .sort((a, b) => a.period.localeCompare(b.period));
    
    const totals = rows.reduce((acc, r) => {
      acc.orders_count += Number(r.orders_count || 0);
      acc.revenue += Number(r.revenue || 0);
      acc.cost += Number(r.cost || 0);
      acc.profit += Number(r.profit || 0);
      return acc;
    }, { orders_count: 0, revenue: 0, cost: 0, profit: 0 });
    
    res.json({ range, rows, totals });
  } catch (error) {
    console.error('Reports GET error:', error);
    res.status(500).json({ error: 'Failed to fetch reports' });
  }
});

export default router;



