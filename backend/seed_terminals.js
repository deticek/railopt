const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({path:path.join(__dirname,'.env')});
const mysql = require('mysql2/promise');

const source = {
  SI: 'https://spot.gov.si/sl/dejavnosti-in-poklici/dejavnosti/kombiniran-prevoz-v-zelezniskem-prometu',
  AT: 'https://infrastruktur.oebb.at/en/partners/rail-network/documents-and-data/terminal-map',
  DE: 'https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht',
  IT: 'https://www.terminaliitalia.it/en/map.html',
  PL: 'https://dane.utk.gov.pl/sts/transport-intermodalny/mapa-terminali/18573',
  METRANS: 'https://metrans.eu/wp-content/uploads/2024/02/3-GC_General-Conditions-for-container-transports-in-2024.pdf'
};

// Official operator/government terminal lists. Coordinates are resolved once and kept in this file.
const seeds = [
  // Slovenia: terminals and transshipment stations identified by the government portal.
  ['Koper freight terminal','SI','Koper','Sermin 8, Koper, Slovenia','https://www.sz.si/'],
  ['Ljubljana intermodal terminal','SI','Ljubljana','Letališka cesta 14, Ljubljana, Slovenia','https://www.sz.si/'],
  ['Maribor freight terminal','SI','Maribor','Maribor freight terminal, Slovenia','https://www.sz.si/'],
  ['Sežana freight terminal','SI','Sežana','Sežana freight terminal, Slovenia','https://www.sz.si/'],
  ['Celje freight transshipment station','SI','Celje','Celje freight railway terminal, Slovenia','https://www.sz.si/'],
  ['Novo mesto freight transshipment station','SI','Novo mesto','Novo mesto freight railway terminal, Slovenia','https://www.sz.si/'],
  // Austria: ÖBB's published terminal map and operator directory.
  ['Bludenz Container Terminal','AT','Nüziders','Bundesstraße 18, 6714 Nüziders, Austria','https://container-haemmerle.com/'],
  ['Brennersee Terminal','AT','Gries am Brenner','An der Bundesstraße 243, 6156 Gries am Brenner, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Container Terminal Enns','AT','Enns','Ennshafenstraße 45, 4470 Enns, Austria','https://www.ct-enns.at/'],
  ['Terminal Graz Süd','AT','Werndorf','Am Terminal 2, 8402 Werndorf, Austria','https://www.stlb.at/terminal-graz-sued'],
  ['Hall in Tirol Terminal','AT','Hall in Tirol','Löfflerweg 35, 6060 Hall in Tirol, Austria','https://www.tssu.at/'],
  ['Montan Terminal Kapfenberg','AT','Kapfenberg','Terminalstraße 1, 8605 Kapfenberg, Austria','https://montansped.com/'],
  ['METRANS Krems Terminal','AT','Krems an der Donau','Karl-Mierka-Straße 7-9, 3500 Krems an der Donau, Austria','https://www.metrans.at/terminal-krems-an-der-donau'],
  ['Linz Stadthafen Container Terminal','AT','Linz','Saxingerstraße 1a, 4020 Linz, Austria','https://www.linzag.at/'],
  ['Salzburg Liefering Container Terminal','AT','Wals','Terminalstraße 2, 5071 Wals, Austria','https://www.ct-sbg.at/'],
  ['St. Michael Terminal','AT','Madstein','Am Terminal 1, 8770 Madstein, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Villach Terminal','AT','Fürnitz','Hart 100, 9586 Fürnitz, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Wels Terminal','AT','Wels','Terminalstraße 100, 4600 Wels, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Wien Freudenau WienCont','AT','Wien','Freudenauer Hafenstraße 12, 1020 Wien, Austria','https://www.wiencont.com/'],
  ['Wien Süd Terminal','AT','Wien','Wien-Süd I, 1100 Wien, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Wolfurt Terminal','AT','Wolfurt','Senderstraße 36, 6922 Wolfurt, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  ['Wörgl Terminal','AT','Wörgl','Gewerbepark 2a, 6300 Wörgl, Austria','https://infrastruktur.oebb.at/en/partners/rail-network/terminals'],
  // Germany: DUSS-operated intermodal terminals, addresses from its 2026 infrastructure list.
  ['DUSS Augsburg','DE','Augsburg','Kobelweg 10, 86156 Augsburg, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Basel - Weil am Rhein','DE','Weil am Rhein','Am Umschlagbahnhof 1, 79576 Weil am Rhein, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Beiseförth','DE','Malsfeld','Aueweg, 34323 Malsfeld, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Berlin Großbeeren','DE','Großbeeren','An der Anhalter Bahn 1, 14979 Großbeeren, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Duisburg','DE','Duisburg','Stahlinsel, 47138 Duisburg, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Erfurt','DE','Erfurt','August-Borsig-Straße 9, 99098 Erfurt, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Frankfurt am Main','DE','Frankfurt am Main','Ferdinand-Happ-Straße 61, 60314 Frankfurt am Main, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Göttingen','DE','Göttingen','Am Güterverkehrszentrum 11, 37073 Göttingen, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Hamburg-Billwerder','DE','Hamburg','Halskestraße 67, 22113 Hamburg, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Hannover-Lehrte','DE','Lehrte','Eisenbahnlängsweg 100, 31275 Lehrte, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Ingolstadt','DE','Ingolstadt','Furtwänglerstraße 2, 85057 Ingolstadt, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Karlsruhe','DE','Karlsruhe','Wolfartsweiererstraße 38, 76137 Karlsruhe, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Köln-Eifeltor','DE','Köln','Am Eifeltor 2, 50997 Köln, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Kornwestheim','DE','Kornwestheim','Am Containerbahnhof 1, 70806 Kornwestheim, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Landshut','DE','Landshut','Hofmark-Aich-Straße 4, 84030 Landshut, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Leipzig','DE','Leipzig','Hans-Grade-Straße 2, 04158 Leipzig, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Mannheim','DE','Mannheim','Werfthallenstraße 40, 68159 Mannheim, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS München-Riem','DE','München','Hofbräuallee 11, 81829 München, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Regensburg','DE','Regensburg','Robert-Bosch-Straße 12, 93055 Regensburg, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Stuttgart','DE','Stuttgart','Hafenbahnstraße 2a, 70329 Stuttgart, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Ulm','DE','Dornstadt','Albrecht-Berblinger-Straße 2, 89160 Dornstadt, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  ['DUSS Wuppertal','DE','Wuppertal','Jesinghauser Straße 40, 42389 Wuppertal, Germany','https://duss-terminal.deutschebahn.com/duss/terminals_uebersicht'],
  // Italy: Terminali Italia's active intermodal terminal network.
  ['Bagnolo Mella Intermodal','IT','Bagnolo Mella','Bagnolo Mella Intermodal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Bari Ferruccio','IT','Bari','Bari Ferruccio terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Bologna Interporto','IT','Bologna','Bologna Interporto, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Brescia Scalo','IT','Brescia','Brescia Scalo terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Brindisi Scalo','IT','Brindisi','Brindisi Scalo terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Catania Bicocca','IT','Catania','Catania Bicocca terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Livorno Guasticce','IT','Livorno','Livorno Guasticce terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Marghera VINT','IT','Venezia','Marghera VINT terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Marzaglia Intermodal','IT','Modena','Marzaglia intermodal terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Milano Segrate','IT','Segrate','Milano Segrate intermodal terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Parma Castelguelfo','IT','Parma','Parma Castelguelfo terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Torino Orbassano','IT','Torino','Torino Orbassano intermodal terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  ['Verona Quadrante Europa','IT','Verona','Via Sommacampagna 32, 37137 Verona, Italy','https://www.terminaliitalia.it/en/the-terminals/verona-quadrante-europa.html'],
  ['Villa Selva Intermodal','IT','Forlì','Villa Selva intermodal terminal, Italy','https://www.terminaliitalia.it/en/map.html'],
  // Additional Central-European terminals published by METRANS.
  ['METRANS Prague Uhříněves','CZ','Praha','Podleská 926, 104 00 Praha, Czechia','https://www.metrans.eu/'],
  ['METRANS Plzeň-Nýřany','CZ','Nýřany','Pankrác 1228, 330 23 Nýřany, Czechia','https://www.metrans.eu/'],
  ['METRANS Ústí nad Labem','CZ','Ústí nad Labem','Přístavní, 400 07 Ústí nad Labem, Czechia','https://www.metrans.eu/'],
  ['METRANS Česká Třebová','CZ','Česká Třebová','Rybník 276, 560 02 Česká Třebová, Czechia','https://www.metrans.eu/'],
  ['METRANS Zlín','CZ','Želechovice nad Dřevnicí','Lípa 276, 763 11 Želechovice nad Dřevnicí, Czechia','https://www.metrans.eu/'],
  ['METRANS Ostrava-Šenov','CZ','Šenov','Těšínská 222, 739 34 Šenov, Czechia','https://www.metrans.eu/'],
  ['METRANS Dunajská Streda','SK','Dunajská Streda','Povodská cesta 18, 929 01 Dunajská Streda, Slovakia','https://www.metrans.eu/'],
  ['METRANS Košice','SK','Košice','Haniska Interport, 040 66 Košice, Slovakia','https://www.metrans.eu/'],
  ['METRANS Žilina','SK','Teplička nad Váhom','013 01 Teplička nad Váhom, Slovakia','https://www.metrans.eu/'],
  ['METRANS Budapest-Csepel','HU','Budapest','Salak út 1-39, 1211 Budapest, Hungary','https://www.metrans.eu/'],
  ['METRANS Gądki','PL','Gądki','Magazynowa 8, 62-023 Gądki, Poland','https://www.metrans.eu/'],
  ['METRANS Pruszków','PL','Pruszków','Przytorowa 1, 05-800 Pruszków, Poland','https://www.metrans.eu/'],
  ['METRANS Kąty Wrocławskie','PL','Kąty Wrocławskie','Fabryczna 1, 55-080 Kąty Wrocławskie, Poland','https://www.metrans.eu/'],
  ['METRANS Dąbrowa Górnicza','PL','Dąbrowa Górnicza','Koksownicza 6, 42-523 Dąbrowa Górnicza, Poland','https://www.metrans.eu/'],
  ['METRANS Małaszewicze','PL','Małaszewicze Duże','Warszawska 1c, 21-540 Małaszewicze Duże, Poland','https://www.metrans.eu/'],
  ['METRANS Gernsheim','DE','Gernsheim','Am Hafen 2, 64579 Gernsheim, Germany','https://www.metrans.eu/'],
  ['METRANS Rotterdam Maasvlakte','NL','Rotterdam','Rotterdam Maasvlakte intermodal terminal, Netherlands','https://www.metrans.eu/'],
  ['METRANS Rotterdam RSC','NL','Rotterdam','Rotterdam Rail Service Center intermodal terminal, Netherlands','https://www.metrans.eu/'],
  ['METRANS Antwerpen','BE','Antwerpen','Antwerpen intermodal rail terminal, Belgium','https://www.metrans.eu/'],
  ['METRANS Rijeka','HR','Rijeka','Rijeka container terminal, Croatia','https://www.metrans.eu/']
].map(([name,country,city,address,website])=>({name,country,city,address,website,source:country==='SI'?source.SI:country==='AT'?source.AT:country==='DE'&&!name.startsWith('METRANS')?source.DE:country==='IT'?source.IT:['PL','CZ','SK','HU','NL','BE','HR'].includes(country)||name.startsWith('METRANS')?source.METRANS:source.DE}));

// Terminal-area coordinates used when Photon is unavailable. The Wels and Hamburg
// points are terminal-level coordinates; other fallback points are city/industrial-area estimates.
const coordinateOverrides={
  'SI:Koper freight terminal':[13.7500,45.5680],'SI:Ljubljana intermodal terminal':[14.53389,46.06861],'SI:Maribor freight terminal':[15.6500,46.5500],'SI:Sežana freight terminal':[13.8700,45.7100],'SI:Celje freight transshipment station':[15.2700,46.2300],'SI:Novo mesto freight transshipment station':[15.1800,45.8000],
  'AT:Bludenz Container Terminal':[9.8100,47.1500],'AT:Brennersee Terminal':[11.5060,47.0030],'AT:Container Terminal Enns':[14.4800,48.2200],'AT:Terminal Graz Süd':[15.4950,46.9250],'AT:Hall in Tirol Terminal':[11.5000,47.2900],'AT:Montan Terminal Kapfenberg':[15.2900,47.4400],'AT:METRANS Krems Terminal':[15.6000,48.4100],'AT:Linz Stadthafen Container Terminal':[14.2900,48.3000],'AT:Salzburg Liefering Container Terminal':[12.9700,47.7900],'AT:St. Michael Terminal':[14.9000,47.4200],'AT:Villach Terminal':[13.6800,46.5700],'AT:Wels Terminal':[14.073469,48.188764],'AT:Wien Freudenau WienCont':[16.4670,48.1900],'AT:Wien Süd Terminal':[16.3700,48.1700],'AT:Wolfurt Terminal':[9.7500,47.4700],'AT:Wörgl Terminal':[12.0600,47.4900],
  'DE:DUSS Augsburg':[10.9000,48.3700],'DE:DUSS Basel - Weil am Rhein':[7.6100,47.5900],'DE:DUSS Beiseförth':[9.5400,51.0900],'DE:DUSS Berlin Großbeeren':[13.29182,52.36456],'DE:DUSS Duisburg':[6.78466,51.46070],'DE:DUSS Erfurt':[11.0300,50.9800],'DE:DUSS Frankfurt am Main':[8.7100,50.1100],'DE:DUSS Göttingen':[9.9400,51.5300],'DE:DUSS Hamburg-Billwerder':[10.0963039,53.5159437],'DE:DUSS Hannover-Lehrte':[9.9700,52.3700],'DE:DUSS Ingolstadt':[11.4300,48.7700],'DE:DUSS Karlsruhe':[8.4040,49.0060],'DE:DUSS Köln-Eifeltor':[6.93752,50.91591],'DE:DUSS Kornwestheim':[9.1800,48.8600],'DE:DUSS Landshut':[12.1500,48.5400],'DE:DUSS Leipzig':[12.3900,51.3500],'DE:DUSS Mannheim':[8.4700,49.4900],'DE:DUSS München-Riem':[11.69905,48.14571],'DE:DUSS Regensburg':[12.1000,49.0100],'DE:DUSS Stuttgart':[9.1800,48.7700],'DE:DUSS Ulm':[9.9800,48.4000],'DE:DUSS Wuppertal':[7.24790,51.27989],
  'IT:Bagnolo Mella Intermodal':[10.1800,45.4300],'IT:Bari Ferruccio':[16.8700,41.1100],'IT:Bologna Interporto':[11.3300,44.5000],'IT:Brescia Scalo':[10.2200,45.5400],'IT:Brindisi Scalo':[17.9400,40.6300],'IT:Catania Bicocca':[15.0800,37.5100],'IT:Livorno Guasticce':[10.3100,43.5500],'IT:Marghera VINT':[12.2300,45.4600],'IT:Marzaglia Intermodal':[10.9300,44.6600],'IT:Milano Segrate':[9.3000,45.4900],'IT:Parma Castelguelfo':[10.3200,44.8000],'IT:Torino Orbassano':[7.5400,45.0300],'IT:Verona Quadrante Europa':[10.9299572,45.4270468],'IT:Villa Selva Intermodal':[12.0500,44.2200],
  'CZ:METRANS Prague Uhříněves':[14.5900,50.0200],'CZ:METRANS Plzeň-Nýřany':[13.2100,49.7100],'CZ:METRANS Ústí nad Labem':[14.0500,50.6600],'CZ:METRANS Česká Třebová':[16.4400,49.9000],'CZ:METRANS Zlín':[17.7600,49.2200],'CZ:METRANS Ostrava-Šenov':[18.3800,49.7900],
  'SK:METRANS Dunajská Streda':[17.6100,47.9900],'SK:METRANS Košice':[21.2000,48.6300],'SK:METRANS Žilina':[18.7900,49.2200],'HU:METRANS Budapest-Csepel':[19.0700,47.4200],
  'PL:METRANS Gądki':[17.0600,52.3000],'PL:METRANS Pruszków':[20.8000,52.1700],'PL:METRANS Kąty Wrocławskie':[16.7700,51.0400],'PL:METRANS Dąbrowa Górnicza':[19.3000,50.3600],'PL:METRANS Małaszewicze':[23.5200,52.0700],
  'DE:METRANS Gernsheim':[8.4900,49.7500],'NL:METRANS Rotterdam Maasvlakte':[4.1400,51.9500],'NL:METRANS Rotterdam RSC':[4.4200,51.9300],'BE:METRANS Antwerpen':[4.3900,51.2600],'HR:METRANS Rijeka':[14.4300,45.3200]
};
for(const terminal of seeds){const coords=coordinateOverrides[`${terminal.country}:${terminal.name}`];if(coords){terminal.longitude=coords[0];terminal.latitude=coords[1];terminal.coordinateSource='terminal area estimate';}}

const dataFile=path.join(__dirname,'data','intermodal-terminals.json');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function geocode(terminal){
  if(Number.isFinite(terminal.latitude)&&Number.isFinite(terminal.longitude))return true;
  const query=`${terminal.address}, ${terminal.city}, ${terminal.country}`;
  const url=new URL('https://photon.komoot.io/api/');url.searchParams.set('q',query);url.searchParams.set('limit','5');
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetch(url,{headers:{'User-Agent':'RailoptDesktop/1.0 (terminal catalogue import)'},signal:AbortSignal.timeout(7000)});
      if(response.ok){
        const features=(await response.json()).features||[];
        const feature=features.find(item=>String(item.properties?.countrycode||'').toUpperCase()===terminal.country)||features[0];
        const coordinates=feature?.geometry?.coordinates;
        if(Array.isArray(coordinates)&&Number.isFinite(Number(coordinates[0]))&&Number.isFinite(Number(coordinates[1]))){terminal.longitude=Number(coordinates[0]);terminal.latitude=Number(coordinates[1]);terminal.geocodedFrom=query;return true;}
        return false;
      }
      if(response.status!==429&&response.status<500)return false;
    }catch{}
    await delay(1200);
  }
  return false;
}

async function main(){
  fs.mkdirSync(path.dirname(dataFile),{recursive:true});
  let stored=[];try{stored=JSON.parse(fs.readFileSync(dataFile,'utf8'));}catch{}
  const byName=new Map(stored.map(row=>[`${row.country}:${row.name}`,row]));
  const terminals=seeds.map(seed=>byName.get(`${seed.country}:${seed.name}`)||seed);
  let mapped=0;
  for(let i=0;i<terminals.length;i+=3){
    const batch=terminals.slice(i,i+3);
    const results=await Promise.all(batch.map(geocode));
    mapped+=results.filter(Boolean).length;
    results.forEach((ok,index)=>{if(!ok)console.log(`Coordinate search skipped: ${batch[index].name}`);});
    fs.writeFileSync(dataFile,JSON.stringify(terminals.filter(row=>Number.isFinite(row.latitude)&&Number.isFinite(row.longitude)),null,2)+'\n','utf8');
    console.log(`Geocoded ${Math.min(i+batch.length,terminals.length)}/${terminals.length} terminal entries.`);
    if(i+batch.length<terminals.length)await delay(700);
  }
  const located=terminals.filter(row=>Number.isFinite(row.latitude)&&Number.isFinite(row.longitude));
  fs.writeFileSync(dataFile,JSON.stringify(located,null,2)+'\n','utf8');
  const pool=mysql.createPool({host:process.env.MYSQL_HOST||'localhost',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER,password:process.env.MYSQL_PASSWORD,database:process.env.MYSQL_DATABASE||'railopt',connectionLimit:2});
  let inserted=0,existing=0;
  for(const terminal of located){
    const [rows]=await pool.execute('SELECT id FROM terminals WHERE country_code=? AND name=? AND city=? LIMIT 1',[terminal.country,terminal.name,terminal.city]);
    if(rows.length){existing++;continue;}
    const coordinateNote=terminal.coordinateSource==='terminal area estimate'?'Koordinata je ocenjena na območju navedene lokacije; po potrebi potrdi točno rampo pri terminalu.':'Koordinate geokodirane iz naslova/lokacije z OpenStreetMap Photon.';
    const note=`Intermodalni železniški terminal. Seznam: ${terminal.source}. ${coordinateNote}`;
    await pool.execute('INSERT INTO terminals (name,country_code,city,address,latitude,longitude,website,note) VALUES (?,?,?,?,?,?,?,?)',[terminal.name,terminal.country,terminal.city,terminal.address,terminal.latitude,terminal.longitude,terminal.website,note]);
    inserted++;
  }
  const [counts]=await pool.query('SELECT country_code,COUNT(*) AS total FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL GROUP BY country_code ORDER BY country_code');
  console.log(JSON.stringify({geocoded:mapped,available:located.length,inserted,alreadyInDatabase:existing,terminalsByCountry:counts}));
  await pool.end();
}
main().catch(error=>{console.error(`Terminal import failed: ${error.code||error.name}`);process.exitCode=1;});
