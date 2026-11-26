require('dotenv').config({ path: require('node:path').resolve(__dirname, '.env') });
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const terminalRows = require('./data/unit-terminals.json');
const { writeJson } = require('./lib/parameter-store');

const countryName = { SI:'Slovenia', DE:'Germany', AT:'Austria', IT:'Italy', BE:'Belgium' };
const kindName = { P400:'P400', CONTAINER:'container', SWAP_BODY:'Swap Body' };
const countryCodeFrom = (value, fallback) => {
  const text=String(value||'').toLocaleLowerCase('sl');
  if(/sloven|\bsi\b/.test(text))return 'SI';
  if(/nemč|german|\bde\b/.test(text))return 'DE';
  if(/avstr|austr|\bat\b/.test(text))return 'AT';
  if(/ital|\bit\b/.test(text))return 'IT';
  if(/belg|\bbe\b/.test(text))return 'BE';
  return fallback;
};
const delay = ms => new Promise(resolve => setTimeout(resolve,ms));
async function geocode(address, serviceCity, fallbackCountry) {
  const addressParts=String(address||'').split(',').map(x=>x.trim()).filter(Boolean);
  const queries=[`${address}, ${countryName[fallbackCountry]||''}`];
  if(addressParts.length>1){const locality=addressParts.length>2?addressParts.slice(1,-1).join(', '):addressParts[1];if(locality)queries.push(`${locality}, ${countryName[fallbackCountry]||''}`);}
  for(const query of [...new Set(queries)]){
    const url=new URL(process.env.GEOCODER_URL||'https://photon.komoot.io/api/');
    url.searchParams.set('q',query);url.searchParams.set('limit','1');
    const response=await fetch(url,{headers:{'User-Agent':'RailoptDesktop/1.0 (terminal import)'},signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw new Error(`Geokodiranje ni uspelo za terminal v kraju ${serviceCity}.`);
    const data=await response.json(),feature=data?.features?.[0],coords=feature?.geometry?.coordinates,props=feature?.properties||{};
    if(Array.isArray(coords)&&coords.length>=2)return { longitude:Number(coords[0]),latitude:Number(coords[1]),city:String(props.city||props.town||props.village||props.name||serviceCity),countryCode:countryCodeFrom(props.country||props.countrycode,fallbackCountry) };
  }
  return null;
}
async function main(){
  const pool=await mysql.createConnection({host:process.env.MYSQL_HOST||'localhost',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE||'railopt',charset:'utf8mb4',connectTimeout:7000});
  try{
    let imported=0,geocoded=0;const cache=new Map(),prepared=[];let normalized=true;
    try{await pool.query('SELECT id FROM unit_terminals LIMIT 0');}catch(error){if(error.code==='ER_NO_SUCH_TABLE')normalized=false;else throw error;}
    const existing=normalized?[]:(await pool.execute('SELECT text_value FROM parameters WHERE parameter_code=? LIMIT 1',['app_unit_terminals_catalog']))[0].map(row=>{try{return JSON.parse(row.text_value||'[]')}catch{return []}}).flat();
    const existingIds=new Map(existing.map(row=>[`${row.unitType}|${row.serviceCity}`,row.id]));
    for(const row of terminalRows){
      const key=`${row.address}|${row.countryCode}`;
      let geo=cache.get(key);
      if(geo===undefined){try{geo=await geocode(row.address,row.city,row.countryCode);cache.set(key,geo);geocoded+=geo?1:0;}catch{geo=null;cache.set(key,null);}await delay(750);}
      const countryCode=geo?.countryCode||countryCodeFrom(row.address,row.countryCode);
      const terminalCity=geo?.city||row.city;
      const name=`${terminalCity} ${kindName[row.unitType]} terminal`;
      prepared.push({id:existingIds.get(`${row.unitType}|${row.city}`)||crypto.randomUUID(),unitType:row.unitType,serviceCity:row.city,city:terminalCity,countryCode,name,address:row.address,latitude:geo?.latitude??null,longitude:geo?.longitude??null,cityDistanceKm:row.cityDistanceKm??null,source:row.source,active:true});
      imported++;
    }
    if(normalized){await pool.beginTransaction();for(const row of prepared)await pool.execute(`INSERT INTO unit_terminals(id,unit_type,service_city,city,country_code,name,address,latitude,longitude,city_distance_km,source_note,active)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,1) ON DUPLICATE KEY UPDATE city=VALUES(city),country_code=VALUES(country_code),name=VALUES(name),address=VALUES(address),latitude=VALUES(latitude),longitude=VALUES(longitude),city_distance_km=VALUES(city_distance_km),source_note=VALUES(source_note),active=1`,[row.id,row.unitType,row.serviceCity,row.city,row.countryCode,row.name,row.address,row.latitude,row.longitude,row.cityDistanceKm,row.source]);await pool.commit();}
    else await writeJson(pool,'app_unit_terminals_catalog','Terminals','Terminali po vrsti enote',prepared,'source:TIM_Hekaton_2026_podatki_v2_v2.xlsx');
    console.log(`Uvoženih ${imported} terminalov različnih vrst; koordinate najdene za ${geocoded} različnih naslovov.`);
  }catch(error){try{await pool.rollback();}catch{}console.error(`Uvoz terminalov ni uspel: ${error.code||error.name||'Error'}`);process.exitCode=1;}
  finally{await pool.end();}
}
main();
