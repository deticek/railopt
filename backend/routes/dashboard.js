const express = require('express');

function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, asyncRoute, serializeShipment } = deps;
  router.get('/api/dashboard', requireSession, asyncRoute(async (_req, res) => {
    const [[shipments]] = await pool.query(`SELECT COUNT(*) AS count,
      SUM(CASE WHEN loading_date>=DATE_FORMAT(UTC_DATE(),'%Y-%m-01') THEN 1 ELSE 0 END) AS month_count FROM shipments`);
    const [[routes]] = await pool.query('SELECT COUNT(*) AS count FROM routes');
    const [[results]] = await pool.query(`SELECT COUNT(*) AS count,
      SUM(CASE WHEN recommended=1 AND feasible=1 THEN COALESCE(co2_kg,0) ELSE 0 END) AS co2_kg,
      SUM(CASE WHEN recommended=1 AND feasible=1 THEN COALESCE(total_cost,0) ELSE 0 END) AS cost FROM transport_results`);
    const [recent] = await pool.query(`SELECT s.id,s.shipment_number,s.loading_date,s.road_delivery_date,s.unit_type,s.adr,
      r.loading_city,r.unloading_city,tr.id AS result_id,tr.transport_type,tr.feasible,tr.recommended,tr.total_cost,tr.co2_kg
      FROM shipments s JOIN routes r ON r.id=s.route_id
      LEFT JOIN transport_results tr ON tr.id=(SELECT t.id FROM transport_results t WHERE t.shipment_id=s.id ORDER BY t.recommended DESC,t.created_at DESC LIMIT 1)
      ORDER BY s.loading_date DESC,s.id DESC LIMIT 8`);
    res.json({ shipmentCount: Number(shipments.count || 0), monthShipments: Number(shipments.month_count || 0), routeCount: Number(routes.count || 0), optimizedCount: Number(results.count || 0), recommendedCo2Kg: Number(results.co2_kg || 0), recommendedCost: Number(results.cost || 0), recentShipments: recent.map(serializeShipment) });
  }));
  return router;
}

module.exports = createRouter;
