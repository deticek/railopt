const express = require('express');
const { readJson, writeJson } = require('../lib/parameter-store');
const { readNetworkSnapshot } = require('../lib/kombiverkehr-store');
const freightTerminals = require('../data/intermodal-terminals.json');
const unitTerminals = require('../data/unit-terminals.json');

const normalizeTerminalName = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const countryNameRules = [
  ['NO', /alnabru|oslo/],
  ['SE', /goteborg|hallsberg|malmo|stockholm|umea|lulea|trelleborg|gavle/],
  ['ES', /madrid|barcelona|llagosta|san roque|sevilla|silla|valencia|murcia|constanti|tarragona|zaragoza/],
  ['HU', /sajoszentpeter|szeged|budapest/],
  ['SK', /haniska|bratislava|cierna nad tisou|zilina/],
  ['CZ', /melnik|brno|neratovice|liberec|lovosice|ostrava|obrnice|prerov/],
  ['DE', /basel weil|hamburg|hannover|neuss|nurnberg|ludwigshafen|dor pen|dorpen|lubeck|rostock|bremen|hamm|rheine|worth rhein|zeitz|duisburg|koln|munchen|frankfurt|berlin|lehrte|mannheim|augsburg|wuppertal|dusseldorf|stuttgart|regensburg|karlsruhe|ingolstadt|landshut|erfurt|gottingen|grossbeeren|dornstadt|beiseforth|kiel|leipzig/],
  ['FR', /hendaye|irun|lyon|venissieux/],
  ['TR', /mersin|cesme|pendik|yalova/],
  ['AT', /bludenz|st michael|villach|graz|gummern|wels|worgl|wolfurt|brenner|wien|linz|salzburg|innsbruck|werndorf/],
  ['IT', /milano|segrate|mortara|trieste|nola|pomezia|maddaloni|agognate|lonato|padova|poggio rusco|villa opicina|bari|verona|busto arsizio|parma|bologna|marzaglia|catania/],
  ['BE', /antwerpen|gent/],
  ['RO', /curtici|arad/],
  ['PL', /poznan/],
  ['SI', /koper|ljubljana|maribor|sezana|celje/],
  ['HR', /rijeka/],
  ['GR', /patras/],
  ['NL', /rotterdam/],
];

function railTerminalCountryCode(terminal) {
  const normalizedName = normalizeTerminalName(terminal.name);
  const namedCountry = countryNameRules.find(([, pattern]) => pattern.test(normalizedName))?.[0];
  if (namedCountry) return namedCountry;
  const catalog = [...freightTerminals, ...unitTerminals]
    .filter(item => (item.country || item.countryCode) && item.city)
    .sort((a, b) => normalizeTerminalName(b.city).length - normalizeTerminalName(a.city).length);
  const nameMatch = catalog.find(item => {
    const city = normalizeTerminalName(item.city);
    return city.length >= 4 && (normalizedName.includes(city) || city.includes(normalizedName));
  });
  if (nameMatch) return nameMatch.country || nameMatch.countryCode;
  const lat = Number(terminal.latitude), lon = Number(terminal.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const nearest = freightTerminals
    .filter(item => (item.country || item.countryCode) && Number.isFinite(Number(item.latitude)) && Number.isFinite(Number(item.longitude)))
    .map(item => {
      const dLat = (Number(item.latitude) - lat) * Math.PI / 180;
      const dLon = (Number(item.longitude) - lon) * Math.PI / 180;
      const q = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180) * Math.cos(Number(item.latitude) * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      return { country: item.country || item.countryCode, distanceKm: 6371 * 2 * Math.asin(Math.sqrt(q)) };
    })
    .sort((a, b) => a.distanceKm - b.distanceKm)[0];
  return nearest && nearest.distanceKm <= 100 ? nearest.country : null;
}

function createRailNetworkRouter({ pool, requireSession, crypto }) {
  const router = express.Router();

  router.get('/rail-network/terminals', requireSession, async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        'SELECT id,name,latitude,longitude,active_in_source_week AS activeInSourceWeek FROM rail_terminals ORDER BY name',
      );
      res.json(rows.map(row => ({ ...row, countryCode: railTerminalCountryCode(row) })));
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') return next(error);
      try {
        const stored = await readNetworkSnapshot(pool);
        res.json((stored?.terminals || []).map(row => ({
          ...row,
          activeInSourceWeek: row.activeInSourceWeek !== false,
          countryCode: railTerminalCountryCode(row),
        })));
      } catch (fallbackError) { next(fallbackError); }
    }
  });

  router.get('/rail-network/disruptions', requireSession, async (_req, res, next) => {
    try {
      const [rows] = await pool.query(
        `SELECT r.id,a.name AS terminalA,b.name AS terminalB,r.starts_at AS startsAt,
                r.ends_at AS endsAt,r.note,r.created_at AS createdAt
           FROM rail_disruptions r
           JOIN rail_terminals a ON a.id=r.terminal_a_id
           JOIN rail_terminals b ON b.id=r.terminal_b_id
          WHERE r.active=1 AND r.ends_at>NOW() ORDER BY r.starts_at`,
      );
      res.json(rows);
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') return next(error);
      try {
        const rows = await readJson(pool, 'app_kombiverkehr_disruptions') || [];
        res.json(rows.filter(row => row.active !== false && new Date(row.endsAt) > new Date()));
      } catch (fallbackError) { next(fallbackError); }
    }
  });

  router.post('/rail-network/disruptions', requireSession, async (req, res, next) => {
      const terminalA = String(req.body?.terminalA || '');
      const terminalB = String(req.body?.terminalB || '');
      const startsAt = new Date(req.body?.startsAt);
      const endsAt = new Date(req.body?.endsAt);
      const note = String(req.body?.note || '').trim().slice(0, 500);
      if (!terminalA || !terminalB || terminalA === terminalB ||
          Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) ||
          endsAt <= startsAt || !note)
        return res.status(400).json({ error: 'Izberi dva različna terminala, veljaven čas zapore in opis.' });
      let a, b;
      try {
      [[a], [b]] = await Promise.all([
        pool.execute('SELECT id FROM rail_terminals WHERE id=? LIMIT 1', [terminalA]),
        pool.execute('SELECT id FROM rail_terminals WHERE id=? LIMIT 1', [terminalB]),
      ]);
      if (!a || !b) return res.status(400).json({ error: 'Izbrani terminal ni v lokalnem voznem redu.' });
      const id = crypto.randomUUID();
      await pool.execute(
        'INSERT INTO rail_disruptions (id,terminal_a_id,terminal_b_id,starts_at,ends_at,note,created_by) VALUES (?,?,?,?,?,?,?)',
        [id, a.id, b.id, startsAt, endsAt, note, String(req.user?.email || req.user?.id || '').slice(0, 254) || null],
      );
      const [[names]] = await pool.execute(
        'SELECT a.name AS terminalA,b.name AS terminalB FROM rail_terminals a JOIN rail_terminals b ON b.id=? WHERE a.id=?',
        [b.id, a.id],
      );
      res.status(201).json({ id, terminalA: names.terminalA, terminalB: names.terminalB, startsAt, endsAt, note });
      } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE') return next(error);
        try {
          const stored = await readNetworkSnapshot(pool);
          const terminals = stored?.terminals || [];
          const first = terminals.find(row => row.id === terminalA);
          const second = terminals.find(row => row.id === terminalB);
          if (!first || !second) return res.status(400).json({ error: 'Izbrani terminal ni v lokalnem voznem redu.' });
          const id = crypto.randomUUID();
          const disruption = {
            id, terminalA: first.name, terminalB: second.name,
            startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString(), note,
            active: true, createdAt: new Date().toISOString(),
          };
          const rows = await readJson(pool, 'app_kombiverkehr_disruptions') || [];
          rows.push(disruption);
          await writeJson(pool, 'app_kombiverkehr_disruptions', 'Lokalni vozni red', 'Zaprtja železniških odsekov', rows);
          res.status(201).json(disruption);
        } catch (fallbackError) { next(fallbackError); }
      }
  });

  router.delete('/rail-network/disruptions/:id', requireSession, async (req, res, next) => {
    try {
      const id = String(req.params.id || '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({ error: 'ID zapore ni veljaven.' });
      try {
        const [result] = await pool.execute('UPDATE rail_disruptions SET active=0 WHERE id=? AND active=1', [id]);
        if (!result.affectedRows) return res.status(404).json({ error: 'Zapora ni več aktivna.' });
        res.json({ removed: true });
      } catch (error) {
        if (error.code !== 'ER_NO_SUCH_TABLE') return next(error);
        try {
          const rows = await readJson(pool, 'app_kombiverkehr_disruptions') || [];
          const item = rows.find(row => row.id === id && row.active !== false);
          if (!item) return res.status(404).json({ error: 'Zapora ni več aktivna.' });
          item.active = false;
          await writeJson(pool, 'app_kombiverkehr_disruptions', 'Lokalni vozni red', 'Zaprtja železniških odsekov', rows);
          res.json({ removed: true });
        } catch (fallbackError) { next(fallbackError); }
      }
    } catch (error) { next(error); }
  });

  return router;
}

module.exports = createRailNetworkRouter;
