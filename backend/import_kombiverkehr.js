require('dotenv').config({ path: require('node:path').resolve(__dirname, '.env') });
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');
const snapshot = require('./data/kombiverkehr-network.json');
const intermodal = require('./data/intermodal-terminals.json');
const unitTerminals = require('./data/unit-terminals.json');
const { writeNetworkSnapshot } = require('./lib/kombiverkehr-store');

const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const aliases = new Map([
  ['koper luka','koper'], ['ljubljana kt','ljubljana'], ['rail hub duisburg','duisburg'],
  ['antwerpen combinant','antwerpen'], ['koln eifeltor ubf','koln'], ['munchen riem ubf','munchen'],
  ['hamburg billwerder ubf','hamburg'], ['wels vbf cct','wels'], ['graz sud cct','graz'],
  ['verona quadrante europa','verona'], ['verona interterminal','verona'], ['busto arsizio','busto arsizio'],
  ['trieste plt terminal','trieste'], ['trieste samer','trieste'], ['rijeka brajdica','rijeka'],
  ['villach sud cct','villach'], ['linz omv chemiepark','linz'], ['linz omv chemiepark','linz'],
  ['duisburg rheinhausen dkt','duisburg'], ['ludwigshafen rh basf ubf','ludwigshafen'],
  ['rotterdam rsc','rotterdam'], ['rotterdam europoort p o nsf','rotterdam'], ['segrate','milano'],
  ['milano smistamento fs','milano'], ['madrid abronigal','madrid'], ['barcelona morrot','barcelona'],
  ['bari giovinazzo','bari'], ['bari ferruccio','bari'], ['nurnberg hafen ubf','nurnberg'],
  ['koln eifeltor','koln'], ['munchen riem','munchen'], ['antwerpen','antwerpen'],
]);

// The PDF lists terminal names but no coordinates. Use the terminal-city
// centre for places that are absent from the app's existing local terminal
// catalogue; keep the result explicitly labelled as approximate in the DB.
const cityCoordinates = [
  [/alnabru|oslo/, 59.944, 10.812], [/goteborg/, 57.708, 11.974], [/malmo/, 55.606, 13.001], [/hallsberg/, 59.066, 15.109],
  [/madrid|abronigal/, 40.381, -3.675], [/barcelona|llagosta|morrot/, 41.365, 2.146], [/sajoszentpeter/, 48.222, 20.719],
  [/haniska/, 48.628, 21.277], [/san roque/, 36.209, -5.386], [/melnik/, 50.350, 14.474], [/basel|weil a r/, 47.590, 7.600],
  [/hendaye|irun/, 43.359, -1.774], [/mersin/, 36.812, 34.641], [/sevilla|majarabique/, 37.421, -5.982], [/bludenz/, 47.154, 9.821],
  [/silla|valencia/, 39.360, -0.411], [/kiel/, 54.323, 10.122], [/mortara/, 45.250, 8.736], [/st michael/, 47.338, 15.017],
  [/murcia/, 37.992, -1.130], [/stockholm|rosersberg/, 59.478, 17.900], [/bratislava/, 48.148, 17.107], [/szeged/, 46.253, 20.141],
  [/segrate|milano smistamento/, 45.493, 9.294], [/umea/, 63.825, 20.263], [/ludwigshafen/, 49.477, 8.435],
  [/villach/, 46.611, 13.855], [/graz/, 47.070, 15.439], [/zilina/, 49.223, 18.740],
  [/brno/, 49.195, 16.608], [/neratovice/, 50.261, 14.518], [/trelleborg/, 55.376, 13.157], [/neuss/, 51.204, 6.687],
  [/trieste/, 45.649, 13.768], [/liberec/, 50.767, 15.056], [/nola|maddaloni|marcianise/, 40.921, 14.527],
  [/nurnberg|nuernberg/, 49.448, 11.082], [/catania/, 37.507, 15.083], [/obrnice|most/, 50.522, 13.684], [/cesme/, 38.323, 26.306],
  [/lovosice/, 50.515, 14.051], [/ostrava|mosnov|paskov/, 49.820, 18.263], [/cierna nad tisou/, 48.418, 22.088],
  [/constanti|tarragona/, 41.120, 1.245], [/lulea/, 65.584, 22.154], [/patras/, 38.246, 21.735], [/curtici|arad/, 46.344, 21.305],
  [/lyon|venissieux/, 45.697, 4.881], [/pendik/, 40.875, 29.234], [/dorpen/, 52.966, 7.322], [/lubeck/, 53.866, 10.687],
  [/pomezia/, 41.669, 12.502], [/gent/, 51.054, 3.717], [/poznan/, 52.407, 16.926], [/yalova/, 40.655, 29.276],
  [/prerov/, 49.456, 17.451], [/zaragoza/, 41.648, -0.889], [/gummern/, 46.628, 13.663], [/gavle/, 60.675, 17.142],
  [/rostock/, 54.092, 12.099], [/agognate/, 45.499, 8.535], [/bremen/, 53.080, 8.801], [/hamm/, 51.674, 7.816],
  [/lonato/, 45.461, 10.484], [/padova/, 45.407, 11.877], [/poggio rusco/, 44.970, 11.108], [/rheine/, 52.286, 7.441],
  [/villa opicina|fernetti/, 45.680, 13.788], [/worth rhein/, 49.048, 8.259], [/zeitz/, 51.049, 12.136],
];

function coordinatesFor(name) {
  const key = normalize(name);
  const wanted = aliases.get(key) || key;
  const rows = [...intermodal, ...unitTerminals];
  let match = rows.find(row => normalize(row.city) === wanted);
  if (!match) match = rows.find(row => {
    const city = normalize(row.city);
    return city.length > 3 && (wanted.includes(city) || city.includes(wanted));
  });
  if (match && Number.isFinite(Number(match.latitude)) && Number.isFinite(Number(match.longitude)))
    return { latitude: Number(match.latitude), longitude: Number(match.longitude), coordinateSource: 'local terminal-area catalogue' };
  const approximate = cityCoordinates.find(([pattern]) => pattern.test(key));
  return approximate
    ? { latitude: approximate[1], longitude: approximate[2], coordinateSource: 'approximate city-centre coordinate; PDF has no coordinates' }
    : { latitude: null, longitude: null, coordinateSource: null };
}

async function main() {
  const db = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || 'railopt',
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: false,
  });
  try {
    const migration = fs.readFileSync(path.join(__dirname, '..', 'migrations', '004_kombiverkehr_network.sql'), 'utf8');
    let normalizedTables = true;
    try {
      for (const statement of migration.split(';').map(value => value.trim()).filter(Boolean)) await db.query(statement);
    } catch (error) {
      if (!['ER_TABLEACCESS_DENIED_ERROR', 'ER_DBACCESS_DENIED_ERROR'].includes(error.code)) throw error;
      normalizedTables = false;
    }
    await db.beginTransaction();
    const terminals = [...new Set(snapshot.terminals)];
    const terminalData = terminals.map(name => {
      const point = coordinatesFor(name);
      return {
        id: crypto.randomUUID(), name, ...point,
        activeInSourceWeek: !snapshot.inactiveTerminals.includes(name),
      };
    });
    if (!normalizedTables) {
      const storedSnapshot = {
        ...snapshot,
        terminals: terminalData,
      };
      await writeNetworkSnapshot(db, storedSnapshot);
      await db.execute(
        `INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
         VALUES ('app_kombiverkehr_disruptions','Lokalni vozni red','Zaprtja železniških odsekov',NULL,NULL,'[]',?)
         ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name)`,
        [`Shranjeno v lokalni bazi Railopt`],
      );
      await db.commit();
      const geolocated = terminalData.filter(row => row.latitude != null && row.longitude != null).length;
      console.log(`Imported ${terminals.length} rail terminals (${geolocated} with coordinates) and ${snapshot.connections.length} timetable edges into the existing database settings store.`);
      return;
    }
    for (const name of terminals) {
      const point = terminalData.find(row => row.name === name);
      await db.execute(
        `INSERT INTO rail_terminals (id,name,latitude,longitude,active_in_source_week,source_note)
         VALUES (?,?,?,?,?,?) ON DUPLICATE KEY UPDATE latitude=VALUES(latitude),longitude=VALUES(longitude),
         active_in_source_week=VALUES(active_in_source_week),source_note=VALUES(source_note)`,
        [crypto.randomUUID(), name, point.latitude, point.longitude, snapshot.inactiveTerminals.includes(name) ? 0 : 1,
          point.coordinateSource || 'Kombiverkehr PDF timetable snapshot 2026-11-27 to 2026-12-03'],
      );
    }
    const [terminalRows] = await db.query('SELECT id,name FROM rail_terminals');
    const ids = new Map(terminalRows.map(row => [row.name, row.id]));
    await db.query('UPDATE rail_connections SET active=0');
    for (const edge of snapshot.connections) {
      await db.execute(
        `INSERT INTO rail_connections (id,origin_terminal_id,destination_terminal_id,train_numbers,departure_days,
         departure_times,weekly_runs,duration_minutes,inferred_train_number,source_note,source_period_start,source_period_end,active)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1)
         ON DUPLICATE KEY UPDATE train_numbers=VALUES(train_numbers),departure_days=VALUES(departure_days),
         departure_times=VALUES(departure_times),weekly_runs=VALUES(weekly_runs),duration_minutes=VALUES(duration_minutes),
         inferred_train_number=VALUES(inferred_train_number),source_note=VALUES(source_note),
         source_period_start=VALUES(source_period_start),source_period_end=VALUES(source_period_end),active=1`,
        [crypto.randomUUID(), ids.get(edge.from), ids.get(edge.to), JSON.stringify(edge.trainNumbers),
          JSON.stringify(edge.departureDays), JSON.stringify(edge.departureTimes), edge.runsPerWeek,
          edge.durationMinutes, edge.inferred ? 1 : 0, edge.note || null, snapshot.periodStart, snapshot.periodEnd],
      );
    }
    await db.commit();
    const [counts] = await db.query(`SELECT
      (SELECT COUNT(*) FROM rail_terminals) AS terminals,
      (SELECT COUNT(*) FROM rail_connections WHERE active=1) AS connections,
      (SELECT COUNT(*) FROM rail_terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL) AS geolocated`);
    console.log(`Imported ${counts[0].terminals} rail terminals (${counts[0].geolocated} with coordinates) and ${counts[0].connections} timetable edges.`);
  } catch (error) {
    try { await db.rollback(); } catch {}
    console.error(`Kombiverkehr import failed: ${error.code || error.name || 'Error'}`);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main();
