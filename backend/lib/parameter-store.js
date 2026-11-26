async function readJson(pool, code) {
  const [rows]=await pool.execute('SELECT text_value FROM parameters WHERE parameter_code=? LIMIT 1',[code]);
  if(!rows.length)return null;
  try{return JSON.parse(rows[0].text_value||'null');}catch{return null;}
}
async function writeJson(pool,code,group,name,value,note='managed-by:railopt'){
  await pool.execute(`INSERT INTO parameters(parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note)
    VALUES(?,?,?,NULL,NULL,?,?) ON DUPLICATE KEY UPDATE parameter_group=VALUES(parameter_group),parameter_name=VALUES(parameter_name),text_value=VALUES(text_value),source_note=VALUES(source_note)`,
  [code,group,name,JSON.stringify(value),note]);
}
async function listJson(pool,group,prefix){
  const [rows]=await pool.execute('SELECT parameter_code,text_value FROM parameters WHERE parameter_group=? AND parameter_code LIKE ? ORDER BY parameter_code',[group,`${prefix}%`]);
  return rows.map(row=>{try{return {code:row.parameter_code,value:JSON.parse(row.text_value||'null')};}catch{return null;}}).filter(Boolean);
}
module.exports={readJson,writeJson,listJson};
