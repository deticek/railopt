const express = require('express');
const { validTime } = require('../lib/validation');
function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, asyncRoute, serializeRoute, validTime } = deps;
  router.get('/api/routes', requireSession, asyncRoute(async (_req, res) => {
    const [rows] = await pool.query(`SELECT r.*,p.numeric_value AS extra_time_minutes FROM routes r
      LEFT JOIN parameters p ON p.parameter_code=CONCAT('route_extra_time_',REPLACE(r.id,'-','')) ORDER BY r.route_code`);
    res.json(rows.map(serializeRoute));
  }));

  const validMinutes = value => Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 720;
  const validId = value => /^\d{1,20}$/.test(value) || /^[0-9a-f-]{36}$/i.test(value);
  async function saveMinuteParameter(code, group, name, minutes) {
    await pool.execute(`INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
      VALUES (?,?,?,?,'min',NULL,'Urejeno v aplikaciji') ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name),numeric_value=VALUES(numeric_value),unit=VALUES(unit),text_value=NULL,source_note=VALUES(source_note)`, [code,group,name,Number(minutes)]);
  }
  router.get('/api/route-settings', requireSession, asyncRoute(async (_req, res) => {
    const [[row]] = await pool.execute("SELECT numeric_value FROM parameters WHERE parameter_code='delivery_global_extra_time' LIMIT 1");
    res.json({ extraTimeMinutes: Number(row?.numeric_value || 0) });
  }));
  router.put('/api/route-settings/global-extra-time', requireSession, asyncRoute(async (req, res) => {
    const minutes=Number(req.body?.extraTimeMinutes);
    if(!validMinutes(minutes)) return res.status(400).json({error:'Splošni dodatni čas mora biti med 0 in 720 minutami.'});
    await saveMinuteParameter('delivery_global_extra_time','Nastavitve prevozov','Splošni dodatni čas',minutes);
    res.json({extraTimeMinutes:minutes});
  }));
  router.patch('/api/shipments/:id/extra-time', requireSession, asyncRoute(async (req,res) => {
    const id=String(req.params.id||''); const minutes=Number(req.body?.extraTimeMinutes);
    if(!validId(id)||!validMinutes(minutes))return res.status(400).json({error:'Preveri pošiljko in dodatni čas med 0 in 720 minutami.'});
    const [[shipment]]=await pool.execute('SELECT id FROM shipments WHERE id=? LIMIT 1',[id]);
    if(!shipment)return res.status(404).json({error:'Pošiljka ne obstaja.'});
    await saveMinuteParameter(`shipment_extra_time_${id.replaceAll('-','')}`,'Nastavitve prevozov',`Dodaten čas pošiljke ${id}`,minutes);
    res.json({id,extraTimeMinutes:minutes});
  }));

  router.put('/api/routes/:id', requireSession, asyncRoute(async (req,res) => {
    const id=String(req.params.id||''); const body=req.body||{};
    const code=String(body.code||'').trim().toUpperCase(), direction=String(body.direction||'');
    const loadingCountry=String(body.loadingCountry||'').trim().toUpperCase(), unloadingCountry=String(body.unloadingCountry||'').trim().toUpperCase();
    const loadingPostal=String(body.loadingPostalCode||'').trim(),unloadingPostal=String(body.unloadingPostalCode||'').trim();
    const loadingCity=String(body.loadingCity||'').trim(),unloadingCity=String(body.unloadingCity||'').trim();
    const distance=Number(body.roadDistanceKm),unit=String(body.unitType||'').trim();
    const average=body.averageTrucksPerWeek===''||body.averageTrucksPerWeek==null?null:Number(body.averageTrucksPerWeek);
    const count=body.shipmentsCount===''||body.shipmentsCount==null?null:Number(body.shipmentsCount);
    const windows=['loadingWindowStart','loadingWindowEnd','unloadingWindowStart','unloadingWindowEnd'].map(key=>String(body[key]||''));
    const extra=Number(body.extraTimeMinutes??0);
    if(!validId(id))return res.status(400).json({error:'Oznaka relacije ni veljavna.'});
    if(!/^[A-Z0-9]{1,3}$/.test(code)||!['Izvoz','Uvoz'].includes(direction)||! /^[A-Z]{2}$/.test(loadingCountry)||! /^[A-Z]{2}$/.test(unloadingCountry)||!loadingPostal||loadingPostal.length>15||!unloadingPostal||unloadingPostal.length>15||!loadingCity||loadingCity.length>100||!unloadingCity||unloadingCity.length>100||!Number.isInteger(distance)||distance<1||distance>200000||!unit||unit.length>100||windows.some(time=>!validTime(time))||average!==null&&(!Number.isFinite(average)||average<0)||count!==null&&(!Number.isInteger(count)||count<0))return res.status(400).json({error:'Preveri oznako, smer, državi, kraje, razdaljo, enoto in časovna okna.'});
    if(!validMinutes(extra))return res.status(400).json({error:'Dodaten čas mora biti celo število od 0 do 720 minut.'});
    const [[existing]]=await pool.execute('SELECT id FROM routes WHERE id=? LIMIT 1',[id]);
    if(!existing)return res.status(404).json({error:'Relacija ne obstaja.'});
    await pool.execute(`UPDATE routes SET route_code=?,direction=?,loading_country=?,loading_postal_code=?,loading_city=?,unloading_country=?,unloading_postal_code=?,unloading_city=?,road_distance_km=?,typical_unit_type=?,average_trucks_per_week=?,shipments_count=?,loading_window_start=?,loading_window_end=?,unloading_window_start=?,unloading_window_end=?,cargo_group=?,note=? WHERE id=?`,[code,direction,loadingCountry,loadingPostal,loadingCity,unloadingCountry,unloadingPostal,unloadingCity,distance,unit,average,count,...windows,String(body.cargoGroup||'').slice(0,150)||null,String(body.note||'').slice(0,1000)||null,id]);
    await saveMinuteParameter(`route_extra_time_${id.replaceAll('-','')}`,'Nastavitve prevozov',`Dodaten čas relacije ${code}`,extra);
    res.json({id,code,extraTimeMinutes:extra});
  }));
  
  router.post('/api/routes', requireSession, asyncRoute(async (req, res) => {
    const code = String(req.body?.code || '').trim().toUpperCase();
    const direction = String(req.body?.direction || 'Izvoz');
    const loadingCountry = String(req.body?.loadingCountry || '').trim().toUpperCase();
    const loadingPostal = String(req.body?.loadingPostalCode || '').trim();
    const loadingCity = String(req.body?.loadingCity || '').trim();
    const unloadingCountry = String(req.body?.unloadingCountry || '').trim().toUpperCase();
    const unloadingPostal = String(req.body?.unloadingPostalCode || '').trim();
    const unloadingCity = String(req.body?.unloadingCity || '').trim();
    const distance = Number(req.body?.roadDistanceKm);
    const unit = String(req.body?.unitType || '').trim();
    const averageTrucks = req.body?.averageTrucksPerWeek === '' || req.body?.averageTrucksPerWeek == null ? null : Number(req.body.averageTrucksPerWeek);
    const shipmentsCount = req.body?.shipmentsCount === '' || req.body?.shipmentsCount == null ? null : Number(req.body.shipmentsCount);
    const windows = ['loadingWindowStart','loadingWindowEnd','unloadingWindowStart','unloadingWindowEnd'].map(key => String(req.body?.[key] || ''));
    if (!/^[A-Z0-9]{1,3}$/.test(code) || !['Izvoz','Uvoz'].includes(direction) || !/^[A-Z]{2}$/.test(loadingCountry) || !/^[A-Z]{2}$/.test(unloadingCountry) || !loadingPostal || loadingPostal.length > 15 || !unloadingPostal || unloadingPostal.length > 15 || !loadingCity || loadingCity.length > 100 || !unloadingCity || unloadingCity.length > 100 || !Number.isInteger(distance) || distance < 1 || distance > 200000 || !unit || unit.length > 100 || windows.some(time => !validTime(time)) || averageTrucks !== null && (!Number.isFinite(averageTrucks) || averageTrucks < 0) || shipmentsCount !== null && (!Number.isInteger(shipmentsCount) || shipmentsCount < 0)) {
      return res.status(400).json({ error: 'Preverite oznako, državi, kraje, razdaljo, enoto in časovna okna.' });
    }
    try {
      const [result] = await pool.execute(`INSERT INTO routes (route_code,direction,loading_country,loading_postal_code,loading_city,unloading_country,unloading_postal_code,unloading_city,road_distance_km,typical_unit_type,average_trucks_per_week,shipments_count,loading_window_start,loading_window_end,unloading_window_start,unloading_window_end,cargo_group,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [code,direction,loadingCountry,loadingPostal,loadingCity,unloadingCountry,unloadingPostal,unloadingCity,distance,unit,averageTrucks,shipmentsCount,...windows,String(req.body?.cargoGroup || '').slice(0,150) || null,String(req.body?.note || '').slice(0,1000) || null]);
      res.status(201).json({ id: result.insertId, code });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Oznaka relacije je že zasedena.' });
      throw error;
    }
  }));
  return router;
}

module.exports = createRouter;
