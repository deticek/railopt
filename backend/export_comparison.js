// Read-only export of shipment inputs and latest saved application calculations.
// Writes a CSV that contains no user accounts, session tokens, or configuration secrets.
require('dotenv').config({ path: require('node:path').join(__dirname, '.env') });

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const outputPath = path.resolve(__dirname, '..', 'comparison-export.csv');
const pool = mysql.createPool({
  host: process.env.MYSQL_HOST || 'localhost',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'railopt',
  connectTimeout: 7000,
  connectionLimit: 1,
  charset: 'utf8mb4',
  dateStrings: ['DATE'],
});

function csv(value) {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

async function main() {
  const [rows] = await pool.query(`
    SELECT
      s.shipment_number AS shipmentNumber,
      r.route_code AS routeCode,
      s.loading_date AS loadingDate,
      s.weight_kg AS weightKg,
      s.unit_type AS unitType,
      s.adr AS adr,
      r.loading_city AS origin,
      r.unloading_city AS destination,
      tr.transport_type AS selectedMode,
      tr.feasible AS selectedFeasible,
      tr.total_cost AS selectedCostEur,
      tr.co2_kg AS selectedCo2Kg,
      tr.delivery_date AS selectedDeliveryDate,
      tr.delivery_time AS selectedDeliveryTime,
      tr.road_distance_km AS selectedRoadKm,
      tr.rail_distance_km AS selectedRailKm,
      tr.rejection_reason AS selectedNote
    FROM shipments s
    JOIN routes r ON r.id=s.route_id
    LEFT JOIN transport_results tr ON tr.id=(
      SELECT t.id FROM transport_results t
      WHERE t.shipment_id=s.id
      ORDER BY t.recommended DESC,t.created_at DESC
      LIMIT 1
    )
    ORDER BY s.shipment_number
  `);

  if (!rows.length) throw new Error('Baza ne vsebuje pošiljk.');
  const headers = Object.keys(rows[0]);
  const content = [headers.map(csv).join(','), ...rows.map(row => headers.map(key => csv(row[key])).join(','))].join('\r\n');
  fs.writeFileSync(outputPath, `\uFEFF${content}\r\n`, 'utf8');
  const calculated = rows.filter(row => row.selectedMode != null).length;
  console.log(`Izvoženih pošiljk: ${rows.length}`);
  console.log(`Pošiljk z izračunom v bazi: ${calculated}`);
  console.log(`CSV: ${outputPath}`);
}

main().catch(error => {
  console.error(`Izvoz ni uspel: ${error.code || error.message}`);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
