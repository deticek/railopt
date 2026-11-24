require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });
const mysql = require('mysql2/promise');
const { estimateDeliveryPlan } = require('./services/delivery-planner');

function objectValue(value) {
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return {}; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nearestTerminal(place, terminals) {
  const lat = Number(place?.lat);
  const lon = Number(place?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const closest = terminals.reduce((nearest, terminal) => {
    const terminalLat = Number(terminal.latitude);
    const terminalLon = Number(terminal.longitude);
    const dLat = (terminalLat - lat) * Math.PI / 180;
    const dLon = (terminalLon - lon) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat * Math.PI / 180)
      * Math.cos(terminalLat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    const distance = 6371 * 2 * Math.asin(Math.sqrt(a));
    return !nearest || distance < nearest.distance ? { distance, terminal } : nearest;
  }, null);
  if (!closest) return null;
  const row = closest.terminal;
  return { label: row.name, lat: Number(row.latitude), lon: Number(row.longitude), countryCode: row.country_code || null };
}

async function recalculate(inputValue, resultValue, terminals, pool, params) {
  const savedInput = objectValue(inputValue);
  const input = { ...savedInput, ...objectValue(savedInput.input) };
  const previousResult = { ...objectValue(resultValue), ...objectValue(objectValue(resultValue).result) };
  if (!input.origin || !input.destination) throw new Error('V shranjenem izračunu manjkajo lokacije.');
  const terminalOrigin = nearestTerminal(input.origin, terminals);
  const terminalDestination = nearestTerminal(input.destination, terminals);
  if (input.transportMode === 'compare' && (!terminalOrigin || !terminalDestination)) {
    throw new Error('V trenutni bazi ni koordiniranih terminalov za primerjavo prevozov.');
  }
  input.terminalOrigin = terminalOrigin;
  input.terminalDestination = terminalDestination;
  const result = await estimateDeliveryPlan(input, { pool, params });
  const previousOptionId = previousResult.selectedOptionId;
  const selectedOptionId = result.options.some(option => option.id === previousOptionId)
    ? previousOptionId
    : result.recommendedOptionId || result.options[0]?.id;
  return { input, result: { ...result, selectedOptionId } };
}

async function main() {
  const pool = mysql.createPool({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || 'railopt',
    connectionLimit: 2
  });
  try {
    const [terminals] = await pool.query(
      'SELECT name,country_code,latitude,longitude FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL'
    );
    if (!terminals.length) throw new Error('V tabeli terminals ni terminalov z veljavnimi koordinatami.');
    const [parameterRows] = await pool.query(
      'SELECT parameter_code,fixed_value,per_unit_value,numeric_value,text_value FROM parameters'
    );
    const params = new Map(parameterRows.map(row => [row.parameter_code, row]));
    let updated = 0;
    const failures = [];

    try {
      const [plans] = await pool.query('SELECT id,input_json,result_json FROM delivery_plans');
      for (const plan of plans) {
        try {
          const updatedPlan = await recalculate(plan.input_json, plan.result_json, terminals, pool, params);
          await pool.execute(
            'UPDATE delivery_plans SET input_json=?,result_json=? WHERE id=?',
            [JSON.stringify(updatedPlan.input), JSON.stringify(updatedPlan.result), plan.id]
          );
          updated++;
        } catch (error) {
          failures.push({ id: String(plan.id), message: error.message || 'Izračun ni uspel.' });
        }
      }
    } catch (error) {
      if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    }

    const [snapshots] = await pool.query(
      "SELECT parameter_code,parameter_name,source_note,text_value FROM parameters WHERE LEFT(parameter_code,14)='delivery_plan_'"
    );
    for (const row of snapshots) {
      try {
        const snapshot = objectValue(row.text_value);
        const updatedPlan = await recalculate(snapshot.input, snapshot.result, terminals, pool, params);
        snapshot.input = updatedPlan.input;
        snapshot.result = updatedPlan.result;
        const name = `${updatedPlan.input.origin.label} → ${updatedPlan.input.destination.label}`.slice(0, 200);
        const [writeResult] = await pool.execute(
          'UPDATE parameters SET parameter_name=?,text_value=? WHERE parameter_code=? AND source_note=?',
          [name, JSON.stringify(snapshot), row.parameter_code, row.source_note]
        );
        if (!writeResult.affectedRows) throw new Error('Shranjeni izračun se je med preračunom spremenil.');
        updated++;
      } catch (error) {
        failures.push({ id: row.parameter_code, message: error.message || 'Izračun ni uspel.' });
      }
    }
    console.log(JSON.stringify({ terminalCount: terminals.length, updated, failed: failures.length, failures }));
    if (failures.length) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(`Delivery plan recalculation failed: ${error.message || error.code || error.name}`);
  process.exitCode = 1;
});
