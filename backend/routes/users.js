const express = require('express');
const {readJson}=require('../lib/parameter-store');

function createRouter(deps) {
  const router = express.Router();
  const { pool, authPool, requireSession, requireAdmin, asyncRoute, databaseUsersEnabled, userSchema, userColumn, normalizeRole, bcrypt, bcryptRounds, crypto } = deps;
  router.get('/api/users', requireSession, requireAdmin, asyncRoute(async (_req, res) => {
    if (!databaseUsersEnabled) return res.status(503).json({ error: 'Za uporabnike najprej namestite migracijo podatkovne baze.' });
    const active = userSchema.hasActive ? 'active' : 'TRUE';
    const created = userSchema.hasCreatedAt ? 'created_at' : 'NULL';
    const [rows] = await authPool.query(`SELECT id,username,email,role,${active} AS active,${created} AS created_at FROM users ORDER BY username`);
    const results=await Promise.all(rows.map(async row=>{let active=Boolean(row.active);if(!userSchema.hasActive){const state=await readJson(pool,`app_user_${row.id}`);if(state&&typeof state.active==='boolean')active=state.active;}return {...row,role:normalizeRole(row.role),active};}));
    res.json(results);
  }));

  router.post('/api/users', requireSession, requireAdmin, asyncRoute(async (req, res) => {
    if (!databaseUsersEnabled) return res.status(503).json({ error: 'Za uporabnike najprej namestite migracijo podatkovne baze.' });
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = Number(req.body?.role);
    if (!/^[\p{L}\p{N}_.-]{2,50}$/u.test(username)) return res.status(400).json({ error: 'Uporabniško ime naj ima 2–50 črk ali številk.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Vnesite veljaven e-poštni naslov.' });
    if (password.length < 8 || password.length > 256) return res.status(400).json({ error: 'Geslo mora imeti vsaj 8 znakov.' });
    if (!Number.isInteger(role) || role < 1 || role > 999) return res.status(400).json({ error: 'Izbrana vloga ni veljavna.' });
    try {
      const [roles] = await authPool.execute('SELECT role_id FROM roles WHERE role_id=?', [role]);
      if (!roles.length) return res.status(400).json({ error: 'Izbrana vloga ne obstaja.' });
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
      const stored=await readJson(pool,`app_role_${role}`);
      if(!stored&&![1,2].includes(role))return res.status(400).json({ error: 'Izbrana vloga ne obstaja.' });
    }
    const id = crypto.randomUUID();
    try {
      const columns = ['id', 'username', 'email', userSchema.password, 'role'];
      const values = [id, username, email, await bcrypt.hash(password, bcryptRounds), userSchema.roleIsText ? String(role) : role];
      if (userSchema.hasActive) { columns.push('active'); values.push(true); }
      const columnSql = columns.map(userColumn).join(',');
      const placeholders = values.map(() => '?').join(',');
      await authPool.execute(`INSERT INTO users (${columnSql}) VALUES (${placeholders})`, values);
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Uporabniško ime ali e-pošta je že zasedena.' });
      if (error.code === 'ER_DATA_TOO_LONG') return res.status(400).json({ error: 'Eno od vnesenih polj presega dovoljeno dolžino.' });
      if (error.code === 'ER_NO_REFERENCED_ROW_2' || error.code === 'ER_CHECK_CONSTRAINT_VIOLATED') return res.status(400).json({ error: 'Izbrana vloga ni združljiva s podatkovno bazo.' });
      if (error.code === 'ER_TABLEACCESS_DENIED_ERROR' || error.code === 'ER_ACCESS_DENIED_ERROR') return res.status(503).json({ error: 'Aplikacija nima potrebnih dovoljenj za ustvarjanje računa v podatkovni bazi.' });
      throw error;
    }
    res.status(201).json({ id, username, email, role, active: true });
  }));
  return router;
}

module.exports = createRouter;
