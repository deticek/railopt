const CHUNK_SIZE = 16000;
const MANIFEST_CODE = 'app_kombiverkehr_network_manifest';
const CHUNK_PREFIX = 'app_kombiverkehr_network_data_';

async function writeNetworkSnapshot(pool, value) {
  const serialized = JSON.stringify(value);
  const chunks = serialized.match(new RegExp(`.{1,${CHUNK_SIZE}}`, 'gs')) || [''];
  for (let index = 0; index < chunks.length; index++) {
    const code = `${CHUNK_PREFIX}${String(index).padStart(3, '0')}`;
    await pool.execute(
      `INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
       VALUES (?, 'Lokalni vozni red', ?, NULL, NULL, ?, ?)
       ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name),
       text_value=VALUES(text_value),source_note=VALUES(source_note)`,
      [code, `Kombiverkehr omrežje (${index + 1}/${chunks.length})`, chunks[index], 'Lokalni PDF vozni red'],
    );
  }
  await pool.execute(
    `INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
     VALUES (?, 'Lokalni vozni red', 'Manifest Kombiverkehr omrežja', NULL, NULL, ?, 'Lokalni PDF vozni red')
     ON DUPLICATE KEY UPDATE text_value=VALUES(text_value),source_note=VALUES(source_note)`,
    [MANIFEST_CODE, JSON.stringify({ chunks: chunks.length })],
  );
  await pool.execute('DELETE FROM parameters WHERE parameter_code LIKE ? AND parameter_code>=?', [`${CHUNK_PREFIX}%`, `${CHUNK_PREFIX}${String(chunks.length).padStart(3, '0')}`]);
}

async function readNetworkSnapshot(pool) {
  const [rows] = await pool.execute('SELECT text_value FROM parameters WHERE parameter_code=? LIMIT 1', [MANIFEST_CODE]);
  if (!rows.length) return null;
  let manifest;
  try { manifest = JSON.parse(rows[0].text_value || '{}'); } catch { return null; }
  const count = Number(manifest.chunks);
  if (!Number.isInteger(count) || count < 1 || count > 100) return null;
  const codes = Array.from({ length: count }, (_, index) => `${CHUNK_PREFIX}${String(index).padStart(3, '0')}`);
  const placeholders = codes.map(() => '?').join(',');
  const [parts] = await pool.execute(`SELECT parameter_code,text_value FROM parameters WHERE parameter_code IN (${placeholders})`, codes);
  const byCode = new Map(parts.map(row => [row.parameter_code, row.text_value || '']));
  const serialized = codes.map(code => byCode.get(code) || '').join('');
  try { return JSON.parse(serialized); } catch { return null; }
}

module.exports = { readNetworkSnapshot, writeNetworkSnapshot };
