// Imports every worksheet from the workbook. Text in the workbook is treated as data.
const path = require('node:path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');
const unzipper = require('unzipper');
const { DOMParser } = require('@xmldom/xmldom');

dotenv.config({ path: path.join(__dirname, '.env') });
const workbookPath = process.argv[2] || 'C:/Users/deticek/Downloads/TIM_Hekaton_2026_podatki_v2.xlsx';
const parser = new DOMParser({ errorHandler: { warning() {}, error(message) { throw new Error(message); }, fatalError(message) { throw new Error(message); } } });
const children = node => Array.from(node.childNodes || []).filter(x => x.nodeType === 1);
const descendants = (node, name) => Array.from(node.getElementsByTagName(name));
const colIndex = ref => { let n = 0; for (const c of ref.match(/^[A-Z]+/)[0]) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };
const dateFromSerial = serial => new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86400000).toISOString().slice(0, 10);
const timeFromFraction = n => { const secs = Math.round(Number(n) * 86400); return `${String(Math.floor(secs / 3600)).padStart(2,'0')}:${String(Math.floor(secs % 3600 / 60)).padStart(2,'0')}:${String(secs % 60).padStart(2,'0')}`; };

async function readWorkbook(file) {
  const zip = await unzipper.Open.file(file);
  const entry = name => zip.files.find(item => item.path === name);
  const readXml = async name => {
    const item = entry(name);
    if (!item) throw new Error(`Workbook is missing ${name}`);
    return parser.parseFromString((await item.buffer()).toString('utf8'), 'text/xml');
  };
  const shared = [];
  if (entry('xl/sharedStrings.xml')) {
    for (const si of descendants(await readXml('xl/sharedStrings.xml'), 'si')) shared.push(descendants(si, 't').map(t => t.textContent || '').join(''));
  }
  const workbook = await readXml('xl/workbook.xml');
  const rels = await readXml('xl/_rels/workbook.xml.rels');
  const targets = {};
  for (const rel of descendants(rels, 'Relationship')) targets[rel.getAttribute('Id')] = rel.getAttribute('Target').replace(/^\//, '').replace(/^xl\//, '');
  const sheets = {};
  for (const sheet of descendants(workbook, 'sheet')) {
    const name = sheet.getAttribute('name');
    const relId = sheet.getAttribute('r:id') || sheet.getAttribute('id');
    const xml = await readXml(`xl/${targets[relId]}`);
    const rows = [];
    for (const row of descendants(xml, 'row')) {
      const values = [];
      for (const cell of descendants(row, 'c')) {
        const index = colIndex(cell.getAttribute('r'));
        const type = cell.getAttribute('t');
        const valueNode = descendants(cell, 'v')[0];
        let value = valueNode?.textContent ?? '';
        if (type === 's') value = shared[Number(value)] ?? '';
        else if (type === 'inlineStr') value = descendants(cell, 't').map(t => t.textContent || '').join('');
        values[index] = value;
      }
      rows.push(values);
    }
    sheets[name] = rows;
  }
  return sheets;
}

const cell = (row, index) => row[index] ?? '';
const clean = value => String(value ?? '').trim();
const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const parseWindow = value => {
  const times = clean(value).match(/\d{1,2}:\d{2}/g) || [];
  if (times.length < 2) throw new Error(`Invalid time window in workbook: ${value}`);
  return times.map(time => `${time.padStart(5, '0')}:00`);
};
const parseNumber = value => {
  if (typeof value === 'number') return value;
  const match = clean(value).replace(/\s/g, '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};
const parameterCode = (group, name) => `${normalized(group)}_${normalized(name)}`.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 100);

async function main() {
  const sheets = await readWorkbook(workbookPath);
  const required = ['relacije', 'pošiljke', 'parametri', 'prazniki', 'navodila', 'opis stolpcev'];
  for (const name of required) if (!sheets[name]?.length) throw new Error(`Required workbook sheet not found: ${name}`);
  const routesSheet = sheets.relacije;
  const shipmentSheet = sheets['pošiljke'];
  const parameterSheet = sheets.parametri;
  const holidaySheet = sheets.prazniki;
  const routeRows = routesSheet.slice(1).filter(row => clean(cell(row, 0)));
  const shipmentRows = shipmentSheet.slice(1).filter(row => clean(cell(row, 0)));
  const parameterRows = parameterSheet.slice(1).filter(row => clean(cell(row, 1)));
  const holidayRows = holidaySheet.slice(1).filter(row => clean(cell(row, 0)));
  const connection = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost', port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || 'railopt', user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD, charset: 'utf8mb4'
  });
  try {
    await connection.beginTransaction();
    const routeIds = new Map();
    for (const row of routeRows) {
      const code = clean(cell(row, 0));
      const [loadingStart, loadingEnd] = parseWindow(cell(row, 12));
      const [unloadingStart, unloadingEnd] = parseWindow(cell(row, 13));
      const values = [code, clean(cell(row, 1)), clean(cell(row, 2)).toUpperCase(), clean(cell(row, 3)), clean(cell(row, 4)), clean(cell(row, 5)).toUpperCase(), clean(cell(row, 6)), clean(cell(row, 7)), Number(cell(row, 8)), clean(cell(row, 9)), parseNumber(cell(row, 10)), Number(cell(row, 11)), loadingStart, loadingEnd, unloadingStart, unloadingEnd, clean(cell(row, 14)), clean(cell(row, 15)) || null];
      await connection.execute(`INSERT INTO routes (route_code,direction,loading_country,loading_postal_code,loading_city,unloading_country,unloading_postal_code,unloading_city,road_distance_km,typical_unit_type,average_trucks_per_week,shipments_count,loading_window_start,loading_window_end,unloading_window_start,unloading_window_end,cargo_group,note)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE direction=VALUES(direction),loading_country=VALUES(loading_country),loading_postal_code=VALUES(loading_postal_code),loading_city=VALUES(loading_city),unloading_country=VALUES(unloading_country),unloading_postal_code=VALUES(unloading_postal_code),unloading_city=VALUES(unloading_city),road_distance_km=VALUES(road_distance_km),typical_unit_type=VALUES(typical_unit_type),average_trucks_per_week=VALUES(average_trucks_per_week),shipments_count=VALUES(shipments_count),loading_window_start=VALUES(loading_window_start),loading_window_end=VALUES(loading_window_end),unloading_window_start=VALUES(unloading_window_start),unloading_window_end=VALUES(unloading_window_end),cargo_group=VALUES(cargo_group),note=VALUES(note)`, values);
      const [[route]] = await connection.execute('SELECT id FROM routes WHERE route_code=?', [code]);
      routeIds.set(code, route.id);
    }
    for (const row of shipmentRows) {
      const number = Number(cell(row, 0));
      const routeId = routeIds.get(clean(cell(row, 1)));
      if (!routeId) throw new Error(`Shipment ${number} refers to missing route ${cell(row, 1)}`);
      const loadingDate = dateFromSerial(cell(row, 4));
      const deliveryDate = dateFromSerial(cell(row, 6));
      const deadline = dateFromSerial(cell(row, 7));
      await connection.execute(`INSERT INTO shipments (shipment_number,route_id,loading_text,unloading_text,loading_date,road_delivery_date,recipient_deadline,weight_kg,unit_type,adr)
        VALUES (?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE route_id=VALUES(route_id),loading_text=VALUES(loading_text),unloading_text=VALUES(unloading_text),loading_date=VALUES(loading_date),road_delivery_date=VALUES(road_delivery_date),recipient_deadline=VALUES(recipient_deadline),weight_kg=VALUES(weight_kg),unit_type=VALUES(unit_type),adr=VALUES(adr)`, [number, routeId, clean(cell(row, 2)), clean(cell(row, 3)), loadingDate, deliveryDate, deadline, Number(cell(row, 8)), clean(cell(row, 9)), /^da$/i.test(clean(cell(row, 10))) ? 1 : 0]);
    }
    for (const row of parameterRows) {
      const group = clean(cell(row, 0));
      const name = clean(cell(row, 1));
      const raw = clean(cell(row, 2));
      const unit = clean(cell(row, 3)) || null;
      const note = clean(cell(row, 4)) || null;
      let fixed = null, perUnit = null, numeric = parseNumber(raw), text = raw || null;
      const fare = raw.match(/^\s*(-?\d+(?:[,.]\d+)?)\s*\+\s*(-?\d+(?:[,.]\d+)?)/);
      if (fare) { fixed = parseNumber(fare[1]); perUnit = parseNumber(fare[2]); numeric = null; }
      if (!raw || numeric === null) { numeric = null; text = raw || null; }
      await connection.execute(`INSERT INTO parameters (parameter_code,parameter_group,parameter_name,fixed_value,per_unit_value,numeric_value,unit,text_value,source_note)
        VALUES (?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name),fixed_value=VALUES(fixed_value),per_unit_value=VALUES(per_unit_value),numeric_value=VALUES(numeric_value),unit=VALUES(unit),text_value=VALUES(text_value),source_note=VALUES(source_note)`, [parameterCode(group, name), group, name, fixed, perUnit, numeric, unit, text, note]);
    }
    for (const row of holidayRows) {
      const country = clean(cell(row, 0)).toUpperCase();
      const date = dateFromSerial(cell(row, 1));
      const name = clean(cell(row, 3));
      await connection.execute(`INSERT INTO holidays (country_code,holiday_date,holiday_name,note) VALUES (?,?,?,?)
        ON DUPLICATE KEY UPDATE note=VALUES(note)`, [country, date, name, clean(cell(row, 4)) || null]);
    }
    const [[routeCount]] = await connection.query('SELECT COUNT(*) AS count FROM routes');
    const [[shipmentCount]] = await connection.query('SELECT COUNT(*) AS count FROM shipments');
    let referenceRows = 0;
    for (const sheetName of ['navodila', 'opis stolpcev']) {
      const sheet = sheets[sheetName];
      if (!sheet?.length) continue;
      const headers = sheet[0].map((value, i) => clean(value) || `stolpec_${i + 1}`);
      for (const [index, row] of sheet.slice(1).entries()) {
        if (!row.some(value => clean(value))) continue;
        const values = Object.fromEntries(headers.map((header, i) => [header, clean(cell(row, i))]));
        const name = `${sheetName}: ${clean(cell(row, 0)) || `vrstica ${index + 2}`}`.slice(0, 200);
        const code = `excel_${normalized(sheetName).replace(/[^a-z0-9]+/g, '_')}_${index + 1}`.slice(0, 100);
        await connection.execute(`INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
          VALUES (?,?,?,NULL,NULL,?,?) ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name),text_value=VALUES(text_value),source_note=VALUES(source_note)`,
        [code, 'Excel dokumentacija', name, JSON.stringify(values), `List ${sheetName}, vrstica ${index + 2}`]);
        referenceRows++;
      }
    }
    const [[parameterCount]] = await connection.query('SELECT COUNT(*) AS count FROM parameters');
    const [[holidayCount]] = await connection.query('SELECT COUNT(*) AS count FROM holidays');
    await connection.commit();
    console.log(JSON.stringify({ imported: { routes: routeRows.length, shipments: shipmentRows.length, parameters: parameterRows.length, holidays: holidayRows.length, workbookReferenceRows: referenceRows }, databaseTotals: { routes: routeCount.count, shipments: shipmentCount.count, parameters: parameterCount.count, holidays: holidayCount.count } }));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { await connection.end(); }
}

main().catch(error => { console.error(`Excel import failed: ${error.code || error.name || 'Error'}`); process.exitCode = 1; });
