require('dotenv').config();

const crypto = require('node:crypto');
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const { createEmissionsRouter } = require('./routes/emissions');
const { createPlacesRouter } = require('./routes/places');
const createDeliveryPlansRouter = require('./routes/delivery-plans');
const createRailNetworkRouter = require('./routes/rail-network');
const createRoadDisruptionsRouter = require('./routes/road-disruptions');
const createAuthRouter = require('./routes/auth');
const createHealthRouter = require('./routes/health');
const createUsersRouter = require('./routes/users');
const createDashboardRouter = require('./routes/dashboard');
const createShipmentsRouter = require('./routes/shipments');
const createTransportRoutesRouter = require('./routes/transport-routes');
const createParametersRouter = require('./routes/parameters');
const createHolidaysRouter = require('./routes/holidays');
const createExcelImportRouter = require('./routes/excel-import');
const { createAdminToolsRouter } = require('./routes/admin-tools');
const { validDate, validTime } = require('./lib/validation');
const { readJson, writeJson } = require('./lib/parameter-store');

const app = express();
app.disable('x-powered-by');
const allowedWebOrigins = new Set(['http://localhost:4200', 'http://127.0.0.1:4200']);
app.use(cors({
  origin(origin, callback) {
    // Packaged Electron loads the Angular bundle from file://, whose Origin is
    // serialized as "null" by Chromium. The API still binds to loopback and
    // all application routes continue to require an authenticated session.
    callback(null, !origin || origin === 'null' || allowedWebOrigins.has(origin));
  }
}));
app.use(express.json({ limit: '16kb' }));

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  connectTimeout: 5000,
  waitForConnections: true,
  connectionLimit: 6,
  queueLimit: 20,
  charset: 'utf8mb4',
  dateStrings: ['DATE']
};
const pool = mysql.createPool({ ...dbConfig, database: process.env.MYSQL_DATABASE || 'railopt' });
const authPool = mysql.createPool({ ...dbConfig, database: process.env.MYSQL_AUTH_DATABASE || process.env.MYSQL_DATABASE || 'railopt' });
const bcryptRounds = 9;

const sessions = new Map();
let administrator;
let databaseUsersEnabled = false;
let userSchema = null;

const safeUserColumns = new Set(['id', 'username', 'email', 'password', 'password_hash', 'role', 'active', 'created_at']);
function userColumn(name) {
  if (!safeUserColumns.has(name)) throw new Error('Unsupported users table structure.');
  return `\`${name}\``;
}

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function sqlDate(value) {
  if (!(value instanceof Date)) return value == null ? null : String(value).slice(0, 10);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function serializeShipment(row) {
  return {
    id: row.id,
    routeId: row.route_id,
    shipmentNumber: row.shipment_number,
    route: `${row.loading_city || ''} → ${row.unloading_city || ''}`,
    loadingDate: sqlDate(row.loading_date),
    deliveryDate: sqlDate(row.road_delivery_date),
    extraTimeMinutes: Number(row.shipment_extra_time_minutes || 0),
    routeExtraTimeMinutes: Number(row.route_extra_time_minutes || 0),
    recipientDeadline: sqlDate(row.recipient_deadline),
    weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
    unitType: row.unit_type,
    calculatedDeliveryAt: row.result_delivery_date ? `${sqlDate(row.result_delivery_date)}${row.result_delivery_time ? `T${String(row.result_delivery_time).slice(0, 8)}` : ''}` : null,
    adr: Boolean(row.adr),
    transportType: row.transport_type || 'ROAD',
    status: row.result_id ? (row.recommended ? 'Optimizirano' : row.feasible ? 'Izvedljivo' : 'Za pregled') : 'V obdelavi',
    cost: row.total_cost,
    co2Kg: row.co2_kg
  };
}
function serializeRoute(row) {
  return {
    id: row.id,
    code: row.route_code,
    direction: row.direction,
    from: `${row.loading_postal_code} ${row.loading_city}, ${row.loading_country}`,
    to: `${row.unloading_postal_code} ${row.unloading_city}, ${row.unloading_country}`,
    roadDistanceKm: row.road_distance_km,
    unitType: row.typical_unit_type,
    shipments: row.shipments_count,
    averageTrucksPerWeek: row.average_trucks_per_week,
    loadingCountry: row.loading_country,
    loadingPostalCode: row.loading_postal_code,
    loadingCity: row.loading_city,
    unloadingCountry: row.unloading_country,
    unloadingPostalCode: row.unloading_postal_code,
    unloadingCity: row.unloading_city,
    shipmentsCount: row.shipments_count,
    loadingWindowStart: String(row.loading_window_start || '').slice(0, 5),
    loadingWindowEnd: String(row.loading_window_end || '').slice(0, 5),
    unloadingWindowStart: String(row.unloading_window_start || '').slice(0, 5),
    unloadingWindowEnd: String(row.unloading_window_end || '').slice(0, 5),
    cargoGroup: row.cargo_group,
    note: row.note,
    extraTimeMinutes: Number(row.extra_time_minutes || 0)
  };
}

async function requireSession(req, res, next) {
  try {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return res.status(401).json({ error: 'Prijava je potrebna.' });
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    const session = sessions.get(hash);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(hash);
      return res.status(401).json({ error: 'Prijava je potekla.' });
    }
    req.user = session.user;
    return next();
  } catch (error) { return next(error); }
}

function requireAdmin(req, res, next) {
  if (Number(req.user?.role) !== 1) return res.status(403).json({ error: 'Za to dejanje potrebujete skrbniško vlogo.' });
  return next();
}
const permissionCache = new Map();
const legacyUserPermissions = ['dashboard.read','shipments.read','routes.read','planner.use','messages.send'];
async function getRolePermissions(role) {
  const roleId = Number(role);
  if (roleId === 1) return ['*'];
  const cached = permissionCache.get(roleId);
  if (cached && cached.expiresAt > Date.now()) return cached.permissions;
  let permissions;
  try {
    const [rows] = await authPool.execute('SELECT permissions FROM roles WHERE role_id=? LIMIT 1', [roleId]);
    const value = rows[0]?.permissions;
    permissions = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(permissions)) permissions = [];
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const storedRole=await readJson(pool,`app_role_${roleId}`);
    permissions=Array.isArray(storedRole?.permissions)?storedRole.permissions:(roleId===2?legacyUserPermissions:[]);
  }
  permissionCache.set(roleId, { permissions, expiresAt: Date.now() + 15_000 });
  return permissions;
}
function clearRolePermissionCache(roleId) { permissionCache.delete(Number(roleId)); }
function permissionForRequest(req) {
  const path = req.path.replace(/\/$/, '') || '/';
  const method = req.method.toUpperCase();
  if (path === '/users' || path.startsWith('/users/')) return 'accounts.manage';
  if (path === '/roles' || path.startsWith('/roles/')) return 'roles.manage';
  if (path === '/admin-messages') return method === 'POST' ? 'messages.send' : 'messages.manage';
  if (path === '/audit-logs') return 'audit.read';
  if (path === '/unit-terminals') return method === 'GET' ? ['routes.read','terminals.manage'] : 'terminals.manage';
  if (path === '/terminal-network') return 'routes.read';
  if (path.startsWith('/unit-terminals/')) return 'terminals.manage';
  if (path === '/trailers' || path.startsWith('/trailers/')) return method === 'GET' ? ['routes.read','trailers.manage'] : 'trailers.manage';
  if (path === '/customers' || path.startsWith('/customers/')) return method === 'GET' ? 'customers.read' : 'customers.write';
  if (path === '/dashboard') return 'dashboard.read';
  if (path.startsWith('/delivery-plans') || path.startsWith('/places') || path.startsWith('/emissions') || path.startsWith('/rail-network') || path.startsWith('/road-disruptions')) return 'planner.use';
  if (path.startsWith('/shipments')) return method === 'GET' ? 'shipments.read' : 'shipments.write';
  if (path.startsWith('/routes')) return method === 'GET' ? 'routes.read' : 'routes.write';
  if (path.startsWith('/transport-routes') || path.startsWith('/parameters') || path.startsWith('/holidays')) return method === 'GET' ? 'routes.read' : 'routes.write';
  return 'dashboard.read';
}
function hasPermission(permissions, needed) {
  if (permissions.includes('*')) return true;
  const requirements=Array.isArray(needed)?needed:[needed];
  return requirements.some(code=>permissions.includes(code)||
    (code==='shipments.read'&&permissions.includes('shipments.write'))||
    (code==='routes.read'&&permissions.includes('routes.write'))||
    (code==='customers.read'&&permissions.includes('customers.write')));
}
async function authorizeApiAccess(req, res, next) {
  try {
    const permissions = await getRolePermissions(req.user?.role);
    const needed = permissionForRequest(req);
    if (!hasPermission(permissions,needed)) return res.status(403).json({ error: 'Vaša uporabniška vloga nima dovoljenja za to dejanje.' });
    return next();
  } catch (error) { return next(error); }
}
function requirePermission(code) {
  return async (req, res, next) => {
    try {
      const permissions = await getRolePermissions(req.user?.role);
      if (!hasPermission(permissions,code)) return res.status(403).json({ error: 'Vaša uporabniška vloga nima dovoljenja za to dejanje.' });
      return next();
    } catch (error) { return next(error); }
  };
}
function auditApiWrites(req, res, next) {
  res.on('finish', () => {
    if (!['POST','PUT','PATCH','DELETE'].includes(req.method) || res.statusCode >= 400) return;
    const entity = req.path.split('/').filter(Boolean).slice(0, 2).join('/').slice(0,120) || 'api';
    pool.execute('INSERT INTO audit_logs(user_id,username,action,entity,http_status) VALUES(?,?,?,?,?)', [req.user?.id || null, req.user?.username || req.user?.name || null, req.method, entity, res.statusCode]).catch(async error=>{if(error.code==='ER_NO_SUCH_TABLE')await writeJson(pool,`audit_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,'Revizijski dnevnik','API dejanje',{userId:req.user?.id||null,username:req.user?.username||req.user?.name||null,action:req.method,entity,status:res.statusCode,createdAt:new Date().toISOString()}).catch(()=>{});});
  });
  next();
}
function normalizeRole(value) {
  const role = String(value ?? '').trim().toUpperCase();
  if (role === 'ADMIN' || role === 'ADMINISTRATOR') return 1;
  if (role === 'USER' || role === 'STANDARD') return 2;
  return Number(value);
}


async function start() {
  const email = String(process.env.RAILOPT_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.RAILOPT_ADMIN_PASSWORD || '');
  await Promise.all([pool.query('SELECT 1'), authPool.query('SELECT 1')]);
  const authDatabase = process.env.MYSQL_AUTH_DATABASE || process.env.MYSQL_DATABASE || 'railopt';
  const [columns] = await authPool.execute(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema=? AND table_name='users'`, [authDatabase]);
  const names = new Set(columns.map(column => column.COLUMN_NAME || column.column_name));
  userSchema = {
    password: names.has('password_hash') ? 'password_hash' : names.has('password') ? 'password' : null,
    hasActive: names.has('active'),
    hasCreatedAt: names.has('created_at'),
    roleIsText: columns.some(column => (column.COLUMN_NAME || column.column_name) === 'role' && ['char', 'varchar', 'text', 'enum'].includes(String(column.DATA_TYPE || column.data_type).toLowerCase()))
  };
  databaseUsersEnabled = names.has('id') && names.has('username') && names.has('email') && names.has('role') && Boolean(userSchema.password);
  if (databaseUsersEnabled) {
    const roleFilter = userSchema.roleIsText ? "UPPER(role) IN ('1','ADMIN','ADMINISTRATOR')" : 'role=1';
    const activeFilter = userSchema.hasActive ? ' AND active=TRUE' : '';
    let [admins] = await authPool.query(`SELECT id,username,email,${userColumn(userSchema.password)} AS password_hash,role,${userSchema.hasActive ? 'active' : 'TRUE'} AS active FROM users WHERE ${roleFilter}${activeFilter} ORDER BY ${userSchema.hasCreatedAt ? 'created_at' : 'username'} LIMIT 1`);
    if (!admins.length && email && /^\S+@\S+\.\S+$/.test(email) && password.length >= 12) {
      const username = String(process.env.RAILOPT_ADMIN_USERNAME || 'admin').trim().slice(0, 80);
      try {
        const userPassword = await bcrypt.hash(password, 12);
        const columns = ['id', 'username', 'email', userSchema.password, 'role'];
        const values = [crypto.randomUUID(), username, email, userPassword, userSchema.roleIsText ? '1' : 1];
        if (userSchema.hasActive) { columns.push('active'); values.push(true); }
        await authPool.execute(`INSERT INTO users (${columns.map(userColumn).join(',')}) VALUES (${values.map(() => '?').join(',')})`, values);
      } catch (error) {
        if (error.code !== 'ER_DUP_ENTRY') throw error;
      }
      [admins] = await authPool.query(`SELECT id,username,email,${userColumn(userSchema.password)} AS password_hash,role,${userSchema.hasActive ? 'active' : 'TRUE'} AS active FROM users WHERE ${roleFilter}${activeFilter} ORDER BY ${userSchema.hasCreatedAt ? 'created_at' : 'username'} LIMIT 1`);
    }
    administrator = admins[0] ? { ...admins[0], role: normalizeRole(admins[0].role), name: admins[0].username, passwordHash: admins[0].password_hash } : null;
    console.log(`Connected user authentication to MySQL database ${authDatabase}.`);
  } else {
    throw new Error('The configured MySQL auth database does not contain a compatible users table.');
  }
  app.use('/api', createHealthRouter({ pool, authPool, asyncRoute }));
  app.use(createExcelImportRouter({ requireSession, requireAdmin, asyncRoute }));
  app.use(createAuthRouter({ pool, authPool, sessions, administrator, databaseUsersEnabled, userSchema, userColumn, normalizeRole, getRolePermissions, bcryptRounds, bcrypt, crypto, requireSession, asyncRoute }));
  app.use('/api', (req,res,next) => requireSession(req,res,() => authorizeApiAccess(req,res,next)));
  app.use('/api', auditApiWrites);
  app.use('/api', createAdminToolsRouter({ pool, authPool, requireSession, requireAdmin, requirePermission, clearRolePermissionCache, crypto }).router);
  app.use('/api', createEmissionsRouter({ requireSession, asyncRoute }));
  app.use('/api', createPlacesRouter({ pool, requireSession, asyncRoute }));
  app.use('/api', createDeliveryPlansRouter({ pool, requireSession, crypto }));
  app.use('/api', createRailNetworkRouter({ pool, requireSession, crypto }));
  app.use('/api', createRoadDisruptionsRouter({ pool, requireSession, crypto }));
  app.use(createUsersRouter({ pool, authPool, requireSession, requireAdmin, asyncRoute, databaseUsersEnabled, userSchema, userColumn, normalizeRole, bcryptRounds, crypto }));
  app.use(createDashboardRouter({ pool, requireSession, asyncRoute, serializeShipment }));
  app.use(createShipmentsRouter({ pool, requireSession, asyncRoute, serializeShipment, validDate }));
  app.use(createTransportRoutesRouter({ pool, requireSession, asyncRoute, serializeRoute, validTime }));
  app.use(createParametersRouter({ pool, requireSession, requireAdmin, asyncRoute, crypto }));
  app.use(createHolidaysRouter({ pool, requireSession, asyncRoute, validDate }));
  app.use((err, _req, res, _next) => {
    console.error(`API request failed: ${err.code || err.name || 'Error'}`);
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Uporabniško ime ali e-pošta je že zasedena.' });
    if (err.code === 'GEOCODING_UNAVAILABLE' || err.name === 'TimeoutError' || err.name === 'AbortError') return res.status(502).json({ error: 'Iskanje krajev ali cestne poti je predolgo. Preveri internetno povezavo in poskusi znova.' });
    const unavailable = ['ECONNREFUSED', 'PROTOCOL_CONNECTION_LOST', 'ER_BAD_DB_ERROR', 'ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'];
    if (unavailable.includes(err.code)) return res.status(503).json({ error: 'Storitev ali podatkovna shema trenutno ni na voljo.' });
    res.status(500).json({ error: 'Pri obdelavi zahteve je prišlo do napake.' });
  });
  const port = Number(process.env.PORT || 8080);
  app.listen(port, '127.0.0.1', () => console.log(`Railopt API listening on 127.0.0.1:${port}`));
}

start().catch(error => {
  console.error(`Could not start the Railopt API: ${error.code || error.name || 'Error'}`);
  process.exitCode = 1;
});

