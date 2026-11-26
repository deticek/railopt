const express = require('express');
const { readJson, writeJson } = require('../lib/parameter-store');

const validPlace = place => place && String(place.label || '').trim().length >= 2 &&
  Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon)) &&
  Math.abs(Number(place.lat)) <= 90 && Math.abs(Number(place.lon)) <= 180;

function createRoadDisruptionsRouter({ pool, requireSession, crypto }) {
  const router = express.Router();
  const key = 'app_road_disruptions';

  router.get('/road-disruptions', requireSession, async (_req, res, next) => {
    try { res.json(await readJson(pool, key) || []); } catch (error) { next(error); }
  });

  router.post('/road-disruptions', requireSession, async (req, res, next) => {
    try {
      const { startsAt, endsAt, location, bypass } = req.body || {};
      const start = new Date(startsAt), end = new Date(endsAt);
      const name = String(req.body?.name || '').trim().slice(0, 200);
      const note = String(req.body?.note || '').trim().slice(0, 500);
      const radiusKm = Number(req.body?.radiusKm ?? 2);
      if (!name || !validPlace(location) || !validPlace(bypass) ||
          Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start ||
          !Number.isFinite(radiusKm) || radiusKm < 0.1 || radiusKm > 50)
        return res.status(400).json({ error: 'Vnesi naziv, veljavno lokacijo zapore, obvozno točko, obdobje in radij od 0,1 do 50 km.' });
      const rows = await readJson(pool, key) || [];
      const disruption = {
        id: crypto.randomUUID(), name, location, bypass,
        startsAt: start.toISOString(), endsAt: end.toISOString(), radiusKm,
        note, active: true, createdAt: new Date().toISOString(),
      };
      rows.push(disruption);
      await writeJson(pool, key, 'Motnje v cestnem prometu', name, rows, 'Uporabniško vnesena cestna zapora');
      res.status(201).json(disruption);
    } catch (error) { next(error); }
  });

  router.delete('/road-disruptions/:id', requireSession, async (req, res, next) => {
    try {
      const rows = await readJson(pool, key) || [];
      const item = rows.find(row => row.id === String(req.params.id) && row.active !== false);
      if (!item) return res.status(404).json({ error: 'Motnja ni več aktivna.' });
      item.active = false;
      await writeJson(pool, key, 'Motnje v cestnem prometu', 'Cestne zapore', rows, 'Uporabniško vnesene cestne zapore');
      res.json({ removed: true });
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createRoadDisruptionsRouter;
