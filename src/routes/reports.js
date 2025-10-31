import { Router } from 'express';
import { db } from '../sqlite.js';
import { requireAuth, requireRole } from '../auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

// range: daily | monthly | yearly
router.get('/', (req, res) => {
  const range = (req.query.range || 'daily').toString();
  let fmt;
  if (range === 'yearly') fmt = "%Y";
  else if (range === 'monthly') fmt = "%Y-%m";
  else fmt = "%Y-%m-%d"; // daily

  // Revenue = sum of (scale_factor * price_per_base), Cost = sum of (scale_factor * cost_per_base)
  // Profit = Revenue - Cost
  const rows = db.prepare(`
    SELECT strftime('${fmt}', o.created_at) as period,
           COUNT(o.id) as orders_count,
           SUM(COALESCE(d.price_per_base, 0) * o.scale_factor) as revenue,
           SUM(COALESCE(d.cost_per_base, 0) * o.scale_factor) as cost,
           SUM(COALESCE(d.price_per_base, 0) * o.scale_factor) - SUM(COALESCE(d.cost_per_base, 0) * o.scale_factor) as profit
    FROM orders o
    JOIN dishes d ON d.id = o.dish_id
    GROUP BY period
    ORDER BY period ASC
  `).all();

  const totals = rows.reduce((acc, r) => {
    acc.orders_count += Number(r.orders_count || 0);
    acc.revenue += Number(r.revenue || 0);
    acc.cost += Number(r.cost || 0);
    acc.profit += Number(r.profit || 0);
    return acc;
  }, { orders_count: 0, revenue: 0, cost: 0, profit: 0 });

  res.json({ range, rows, totals });
});

export default router;


