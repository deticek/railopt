const express = require('express');
const { validDate } = require('../lib/validation');
function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, asyncRoute, validDate } = deps;
  router.get('/api/holidays', requireSession, asyncRoute(async (_req, res) => {
    const [rows] = await pool.query('SELECT country_code,holiday_date,holiday_name,note FROM holidays ORDER BY holiday_date,country_code');
    res.json(rows);
  }));
  
  router.post('/api/holidays', requireSession, asyncRoute(async (req, res) => {
    const country = String(req.body?.countryCode || '').trim().toUpperCase();
    const date = String(req.body?.date || '');
    const name = String(req.body?.name || '').trim();
    const note = String(req.body?.note || '').trim();
    if (!/^[A-Z]{2}$/.test(country) || !validDate(date) || !name || name.length > 200 || note.length > 2000) return res.status(400).json({ error: 'Preverite državo, datum in naziv praznika.' });
    try {
      await pool.execute('INSERT INTO holidays (country_code,holiday_date,holiday_name,note) VALUES (?,?,?,?)', [country,date,name,note || null]);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ta praznik je že vnešen.' });
      throw error;
    }
    res.status(201).json({ countryCode: country,date,name });
  }));
  return router;
}

module.exports = createRouter;
