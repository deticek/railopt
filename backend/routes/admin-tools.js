const express = require('express');
const {readJson,writeJson,listJson}=require('../lib/parameter-store');
const terminalNetwork = require('../data/terminal-network.json');

const PERMISSIONS = [
  'dashboard.read', 'shipments.read', 'shipments.write', 'routes.read',
  'routes.write', 'planner.use', 'accounts.manage', 'roles.manage',
  'messages.send', 'messages.manage', 'terminals.manage', 'trailers.manage',
  'customers.read', 'customers.write', 'audit.read',
];
const UNIT_TYPES = new Set(['P400', 'CONTAINER', 'SWAP_BODY', 'NON_LIFTABLE']);
const safeId = (value) => /^[0-9a-f-]{36}$/i.test(String(value || ''));

function createAdminToolsRouter({ pool, authPool, requireSession, requireAdmin, requirePermission, clearRolePermissionCache=()=>{}, crypto }) {
  const router = express.Router();
  const admin = [requireSession, requireAdmin];

  // Full, coordinate-verified terminal catalogue used only by the map.
  // Keeping it separate avoids changing the operational terminal choices and Ro-La calculations.
  router.get('/terminal-network', requireSession, (_req, res) => res.json(terminalNetwork));

  router.get('/roles', ...admin, async (_req, res, next) => {
    try {
      const [rows] = await authPool.query('SELECT role_id,role_name,permissions,system_role FROM roles ORDER BY role_id');
      res.json(rows.map(row => ({ ...row, roleId: Number(row.role_id), permissions: typeof row.permissions === 'string' ? JSON.parse(row.permissions) : row.permissions, systemRole: Boolean(row.system_role) })));
    } catch (error) { if(error.code!=='ER_NO_SUCH_TABLE')return next(error);try{const stored=await listJson(pool,'Vloge','app_role_');const defaults=[{roleId:1,role_name:'Skrbnik',permissions:['*'],systemRole:true},{roleId:2,role_name:'Uporabnik',permissions:['dashboard.read','shipments.read','routes.read','planner.use','messages.send'],systemRole:true}];const merged=[...defaults,...stored.map(x=>x.value).filter(x=>x?.roleId>2)];res.json(merged);}catch(e){next(e);} }
  });
  router.post('/roles', ...admin, async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim();
      const permissions = [...new Set(Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [])];
      if (name.length < 2 || name.length > 80 || permissions.some(p => !PERMISSIONS.includes(p))) return res.status(400).json({ error: 'Preveri ime vloge in izbrana dovoljenja.' });
      try{const [result] = await authPool.execute('INSERT INTO roles(role_name,permissions,system_role) VALUES(?,?,0)', [name, JSON.stringify(permissions)]);res.status(201).json({ roleId: result.insertId, role_name:name, permissions, systemRole: false });}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const stored=await listJson(pool,'Vloge','app_role_');const roleId=Math.max(2,...stored.map(x=>Number(x.value?.roleId)||0))+1;const record={roleId,role_name:name,permissions,systemRole:false};await writeJson(pool,`app_role_${roleId}`,'Vloge',name,record);clearRolePermissionCache(roleId);res.status(201).json(record);}
    } catch (error) { next(error); }
  });
  router.put('/roles/:id', ...admin, async (req, res, next) => {
    try {
      const roleId = Number(req.params.id), name = String(req.body?.name || '').trim();
      const permissions = [...new Set(Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [])];
      if (!Number.isInteger(roleId) || roleId < 1 || name.length < 2 || name.length > 80 || permissions.some(p => !PERMISSIONS.includes(p))) return res.status(400).json({ error: 'Preveri ime vloge in izbrana dovoljenja.' });
      try{const [rows]=await authPool.execute('SELECT system_role FROM roles WHERE role_id=?',[roleId]);if(!rows.length)return res.status(404).json({error:'Vloge ni mogoče najti.'});if(rows[0].system_role&&roleId===1)return res.status(400).json({error:'Osnovne skrbniške vloge ni mogoče spreminjati.'});await authPool.execute('UPDATE roles SET role_name=?,permissions=? WHERE role_id=?',[name,JSON.stringify(permissions),roleId]);clearRolePermissionCache(roleId);res.json({roleId,role_name:name,permissions,systemRole:Boolean(rows[0].system_role)});}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const role=await readJson(pool,`app_role_${roleId}`);if(roleId===1)return res.status(400).json({error:'Osnovne skrbniške vloge ni mogoče spreminjati.'});if(!role)return res.status(404).json({error:'Vloge ni mogoče najti.'});const record={...role,role_name:name,permissions};await writeJson(pool,`app_role_${roleId}`,'Vloge',name,record);clearRolePermissionCache(roleId);res.json(record);}
    } catch (error) { next(error); }
  });
  router.put('/users/:id', ...admin, async (req, res, next) => {
    try {
      const id = String(req.params.id || ''), username = String(req.body?.username || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase(), roleId = Number(req.body?.role);
      const active = req.body?.active === true;
      if (!safeId(id) || !/^[\p{L}\p{N}_. -]{2,80}$/u.test(username) || !/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || !Number.isInteger(roleId) || roleId < 1) return res.status(400).json({ error: 'Preveri ime, e-pošto in vlogo uporabnika.' });
      try{const [roleRows]=await authPool.execute('SELECT role_id FROM roles WHERE role_id=?',[roleId]);if(!roleRows.length)return res.status(400).json({error:'Izbrana vloga ne obstaja.'});}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const role=await readJson(pool,`app_role_${roleId}`);if(!role&&![1,2].includes(roleId))return res.status(400).json({error:'Izbrana vloga ne obstaja.'});}
      if(roleId!==1){try{const [roleRows]=await authPool.execute('SELECT role_id FROM roles WHERE role_id=?',[roleId]);if(!roleRows.length)return res.status(400).json({error:'Izbrana vloga ne obstaja.'});}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const role=await readJson(pool,`app_role_${roleId}`);if(!role&&![1,2].includes(roleId))return res.status(400).json({error:'Izbrana vloga ne obstaja.'});}}
      const [cols] = await authPool.execute("SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='users'");
      const names = new Set(cols.map(r => r.COLUMN_NAME));
      const activeSql = names.has('active') ? ',active=?' : '';
      const values = [username, email, String(roleId)];
      if (names.has('active')) values.push(active);
      values.push(id);
      const [result] = await authPool.execute(`UPDATE users SET username=?,email=?,role=?${activeSql} WHERE id=?`, values);
      if (!result.affectedRows) return res.status(404).json({ error: 'Uporabnika ni mogoče najti.' });
      if(!names.has('active'))await writeJson(pool,`app_user_${id}`,'Stanje računov',username,{active});
      res.json({ id, username, email, role: roleId, active });
    } catch (error) { next(error); }
  });

  router.post('/admin-messages', requireSession, async (req, res, next) => {
    try {
      const subject = String(req.body?.subject || '').trim(), message = String(req.body?.message || '').trim();
      const senderName = String(req.user?.username || req.user?.name || 'Uporabnik').slice(0, 80);
      const senderEmail = String(req.user?.email || '').slice(0, 254);
      if (subject.length < 3 || subject.length > 160 || message.length < 5 || message.length > 5000) return res.status(400).json({ error: 'Zadeva mora imeti 3–160 znakov, sporočilo pa 5–5.000 znakov.' });
      const id = crypto.randomUUID(),record={id,sender_id:safeId(req.user?.id)?req.user.id:null,sender_name:senderName,sender_email:senderEmail,subject,message,status:'OPEN',admin_reply:null,created_at:new Date().toISOString()};
      try{await authPool.execute('INSERT INTO admin_messages(id,sender_id,sender_name,sender_email,subject,message) VALUES(?,?,?,?,?,?)',[id,record.sender_id,senderName,senderEmail,subject,message]);}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;await writeJson(pool,`admin_message_${id}`,'Sporočila administratorju',subject,record);}
      res.status(201).json({ id, status: 'OPEN' });
    } catch (error) { next(error); }
  });
  router.get('/admin-messages', ...admin, async (_req, res, next) => {
    try { const [rows] = await authPool.query('SELECT id,sender_name,sender_email,subject,message,status,admin_reply,created_at,replied_at FROM admin_messages ORDER BY created_at DESC LIMIT 200'); res.json(rows); }
    catch (error) { if(error.code!=='ER_NO_SUCH_TABLE')return next(error);try{const rows=await listJson(pool,'Sporočila administratorju','admin_message_');res.json(rows.map(x=>x.value).filter(Boolean).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at))).slice(0,200));}catch(e){next(e);} }
  });
  router.put('/admin-messages/:id', ...admin, async (req, res, next) => {
    try {
      const id = String(req.params.id || ''), reply = String(req.body?.reply || '').trim(), status = String(req.body?.status || 'ANSWERED');
      if (!safeId(id) || reply.length > 5000 || !['ANSWERED','CLOSED'].includes(status)) return res.status(400).json({ error: 'Odgovor ali stanje sporočila ni veljavno.' });
      try{const [result]=await authPool.execute("UPDATE admin_messages SET admin_reply=?,status=?,replied_by=?,replied_at=CURRENT_TIMESTAMP WHERE id=?",[reply||null,status,safeId(req.user?.id)?req.user.id:null,id]);if(!result.affectedRows)return res.status(404).json({error:'Sporočila ni mogoče najti.'});}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const row=await readJson(pool,`admin_message_${id}`);if(!row)return res.status(404).json({error:'Sporočila ni mogoče najti.'});row.admin_reply=reply||null;row.status=status;row.replied_by=req.user?.id||null;row.replied_at=new Date().toISOString();await writeJson(pool,`admin_message_${id}`,'Sporočila administratorju',row.subject,row);}
      res.json({ id, status });
    } catch (error) { next(error); }
  });

  router.get('/unit-terminals', requireSession, async (req, res, next) => {
    const type = String(req.query.type || '');
    const rolaSql = `SELECT CAST(id AS CHAR) AS id,'RO_LA' AS unitType,city AS serviceCity,city,country_code AS countryCode,name,address,latitude,longitude,NULL AS cityDistanceKm,1 AS active FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL`;
    try {
      if (type && !['CONTAINER','SWAP_BODY','P400','RO_LA'].includes(type)) return res.status(400).json({ error: 'Vrsta enote ni veljavna.' });
      const unitSql = `SELECT CAST(id AS CHAR) AS id,unit_type AS unitType,service_city AS serviceCity,city,country_code AS countryCode,name,address,latitude,longitude,city_distance_km AS cityDistanceKm,active FROM unit_terminals WHERE active=1 ${type && type!=='RO_LA' ? 'AND unit_type=?' : ''}`;
      let rows;
      if(type==='RO_LA') [rows]=await pool.query(rolaSql);
      else if(type) [rows]=await pool.execute(unitSql,[type]);
      else { const [units]=await pool.query(unitSql); const [rola]=await pool.query(rolaSql); rows=[...rola,...units]; }
      rows=rows.map(row=>({...row,id:String(row.id),latitude:row.latitude==null?null:Number(row.latitude),longitude:row.longitude==null?null:Number(row.longitude),cityDistanceKm:row.cityDistanceKm==null?null:Number(row.cityDistanceKm)}));
      res.json(rows);
    } catch (error) {
      if(error.code!=='ER_NO_SUCH_TABLE')return next(error);
      try {
        const all=await readJson(pool,'app_unit_terminals_catalog')||[];
        const units=all.filter(r=>r.active!==false&&(!type||r.unitType===type)).map(r=>({...r,id:String(r.id),serviceCity:r.serviceCity||r.city,city:r.city||r.serviceCity}));
        const [rola]=type&&type!=='RO_LA'?[[]]:await pool.query(rolaSql);
        const mappedRola=rola.map(r=>({...r,unitType:'RO_LA',serviceCity:r.city}));
        res.json(type==='RO_LA'?mappedRola:type?units:[...mappedRola,...units]);
      }catch(e){next(e);}
    }
  });
  router.put('/unit-terminals/:id', requireSession, requirePermission('terminals.manage'), async (req, res, next) => {
    return res.status(403).json({ error: 'Terminali so zaklenjeni in jih ni mogoče spreminjati.' });
    try {
      const id = String(req.params.id || ''), name = String(req.body?.name || '').trim(), address = String(req.body?.address || '').trim();
      const lat = req.body?.latitude == null || req.body?.latitude === '' ? null : Number(req.body.latitude);
      const lon = req.body?.longitude == null || req.body?.longitude === '' ? null : Number(req.body.longitude);
      if ((!safeId(id) && !/^\d{1,18}$/.test(id)) || name.length < 2 || name.length > 150 || address.length < 5 || address.length > 255 || ((lat === null) !== (lon === null)) || (lat !== null && (!Number.isFinite(lat) || Math.abs(lat)>90 || !Number.isFinite(lon) || Math.abs(lon)>180))) return res.status(400).json({ error: 'Preveri ime, naslov in koordinate terminala.' });
      const isRola=String(req.body?.unitType)==='RO_LA';
      const [result] = isRola
        ? await pool.execute('UPDATE terminals SET name=?,address=?,latitude=?,longitude=? WHERE id=?', [name,address,lat,lon,Number(id)])
        : await pool.execute('UPDATE unit_terminals SET name=?,address=?,latitude=?,longitude=? WHERE id=?', [name,address,lat,lon,id]);
      if (!result.affectedRows) return res.status(404).json({ error: 'Terminala ni mogoče najti.' });
      res.json({ saved: true });
    } catch (error) {
      if(error.code!=='ER_NO_SUCH_TABLE'||String(req.body?.unitType)==='RO_LA')return next(error);
      try{const rows=await readJson(pool,'app_unit_terminals_catalog')||[];const i=rows.findIndex(r=>String(r.id)===String(req.params.id));if(i<0)return res.status(404).json({error:'Terminala ni mogoče najti.'});rows[i]={...rows[i],name:String(req.body.name).trim(),address:String(req.body.address).trim(),latitude:req.body.latitude===''?null:Number(req.body.latitude),longitude:req.body.longitude===''?null:Number(req.body.longitude)};await writeJson(pool,'app_unit_terminals_catalog','Terminals','Terminali po vrsti enote',rows,'source:TIM_Hekaton_2026_podatki_v2_v2.xlsx');res.json({saved:true});}catch(e){next(e);}
    }
  });
  router.get('/trailers', requireSession, async (_req, res, next) => {
    try { const [rows] = await pool.query('SELECT id,name,registration,unit_type AS unitType,note,active FROM trailers ORDER BY name');const result=await Promise.all(rows.map(async row=>{const [unit]=await pool.execute('SELECT terminal_id FROM trailer_terminal_compatibility WHERE trailer_id=?',[row.id]);const [rola]=await pool.execute('SELECT terminal_id FROM trailer_rola_compatibility WHERE trailer_id=?',[row.id]);return {...row,active:Boolean(row.active),terminalIds:unit.map(x=>String(x.terminal_id)),rolaTerminalIds:rola.map(x=>String(x.terminal_id))};}));res.json(result); }
    catch (error) { if(error.code!=='ER_NO_SUCH_TABLE')return next(error);try{const rows=await listJson(pool,'Prikolice','trailer_');res.json(rows.map(x=>x.value).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name)));}catch(e){next(e);} }
  });
  router.post('/trailers', requireSession, requirePermission('trailers.manage'), async (req, res, next) => {
    try {
      const name = String(req.body?.name || '').trim(), registration = String(req.body?.registration || '').trim() || null, unitType = String(req.body?.unitType || '');
      if (name.length < 2 || name.length > 100 || (registration && registration.length > 30) || !UNIT_TYPES.has(unitType)) return res.status(400).json({ error: 'Preveri ime prikolice, registracijo in vrsto enote.' });
      const id = crypto.randomUUID();
      const terminalIds = Array.isArray(req.body?.terminalIds) ? req.body.terminalIds.filter(safeId) : [],rolaTerminalIds=Array.isArray(req.body?.rolaTerminalIds)?req.body.rolaTerminalIds.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0):[];
      const record={id,name,registration,unitType,note:String(req.body?.note||'').slice(0,2000)||null,active:true,terminalIds,rolaTerminalIds};
      try{await pool.execute('INSERT INTO trailers(id,name,registration,unit_type,note) VALUES(?,?,?,?,?)',[id,name,registration,unitType,record.note]);if(terminalIds.length)await pool.query('INSERT IGNORE INTO trailer_terminal_compatibility(trailer_id,terminal_id) VALUES ?',[terminalIds.map(terminalId=>[id,terminalId])]);if(rolaTerminalIds.length)await pool.query('INSERT IGNORE INTO trailer_rola_compatibility(trailer_id,terminal_id) VALUES ?',[rolaTerminalIds.map(terminalId=>[id,terminalId])]);}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;await writeJson(pool,`trailer_${id}`,'Prikolice',name,record);}
      res.status(201).json(record);
    } catch (error) { next(error); }
  });
  router.put('/trailers/:id', requireSession, requirePermission('trailers.manage'), async (req, res, next) => {
    try {
      const id = String(req.params.id || ''), name = String(req.body?.name || '').trim(), registration = String(req.body?.registration || '').trim() || null, unitType = String(req.body?.unitType || ''), active = req.body?.active === true;
      if (!safeId(id) || name.length < 2 || name.length > 100 || !UNIT_TYPES.has(unitType)) return res.status(400).json({ error: 'Preveri podatke prikolice.' });
      const conn = await pool.getConnection();
      try { await conn.beginTransaction(); const [r] = await conn.execute('UPDATE trailers SET name=?,registration=?,unit_type=?,note=?,active=? WHERE id=?',[name,registration,unitType,String(req.body?.note||'').slice(0,2000)||null,active,id]); if(!r.affectedRows){await conn.rollback();return res.status(404).json({error:'Prikolice ni mogoče najti.'});} await conn.execute('DELETE FROM trailer_terminal_compatibility WHERE trailer_id=?',[id]);await conn.execute('DELETE FROM trailer_rola_compatibility WHERE trailer_id=?',[id]); const ids=Array.isArray(req.body?.terminalIds)?req.body.terminalIds.filter(safeId):[],rolaIds=Array.isArray(req.body?.rolaTerminalIds)?req.body.rolaTerminalIds.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0):[]; if(ids.length) await conn.query('INSERT IGNORE INTO trailer_terminal_compatibility(trailer_id,terminal_id) VALUES ?',[ids.map(tid=>[id,tid])]);if(rolaIds.length)await conn.query('INSERT IGNORE INTO trailer_rola_compatibility(trailer_id,terminal_id) VALUES ?',[rolaIds.map(tid=>[id,tid])]); await conn.commit(); res.json({id,name,registration,unitType,active}); } catch(e){await conn.rollback();if(e.code==='ER_NO_SUCH_TABLE'){const prior=await readJson(pool,`trailer_${id}`);if(!prior)return res.status(404).json({error:'Prikolice ni mogoče najti.'});const record={...prior,name,registration,unitType,note:String(req.body?.note||'').slice(0,2000)||null,active,terminalIds:Array.isArray(req.body?.terminalIds)?req.body.terminalIds.filter(safeId):[],rolaTerminalIds:Array.isArray(req.body?.rolaTerminalIds)?req.body.rolaTerminalIds.map(Number).filter(x=>Number.isSafeInteger(x)&&x>0):[]};await writeJson(pool,`trailer_${id}`,'Prikolice',name,record);return res.json(record);}throw e;} finally{conn.release();}
    } catch (error) { next(error); }
  });

  router.get('/customers', requireSession, async (_req, res, next) => {
    try { const [rows] = await pool.query('SELECT id,name,tax_number AS taxNumber,email,phone,address,note,active FROM customers WHERE active=1 ORDER BY name'); res.json(rows); }
    catch (error) { if(error.code!=='ER_NO_SUCH_TABLE')return next(error);try{const rows=await listJson(pool,'Stranke','customer_');res.json(rows.map(x=>x.value).filter(x=>x?.active!==false).sort((a,b)=>a.name.localeCompare(b.name)));}catch(e){next(e);} }
  });
  router.post('/customers', requireSession, requirePermission('customers.write'), async (req, res, next) => {
    try {
      const name=String(req.body?.name||'').trim(), tax=String(req.body?.taxNumber||'').trim()||null, email=String(req.body?.email||'').trim().toLowerCase()||null;
      if(name.length<2||name.length>160||(tax&&tax.length>40)||(email&&(!/^\S+@\S+\.\S+$/.test(email)||email.length>254)))return res.status(400).json({error:'Preveri naziv stranke, davčno številko in e-pošto.'});
      const id=crypto.randomUUID(),record={id,name,taxNumber:tax,email,phone:String(req.body?.phone||'').slice(0,40)||null,address:String(req.body?.address||'').slice(0,255)||null,note:String(req.body?.note||'').slice(0,2000)||null,active:true};try{await pool.execute('INSERT INTO customers(id,name,tax_number,email,phone,address,note) VALUES(?,?,?,?,?,?,?)',[id,name,tax,email,record.phone,record.address,record.note]);}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;await writeJson(pool,`customer_${id}`,'Stranke',name,record);}res.status(201).json(record);
    } catch(error){next(error);}
  });
  router.put('/customers/:id', requireSession, requirePermission('customers.write'), async (req,res,next)=>{
    try{const id=String(req.params.id||''),name=String(req.body?.name||'').trim(),email=String(req.body?.email||'').trim().toLowerCase()||null; if(!safeId(id)||name.length<2||name.length>160||(email&&!/^\S+@\S+\.\S+$/.test(email)))return res.status(400).json({error:'Preveri podatke stranke.'}); const record={id,name,taxNumber:String(req.body?.taxNumber||'').trim()||null,email,phone:String(req.body?.phone||'').slice(0,40)||null,address:String(req.body?.address||'').slice(0,255)||null,note:String(req.body?.note||'').slice(0,2000)||null,active:req.body?.active===true};try{const [r]=await pool.execute('UPDATE customers SET name=?,tax_number=?,email=?,phone=?,address=?,note=?,active=? WHERE id=?',[name,record.taxNumber,email,record.phone,record.address,record.note,record.active,id]);if(!r.affectedRows)return res.status(404).json({error:'Stranke ni mogoče najti.'});}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const prior=await readJson(pool,`customer_${id}`);if(!prior)return res.status(404).json({error:'Stranke ni mogoče najti.'});await writeJson(pool,`customer_${id}`,'Stranke',name,record);}res.json({saved:true});}catch(error){next(error);}
  });
  router.get('/customers/:id/shipments', requireSession, requirePermission('customers.read'), async (req,res,next)=>{
    try{const id=String(req.params.id||'');if(!safeId(id))return res.status(400).json({error:'ID stranke ni veljaven.'});try{const [rows]=await pool.execute('SELECT s.id,s.shipment_number,s.loading_date,s.weight_kg,s.unit_type,r.loading_city,r.unloading_city FROM customer_shipments cs JOIN shipments s ON s.id=cs.shipment_id JOIN routes r ON r.id=s.route_id WHERE cs.customer_id=? ORDER BY s.loading_date DESC',[id]);res.json(rows);}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const customer=await readJson(pool,`customer_${id}`),ids=customer?.shipmentIds||[];if(!ids.length)return res.json([]);const placeholders=ids.map(()=>'?').join(',');const [rows]=await pool.execute(`SELECT s.id,s.shipment_number,s.loading_date,s.weight_kg,s.unit_type,r.loading_city,r.unloading_city FROM shipments s JOIN routes r ON r.id=s.route_id WHERE s.id IN (${placeholders}) ORDER BY s.loading_date DESC`,ids);res.json(rows);}}catch(error){next(error);}
  });
  router.put('/customers/:id/shipments', requireSession, requirePermission('customers.write'), async (req,res,next)=>{
    const conn=await pool.getConnection();
    try{const id=String(req.params.id||''),shipmentIds=Array.isArray(req.body?.shipmentIds)?[...new Set(req.body.shipmentIds.map(Number))]:[];if(!safeId(id)||shipmentIds.length>2000||shipmentIds.some(x=>!Number.isSafeInteger(x)||x<1))return res.status(400).json({error:'Seznam pošiljk ni veljaven.'});await conn.beginTransaction();const [[customer]]=await conn.execute('SELECT id FROM customers WHERE id=?',[id]);if(!customer){await conn.rollback();return res.status(404).json({error:'Stranke ni mogoče najti.'});}if(shipmentIds.length){const placeholders=shipmentIds.map(()=>'?').join(',');const [found]=await conn.execute(`SELECT id FROM shipments WHERE id IN (${placeholders})`,shipmentIds);if(found.length!==shipmentIds.length){await conn.rollback();return res.status(400).json({error:'Ena ali več pošiljk ne obstaja.'});}}await conn.execute('DELETE FROM customer_shipments WHERE customer_id=?',[id]);if(shipmentIds.length)await conn.query('INSERT INTO customer_shipments(customer_id,shipment_id) VALUES ?',[shipmentIds.map(shipmentId=>[id,shipmentId])]);await conn.commit();res.json({saved:true,count:shipmentIds.length});}catch(error){await conn.rollback();if(error.code==='ER_NO_SUCH_TABLE'){const customer=await readJson(pool,`customer_${req.params.id}`);if(!customer)return res.status(404).json({error:'Stranke ni mogoče najti.'});const shipmentIds=Array.isArray(req.body?.shipmentIds)?[...new Set(req.body.shipmentIds.map(Number))]:[];customer.shipmentIds=shipmentIds;await writeJson(pool,`customer_${req.params.id}`,'Stranke',customer.name,customer);return res.json({saved:true,count:shipmentIds.length});}next(error);}finally{conn.release();}
  });
  router.get('/audit-logs', requireSession, requirePermission('audit.read'), async (_req,res,next)=>{
    try{const [rows]=await pool.query('SELECT id,username,action,entity,entity_id AS entityId,http_status AS httpStatus,created_at AS createdAt FROM audit_logs ORDER BY id DESC LIMIT 300');res.json(rows);}catch(error){if(error.code!=='ER_NO_SUCH_TABLE')return next(error);try{const rows=await listJson(pool,'Revizijski dnevnik','audit_');res.json(rows.map(x=>x.value).filter(Boolean).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,300));}catch(e){next(e);}}
  });
  return { router, permissions: PERMISSIONS };
}

module.exports = { createAdminToolsRouter, PERMISSIONS };
