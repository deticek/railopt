const express = require('express');

function createRouter(deps) {
  const router = express.Router();
  const { authPool, requireSession, requireAdmin, asyncRoute, databaseUsersEnabled, userSchema, userColumn, normalizeRole, bcryptRounds, crypto } = deps;
  router.get('/api/users', requireSession, requireAdmin, asyncRoute(async (_req, res) => {
    if (!databaseUsersEnabled) return res.status(503).json({ error: 'Za uporabnike najprej namestite migracijo podatkovne baze.' });
    const active = userSchema.hasActive ? 'active' : 'TRUE';
    const created = userSchema.hasCreatedAt ? 'created_at' : 'NULL';
    const [rows] = await authPool.query(`SELECT id,username,email,role,${active} AS active,${created} AS created_at FROM users ORDER BY username`);
    res.json(rows.map(row => ({ ...row, role: normalizeRole(row.role), active: Boolean(row.active) })));
  }));

  router.post('/api/users', requireSession, requireAdmin, asyncRoute(async (req, res) => {
    if (!databaseUsersEnabled) return res.status(503).json({ error: 'Za uporabnike najprej namestite migracijo podatkovne baze.' });
    const username = String(req.body?.username || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const role = Number(req.body?.role);
    if (!/^[\p{L}\p{N}_.-]{2,80}$/u.test(username)) return res.status(400).json({ error: 'Uporabniško ime naj ima 2–80 črk ali številk.' });
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) return res.status(400).json({ error: 'Vnesite veljaven e-poštni naslov.' });
    if (password.length < 12 || password.length > 256) return res.status(400).json({ error: 'Geslo mora imeti vsaj 12 znakov.' });
    if (![1, 2].includes(role)) return res.status(400).json({ error: 'Izbrana vloga ni veljavna.' });
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
      throw error;
    }
    res.status(201).json({ id, username, email, role, active: true });
  }));
  return router;
}

module.exports = createRouter;
