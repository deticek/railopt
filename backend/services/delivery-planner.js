const { calculateTrip, resolvePlace } = require('../routes/emissions');
const approximateRoadWarning = 'Usmerjevalnika nista bila dosegljiva; cestna razdalja je približna ocena (zračna razdalja × 1,3, najmanj 1 km, hitrost 65 km/h). Pred uporabo preveri dejansko cestno pot.';

const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;

function localDateTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function addMinutes(date, minutes) { return new Date(date.getTime() + minutes * minuteMs); }
function dateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}
function timeMinutes(date) { return date.getHours() * 60 + date.getMinutes(); }
function dateAtMinutes(date, minutes) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  result.setMinutes(minutes);
  return result;
}
function toIso(date) { return date.toISOString(); }
function parameterValue(params, code, fallback) {
  const row = params.get(code);
  if (!row) return fallback;
  if (code.startsWith('emisije_iso_14083_')) {
    const text = Number(row.text_value);
    if (Number.isFinite(text) && text > 0 && text < 1) return text;
  }
  const value = Number(row.numeric_value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
function parameterPair(params, code, fallbackFixed, fallbackPerUnit) {
  const row = params.get(code);
  return {
    fixed: Number.isFinite(Number(row?.fixed_value)) ? Number(row.fixed_value) : fallbackFixed,
    perUnit: Number.isFinite(Number(row?.per_unit_value)) ? Number(row.per_unit_value) : fallbackPerUnit
  };
}
function loadDurations(params) {
  const source = params.get('cesta_cas_naklada_in_razklada')?.text_value || '';
  const load = source.match(/naklad\s+(\d+(?:[,.]\d+)?)/i);
  const unload = source.match(/razklad\s+(\d+(?:[,.]\d+)?)/i);
  return { loadHours: load ? Number(load[1].replace(',','.')) : 1.5, unloadHours: unload ? Number(unload[1].replace(',','.')) : 1 };
}
function event(type, title, start, end, extra = {}) {
  return { type, title, start: toIso(start), end: toIso(end), durationMinutes: Math.max(0, Math.round((end-start)/minuteMs)), ...extra };
}
function nextBusinessDay(date, startMinutes, holidays) {
  let candidate = new Date(date);
  candidate.setDate(candidate.getDate() + 1);
  candidate = dateAtMinutes(candidate, startMinutes);
  for (let guard=0; guard<370; guard++) {
    const weekday = candidate.getDay();
    if (weekday >= 1 && weekday <= 5 && !holidays.has(dateKey(candidate))) return candidate;
    candidate = addMinutes(candidate, 24 * 60);
  }
  throw new Error('V izbranem obdobju ni mogoče najti naslednjega delovnega dne.');
}
function isBusinessDay(date, holidays) {
  const weekday = date.getDay();
  return weekday >= 1 && weekday <= 5 && !holidays.has(dateKey(date));
}
function addBusinessDays(date, count, holidays) {
  const result=new Date(date);let added=0;
  while(added<count){result.setDate(result.getDate()+1);if(isBusinessDay(result,holidays))added++;}
  return result;
}
function normalizeLoading(requested, windowStart, windowEnd, durationMinutes, holidays) {
  const startMinutes = parseClock(windowStart);
  const endMinutes = parseClock(windowEnd);
  const windowStartAt = dateAtMinutes(requested, startMinutes);
  let start = new Date(requested);
  let reason = null;
  if (!isBusinessDay(start, holidays)) {
    start = nextBusinessDay(start, startMinutes, holidays);
    reason = 'Izbrani dan ni delovni dan v državi naklada; naklad je prestavljen.';
  } else if (timeMinutes(start) < startMinutes) {
    start = windowStartAt;
    reason = 'Ura je pred oknom naklada; naklad se začne ob začetku okna.';
  } else if (timeMinutes(start) + durationMinutes > endMinutes) {
    start = nextBusinessDay(start, startMinutes, holidays);
    reason = 'Za naklad ni dovolj časa do konca okna; prestavljen je na naslednji delovni dan.';
  }
  return { start, end: addMinutes(start, durationMinutes), reason };
}
function parseClock(value) {
  if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) throw new Error('Ura mora biti v obliki HH:MM.');
  const [hours, minutes] = value.split(':').map(Number);
  if (hours > 23 || minutes > 59) throw new Error('Vnesena ura ni veljavna.');
  return hours * 60 + minutes;
}
function weekendBlocked(date) {
  const day = date.getDay();
  const minute = timeMinutes(date);
  return day === 6 || day === 0 || (day === 1 && minute < 360);
}
function endOfFriday(date) {
  const daysUntilFriday = (5 - date.getDay() + 7) % 7;
  const friday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysUntilFriday, 0, 0, 0, 0);
  return addMinutes(friday, 24 * 60);
}
function nextMondayMorning(date) {
  const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + daysUntilMonday, 6, 0, 0, 0);
  if (date.getDay() === 1 && timeMinutes(date) < 360) return dateAtMinutes(date, 360);
  return monday;
}
function simulateDrive(departure, route, { weekendBan = true, breakAfterHours = 4.5, breakMinutes = 45, maxDailyHours = 9, dailyRestHours = 11, extraTimeMinutes = 0 } = {}) {
  const distanceKm = Number(route?.distanceKm);
  const durationHours = Number(route?.durationHours);
  const averageSpeedKmh = distanceKm / durationHours;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0 || !Number.isFinite(durationHours) || durationHours <= 0) throw new Error('Cestna pot nima veljavne ocene trajanja.');
  let current = new Date(departure);
  let remainingHours = durationHours;
  let remainingKm = distanceKm;
  let sinceBreakHours = 0;
  let todayHours = 0;
  let driveCount = 0;
  let breakCount = 0;
  let dailyRestCount = 0;
  let weekendWaitCount = 0;
  const events = [];
  for (let guard=0; remainingKm > 0.01 && guard<500; guard++) {
    if (weekendBan && weekendBlocked(current)) {
      const resume = nextMondayMorning(current);
      events.push(event('weekend-rest', 'Vikendni premor po Excelovem scenariju', current, resume));
      current = resume;
      sinceBreakHours = 0;
      todayHours = 0;
      weekendWaitCount++;
      continue;
    }
    if (todayHours >= maxDailyHours - 1e-7) {
      const end = new Date(current.getTime() + dailyRestHours * hourMs);
      events.push(event('daily-rest', `Dnevni počitek (${dailyRestHours} h)`, current, end));
      current = end;
      sinceBreakHours = 0;
      todayHours = 0;
      dailyRestCount++;
      continue;
    }
    if (sinceBreakHours >= breakAfterHours - 1e-7) {
      const end = addMinutes(current, breakMinutes);
      events.push(event('break', `Odmor (${breakMinutes} min)`, current, end));
      current = end;
      sinceBreakHours = 0;
      breakCount++;
      continue;
    }
    let driveHours = Math.min(breakAfterHours-sinceBreakHours, maxDailyHours-todayHours, remainingHours);
    if (weekendBan && current.getDay() === 5) {
      const untilSaturday = (endOfFriday(current)-current)/hourMs;
      driveHours = Math.min(driveHours, untilSaturday);
    }
    if (driveHours <= 1e-8) continue;
    const actualHours = driveHours;
    const km = Math.min(remainingKm, driveHours * averageSpeedKmh);
    const end = new Date(current.getTime()+actualHours*hourMs);
    driveCount++;
    events.push(event('drive', `Vožnja ${driveCount}`, current, end, { distanceKm: Math.round(km*10)/10 }));
    current=end;
    remainingKm-=km;
    remainingHours-=actualHours;
    sinceBreakHours+=actualHours;
    todayHours+=actualHours;
  }
  if (remainingKm > 0.01 || remainingHours > 0.01) throw new Error('Načrt poti je presegel varno število voznih odsekov.');
  if (extraTimeMinutes > 0) {
    const end = addMinutes(current, extraTimeMinutes);
    events.push(event('waiting', 'Dodatni čas na poti', current, end));
    current = end;
  }
  return { arrival: current, events, drivingHours: durationHours, breakCount, dailyRestCount, weekendWaitCount, averageSpeedKmh };
}
function planUnload(arrival, windowStart, windowEnd, durationMinutes, holidays) {
  const startMinutes=parseClock(windowStart); const endMinutes=parseClock(windowEnd);
  let start=new Date(arrival); let waited=false;
  for(let guard=0;guard<370;guard++) {
    if(!isBusinessDay(start,holidays)) { start=nextBusinessDay(start,startMinutes,holidays); waited=true; continue; }
    if(timeMinutes(start)<startMinutes) { start=dateAtMinutes(start,startMinutes); waited=true; }
    if(timeMinutes(start)+durationMinutes<=endMinutes) return { start, end:addMinutes(start,durationMinutes), waited };
    start=nextBusinessDay(start,startMinutes,holidays); waited=true;
  }
  throw new Error('V izbranem obdobju ni mogoče najti delovnega okna za razklad.');
}
function validatePlace(place, label) {
  const value=typeof place==='string'?{label:place}:place;
  const name=String(value?.label||'').trim();
  if(name.length<2||name.length>500) throw new Error(`Vnesi naslov ali kraj za ${label}.`);
  const lat=value?.lat===null||value?.lat===undefined?null:Number(value.lat);
  const lon=value?.lon===null||value?.lon===undefined?null:Number(value.lon);
  if((lat===null)!==(lon===null)||lat!==null&&(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180)) throw new Error(`Lokacija ${label} ni veljavna.`);
  const countryCode=String(value?.countryCode||'').trim().toUpperCase();
  const state=String(value?.state||'').trim().slice(0,120);
  return { label:name,lat,lon,countryCode:/^[A-Z]{2}$/.test(countryCode)?countryCode:null,state:state||null };
}
function detailedCosts(input, route, durations, schedule, baseCosts, adrFee) {
  const fields=['fuelPricePerLitre','fuelConsumptionLPer100Km','driverCostPerHour','tollsEur','customsEur','otherVehicleEur'];
  const values={};
  for(const field of fields) values[field]=Number(input.costs?.[field] ?? (field==='tollsEur'||field==='customsEur'||field==='otherVehicleEur'?0:NaN));
  if(!Number.isFinite(values.fuelPricePerLitre)||values.fuelPricePerLitre<=0||values.fuelPricePerLitre>10||!Number.isFinite(values.fuelConsumptionLPer100Km)||values.fuelConsumptionLPer100Km<=0||values.fuelConsumptionLPer100Km>100||!Number.isFinite(values.driverCostPerHour)||values.driverCostPerHour<0||values.driverCostPerHour>1000) throw new Error('Za podroben strošek vnesi ceno goriva, porabo in strošek voznika na uro.');
  for(const field of ['tollsEur','customsEur','otherVehicleEur']) if(!Number.isFinite(values[field])||values[field]<0||values[field]>1000000) throw new Error('Dodatni stroški morajo biti pozitivna števila.');
  const fuelLitres=route.distanceKm*values.fuelConsumptionLPer100Km/100;
  const fuelEur=fuelLitres*values.fuelPricePerLitre;
  const elapsedHours=(schedule.deliveryAt-schedule.loading.start)/hourMs;
  const driverEur=elapsedHours*values.driverCostPerHour;
  const total=fuelEur+driverEur+values.tollsEur+values.customsEur+values.otherVehicleEur+(input.adr?adrFee:0);
  return { mode:'detailed',totalEur:round2(total),fuelLitres:round2(fuelLitres),fuelEur:round2(fuelEur),driverPaidHours:round2(elapsedHours),driverEur:round2(driverEur),tollsEur:round2(values.tollsEur),customsEur:round2(values.customsEur),otherVehicleEur:round2(values.otherVehicleEur),adrEur:input.adr?adrFee:0,assumption:'Plačljive ure voznika so od začetka naklada do konca razklada in vključujejo odmore, počitek ter čakanje.' };
}
function round2(value) { return Math.round((value+Number.EPSILON)*100)/100; }

async function estimateDeliveryPlan(input, { pool, params }) {
  const origin=validatePlace(input.origin,'naklad'); const destination=validatePlace(input.destination,'razklad');
  if(origin.label.toLocaleLowerCase('sl')===destination.label.toLocaleLowerCase('sl')&&origin.lat===destination.lat&&origin.lon===destination.lon) throw new Error('Naklad in razklad morata biti različna.');
  const weightKg=Number(input.weightKg);
  const unitType=String(input.unitType||'').trim();
  if(!Number.isFinite(weightKg)||weightKg<=0||weightKg>24000||!unitType||unitType.length>100) throw new Error('Teža mora biti med 1 in 24.000 kg, vrsta enote pa izbrana.');
  const lowerUnit=unitType.toLocaleLowerCase('sl');
  if(lowerUnit.includes('zabojnik 45')&&weightKg>22000) throw new Error('Za zabojnik 45′ je največja teža tovora 22.000 kg.');
  if(lowerUnit.includes('izmenljivi zaboj')&&weightKg>23000) throw new Error('Za izmenljivi zaboj je največja teža tovora 23.000 kg.');
  const loadingAt=localDateTime(input.loadingAt); const deadlineAt=localDateTime(input.deliveryDeadlineAt);
  if(!loadingAt||!deadlineAt||deadlineAt<=loadingAt) throw new Error('Vnesi veljaven termin naklada in poznejši rok dostave.');
  const loadStart=input.loadingWindowStart||'07:00'; const loadEnd=input.loadingWindowEnd||'11:00';
  const unloadStart=input.unloadingWindowStart||'07:00'; const unloadEnd=input.unloadingWindowEnd||'15:00';
  const duration=loadDurations(params);
  const loadDurationMinutes=Math.round(duration.loadHours*60); const unloadDurationMinutes=Math.round(duration.unloadHours*60);
  if(parseClock(loadStart)>=parseClock(loadEnd)||parseClock(unloadStart)>=parseClock(unloadEnd)||parseClock(loadStart)+loadDurationMinutes>parseClock(loadEnd)||parseClock(unloadStart)+unloadDurationMinutes>parseClock(unloadEnd)) throw new Error('Okni naklada/razklada morata biti veljavni in dovolj dolgi za opravilo.');
  const extraTimeMinutes=Number(input.extraTimeMinutes??0);
  if(!Number.isInteger(extraTimeMinutes)||extraTimeMinutes<0||extraTimeMinutes>720) throw new Error('Dodatni čas mora biti med 0 in 720 minutami.');
  // A timetable/router is not available in the source data; keep a fixed model speed
  // so users get an automatic duration estimate without having to guess it.
  const trainSpeed=60;
  const breakAfter=parameterValue(params,'cesta_pravila_voznje',4.5);
  const roadCosts=parameterPair(params,'cesta_cena_na_posiljko',250,1.3);
  const adrFee=parameterValue(params,'cesta_doplacilo_za_nevarno_blago_adr',50);
  const emissionFactor=parameterValue(params,'emisije_iso_14083_cesta_ter_dovoz_in_odvoz',0.095);
  const placeRegions=[origin,destination].filter(place=>place.countryCode);
  const years=new Set([loadingAt.getFullYear(),deadlineAt.getFullYear()]);
  const holidayResults=await Promise.all(placeRegions.map(async place=>({country:place.countryCode,region:place.state,...await holidaysForRange(pool,place.countryCode,years,place.state,dateKey(loadingAt),dateKey(deadlineAt))})));
  const holidayFor=place=>holidayResults.find(row=>row.country===place.countryCode&&row.region===place.state);
  const originHolidays=new Set(holidayFor(origin)?.dates||[]);
  const destinationHolidays=new Set(holidayFor(destination)?.dates||[]);
  const loading=normalizeLoading(loadingAt,loadStart,loadEnd,loadDurationMinutes,originHolidays);
  const departure=loading.end;
  const originResolved=origin.lat===null?await resolvePlace(origin.label,'kraja A',()=>{}):origin;
  const destinationResolved=destination.lat===null?await resolvePlace(destination.label,'kraja B',()=>{}):destination;
  const routeInput=place=>`${Number(place.lat).toFixed(6)}, ${Number(place.lon).toFixed(6)}`;
  const road=await calculateTrip(await routeInput(originResolved),await routeInput(destinationResolved),weightKg);
  const weekendBan=input.weekendBan!==false;
  const drive=simulateDrive(departure,road,{weekendBan,breakAfterHours:breakAfter,breakMinutes:45,maxDailyHours:9,dailyRestHours:11,extraTimeMinutes});
  const unloading=planUnload(drive.arrival,unloadStart,unloadEnd,unloadDurationMinutes,destinationHolidays);
  const timeline=[
    event('loading','Naklad',loading.start,loading.end),
    ...drive.events,
    ...(unloading.waited&&unloading.start>drive.arrival?[event('waiting','Čakanje na delovno okno razklada',drive.arrival,unloading.start)]:[]),
    event('unloading','Razklad',unloading.start,unloading.end)
  ];
  const customsEur=Number(input.costs?.customsEur||0);
  if(!Number.isFinite(customsEur)||customsEur<0||customsEur>1000000) throw new Error('Carinski strošek mora biti nenegativno število.');
  const excelBase=roadCosts.fixed+roadCosts.perUnit*road.distanceKm+(input.adr?adrFee:0);
  const cost=input.costMode==='detailed'
    ? detailedCosts(input,road,duration,{...drive,loading,deliveryAt:unloading.end},roadCosts,adrFee)
    : {mode:'excel',totalEur:round2(excelBase+customsEur),excelBaseEur:round2(excelBase),fixedEur:roadCosts.fixed,perKmEur:roadCosts.perUnit,adrEur:input.adr?adrFee:0,customsEur,includes:'Gorivo, cestnine, voznik in vozilo so združeni v Excelovem parametru; ločena razčlenitev ni na voljo.'};
  const tonKilometers=weightKg/1000*road.distanceKm;
  const deliveryAt=unloading.end;
  const delayMinutes=Math.max(0,Math.round((deliveryAt-deadlineAt)/minuteMs));
  const directEmissions=round2(tonKilometers*emissionFactor);
  const roadOption={id:'road',title:'Samo tovornjak',mode:'road',distanceKm:road.distanceKm,roadKm:road.distanceKm,railKm:0,cost,emissionsKgCo2e:directEmissions,deliveryAt:toIso(deliveryAt),totalElapsedHours:round2((deliveryAt-loading.start)/hourMs),drivingHours:round2(drive.drivingHours),breakCount:drive.breakCount,dailyRestCount:drive.dailyRestCount,onTime:deliveryAt<=deadlineAt,feasible:deliveryAt<=deadlineAt,timeline,warnings:road.approximate?[approximateRoadWarning]:[]};
  const options=[roadOption];
  let comparisonNotice=null;
  let railRoadsApproximate=false;
  const compareRequested=input.transportMode==='compare';
  const liftable=/p400|izmenljivi zaboj|zabojnik 45/.test(lowerUnit);
  const roLa=/nedvigljiv|ponjav|tovornjak/.test(lowerUnit);
  const hasTerminal=(place)=>{
    const label=String(place?.label||'').trim();
    const lat=place?.lat===null||place?.lat===undefined?NaN:Number(place.lat);
    const lon=place?.lon===null||place?.lon===undefined?NaN:Number(place.lon);
    return label.length>=2&&label.length<=500&&Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180;
  };
  const terminalOrigin=hasTerminal(input.terminalOrigin)?validatePlace(input.terminalOrigin,'odhodni terminal'):null;
  const terminalDestination=hasTerminal(input.terminalDestination)?validatePlace(input.terminalDestination,'prihodni terminal'):null;
  if(!liftable&&!roLa){
    comparisonNotice='Za izbrano vrsto enote ni mogoče izračunati kombiniranega prevoza.';
    if(compareRequested)throw new Error('Za to enoto preveri, ali je dvigljiva; P400, izmenljivi zaboj in zabojnik 45′ so dvigljivi.');
  }else if(!terminalOrigin||!terminalDestination){
    comparisonNotice='Kombinirana možnost z vlakom ni na voljo, ker ni mogoče določiti obeh tovornih terminalov.';
    if(compareRequested)throw new Error('Za primerjavo izberi odhodni in prihodni železniški terminal na zemljevidu.');
  }else{
    const roLaTicket=Number(input.roLaTicketEur??0);
    if(!Number.isFinite(roLaTicket)||roLaTicket<0||roLaTicket>1000000)throw new Error('Cena vozovnice Ro-La mora biti med 0 in 1.000.000 €.');
    const [toTerminal,betweenTerminals,fromTerminal]=await Promise.all([
      calculateTrip(routeInput(origin),routeInput(terminalOrigin),weightKg),
      calculateTrip(routeInput(terminalOrigin),routeInput(terminalDestination),weightKg),
      calculateTrip(routeInput(terminalDestination),routeInput(destination),weightKg)
    ]);
    railRoadsApproximate=toTerminal.approximate||betweenTerminals.approximate||fromTerminal.approximate;
    const firstDrive=simulateDrive(departure,toTerminal,{weekendBan,breakAfterHours:breakAfter,breakMinutes:45,maxDailyHours:9,dailyRestHours:11,extraTimeMinutes});
    const handlingText=params.get('kombinirani_prevoz_oddaja_in_prevzem_enote_na_terminalu')?.text_value||'';
    const pickupMatch=handlingText.match(/prevzem\s+(\d+(?:[,.]\d+)?)/i);
    const dropHours=parameterValue(params,'kombinirani_prevoz_oddaja_in_prevzem_enote_na_terminalu',0.5);
    const pickupHours=pickupMatch?Number(pickupMatch[1].replace(',','.')):1;
    const terminalDropEnd=addMinutes(firstDrive.arrival,dropHours*60);
    const reserveEnd=addMinutes(terminalDropEnd,parameterValue(params,'kombinirani_prevoz_rezerva_za_zamudo_vlaka',3)*60);
    const railDistanceKm=betweenTerminals.distanceKm*parameterValue(params,'kombinirani_prevoz_dolzina_zelezniske_poti',1.1);
    const trainEnd=addMinutes(reserveEnd,railDistanceKm/trainSpeed*60);
    const terminalPickupEnd=addMinutes(trainEnd,pickupHours*60);
    const lastDrive=simulateDrive(terminalPickupEnd,fromTerminal,{weekendBan,breakAfterHours:breakAfter,breakMinutes:45,maxDailyHours:9,dailyRestHours:11});
    const railUnload=planUnload(lastDrive.arrival,unloadStart,unloadEnd,unloadDurationMinutes,destinationHolidays);
    const railDeliveryAt=railUnload.end;
    const accessRoadKm=toTerminal.distanceKm+fromTerminal.distanceKm;
    const railKm=railDistanceKm;
    const railFactor=roLa?parameterValue(params,'emisije_iso_14083_ro_la_tovornjak_na_vlaku',0.015):parameterValue(params,'emisije_iso_14083_vlak_elektrovleka',0.01);
    const railEmissions=round2((weightKg/1000)*(accessRoadKm*emissionFactor+railKm*railFactor));
    const pickupCosts=parameterPair(params,'kombinirani_prevoz_dovoz_ali_odvoz',150,1.8);
    const railCosts=parameterPair(params,'kombinirani_prevoz_vlak',280,0.5);
    const ridFee=parameterValue(params,'kombinirani_prevoz_doplacilo_za_nevarno_blago_rid',75);
    const liftFee=parameterValue(params,'kombinirani_prevoz_pretovor_na_terminalu',35);
    const liftPremium=parameterValue(params,'kombinirani_prevoz_pribitek_za_dvigljivo_enoto',90);
    const accessRoadCost=2*pickupCosts.fixed+pickupCosts.perUnit*accessRoadKm;
    const railTariff=roLa?(roLaTicket>0?roLaTicket:null):(railCosts.fixed+railCosts.perUnit*railKm+2*liftFee+liftPremium);
    const excelRailCost=railTariff===null?null:round2(accessRoadCost+railTariff+(input.adr?ridFee:0)+customsEur);
    let railCost;
    if(input.costMode==='detailed'){
      const roadHours=((firstDrive.arrival-departure)+(lastDrive.arrival-terminalPickupEnd))/hourMs;
      const detail=detailedCosts(input,{distanceKm:accessRoadKm},duration,{loading:{start:departure},deliveryAt:new Date(departure.getTime()+roadHours*hourMs)},roadCosts,adrFee);
      railCost={...detail,mode:'combined',railTicketEur:railTariff,accessRoadEur:round2(detail.totalEur-detail.customsEur-detail.adrEur),terminalAndRailEur:railTariff===null?null:round2(railTariff+(input.adr?ridFee:0)),totalEur:railTariff===null?null:round2(detail.totalEur+railTariff+(input.adr?ridFee:0)),quoteRequired:railTariff===null};
    }else railCost={mode:'excel',totalEur:excelRailCost,accessRoadEur:round2(accessRoadCost),railTicketEur:railTariff,terminalLiftEur:roLa?0:2*liftFee,liftableUnitPremiumEur:roLa?0:liftPremium,ridEur:input.adr?ridFee:0,customsEur,quoteRequired:railTariff===null,includes:roLa?'Za Ro-La vnesi ceno vozovnice; Excel podaja javni cenik brez zneska.':'Dovoz/odvoz, vlak, pretovor in pribitek za dvigljivo enoto po Excelovih parametrih.'};
    const withinTwoWorkDays=railDeliveryAt<=addBusinessDays(deliveryAt,2,destinationHolidays);
    const onTime=railDeliveryAt<=deadlineAt;
    const railTimeline=[event('loading','Naklad',loading.start,loading.end),...firstDrive.events,event('terminal','Oddaja enote na terminalu',firstDrive.arrival,terminalDropEnd),event('waiting','Časovna rezerva za vlak (Excel)',terminalDropEnd,reserveEnd),event('train',roLa?'Vožnja Ro-La – ocena':'Vožnja vlaka – ocena',reserveEnd,trainEnd,{distanceKm:Math.round(railKm*10)/10}),event('terminal','Prevzem enote na terminalu',trainEnd,terminalPickupEnd),...lastDrive.events,...(railUnload.waited&&railUnload.start>lastDrive.arrival?[event('waiting','Čakanje na delovno okno razklada',lastDrive.arrival,railUnload.start)]:[]),event('unloading','Razklad',railUnload.start,railUnload.end)];
    const railWarnings=['Čas vlaka je samodejna približna ocena na podlagi razdalje in modelne povprečne hitrosti 60 km/h; dejanskega voznega reda in odhodov ni v podatkovni bazi. Terminala sta samodejno predlagana po podatkih OpenStreetMap in ju je treba pred rezervacijo potrditi pri prevozniku.','Čas cestnih odsekov temelji na usmerjevalniku za osebna vozila; preverjene omejitve za tovornjake, promet v živo in prepovedi na posameznih cestah niso na voljo.'];
    if(railRoadsApproximate)railWarnings.push(approximateRoadWarning);
    if(roLa&&railTariff===null)railWarnings.push('Za cenovno primerjavo Ro-La vnesi ceno vozovnice prevoznika.');
    if(!withinTwoWorkDays)railWarnings.push('Možnost presega Excelovo mejo dveh delovnih dni za zamudo za cestno dostavo.');
    if(!onTime)railWarnings.push('Možnost prispe po roku dostave.');
    options.push({id:roLa?'rola':'rail',title:roLa?'Ro-La (tovornjak na vlaku)':'Kombinirani prevoz z vlakom',mode:roLa?'rola':'rail',originTerminal:terminalOrigin.label,destinationTerminal:terminalDestination.label,distanceKm:accessRoadKm+railKm,roadKm:round2(accessRoadKm),railKm:round2(railKm),cost:railCost,emissionsKgCo2e:railEmissions,deliveryAt:toIso(railDeliveryAt),totalElapsedHours:round2((railDeliveryAt-loading.start)/hourMs),drivingHours:round2(firstDrive.drivingHours+lastDrive.drivingHours),breakCount:firstDrive.breakCount+lastDrive.breakCount,dailyRestCount:firstDrive.dailyRestCount+lastDrive.dailyRestCount,onTime,withinTwoWorkDays,feasible:onTime&&withinTwoWorkDays,timeline:railTimeline,warnings:railWarnings});
  }
  const preference=['cost','emissions','time'].includes(input.preference)?input.preference:'cost';
  const eligible=options.filter(option=>option.feasible&&!(preference==='cost'&&option.cost.totalEur===null));
  const fallback=options.filter(option=>preference!=='cost'||option.cost.totalEur!==null);
  const comparator=preference==='cost'?(a,b)=>a.cost.totalEur-b.cost.totalEur:preference==='emissions'?(a,b)=>a.emissionsKgCo2e-b.emissionsKgCo2e:(a,b)=>new Date(a.deliveryAt)-new Date(b.deliveryAt);
  const recommended=eligible.sort(comparator)[0]||null;
  for(const option of options)option.isRecommended=Boolean(recommended&&option.id===recommended.id);
  const warnings=[];
  if(road.approximate||railRoadsApproximate) warnings.push(approximateRoadWarning);
  if(loading.reason) warnings.push(loading.reason);
  if(placeRegions.length<2) warnings.push('Za eno ali obe lokaciji ni znane države; lokalnih praznikov tam ni mogoče preveriti.');
  if(holidayResults.some(row=>row.source==='excel-fallback')) warnings.push('Uporabljen je lokalni seznam praznikov iz Excelove baze; morda ni popoln za izbrano leto.');
  if(holidayResults.some(row=>row.regionalExcluded)) warnings.push('Za izbrano državo obstaja regionalni praznik v lokalni bazi, vendar ponudnik lokacije ni vrnil regije; tega praznika ni bilo mogoče zanesljivo upoštevati.');
  warnings.push('Trajanje cestnih odsekov oceni usmerjevalnik za osebna vozila. Preverjene omejitve za tovornjake, promet v živo ter omejitve višine in mase niso na voljo; pred prevozom preveri pot.');
  warnings.push('Vikend-prepoved od petka 24:00 do ponedeljka 06:00 je predpostavka Excelovega izziva, ne splošna prepoved za vse države.');
  return {
    origin:{...originResolved,label:origin.label,countryCode:origin.countryCode||originResolved.countryCode||null},
    destination:{...destinationResolved,label:destination.label,countryCode:destination.countryCode||destinationResolved.countryCode||null},
    distanceKm:road.distanceKm,weightKg,unitType,adr:Boolean(input.adr),averageSpeedKmh:round2(drive.averageSpeedKmh),extraTimeMinutes,trainSpeedKmh:trainSpeed,transportMode:input.transportMode||'road',preference,recommendedOptionId:recommended?.id||null,noFeasibleOption:!recommended,options,comparisonNotice,tonKilometers:round2(tonKilometers),
    factorKgCo2ePerTkm:emissionFactor,emissionsKgCo2e:round2(tonKilometers*emissionFactor),
    requestedLoadingAt:toIso(loadingAt),actualLoadingAt:toIso(loading.start),loadingCompleteAt:toIso(loading.end),departureAt:toIso(departure),roadArrivalAt:toIso(drive.arrival),unloadingAt:toIso(unloading.start),deliveryAt:toIso(deliveryAt),deadlineAt:toIso(deadlineAt),onTime:deliveryAt<=deadlineAt,delayMinutes,
    loadingWindow:{start:loadStart,end:loadEnd},unloadingWindow:{start:unloadStart,end:unloadEnd},loadHours:duration.loadHours,unloadHours:duration.unloadHours,
    drivingHours:round2(drive.drivingHours),breakCount:drive.breakCount,dailyRestCount:drive.dailyRestCount,weekendWaitCount:drive.weekendWaitCount,weekendBan,
    totalElapsedHours:round2((deliveryAt-loading.start)/hourMs),cost,timeline,
    holidaySources:holidayResults.map(row=>({countryCode:row.country,region:row.region,source:row.source,holidayCount:row.dates.length})),warnings,
    roadRouteEstimated:Boolean(road.approximate||railRoadsApproximate),roadAttribution:'© OpenStreetMap contributors',costSource:'TIM_Hekaton_2026_podatki_v2.xlsx'
  };
}

const holidayCache=new Map();
function normalizedRegion(value) { return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('sl').trim(); }
function regionalHolidayMatches(note,region) {
  if(!region)return false;
  const area=String(note||'').replace(/^regionalno\s*:\s*/i,'');
  const regionKey=normalizedRegion(region);
  const aliases={
    'posarje':['posarje','saarland'],
    'bavarske':['bavarske','bavaria','bayern']
  };
  return Object.values(aliases).some(group=>group.some(term=>normalizedRegion(term)===regionKey&&group.some(alias=>normalizedRegion(area).includes(normalizedRegion(alias))))) || normalizedRegion(area).includes(regionKey);
}
async function holidaysForRange(pool,country,years,region=null,rangeStart=null,rangeEnd=null) {
  const dates=new Set(); let source='excel-fallback';
  const period=`${rangeStart||''}-${rangeEnd||''}`;
  for(const year of years) {
    const key=`${country}-${year}-${normalizedRegion(region)}-${period}`; const cached=holidayCache.get(key);
    if(cached&&cached.expiresAt>Date.now()) { cached.dates.forEach(date=>dates.add(date)); source=cached.source; continue; }
    const [localRows]=await pool.execute("SELECT DATE_FORMAT(holiday_date,'%Y-%m-%d') AS holiday_date,note FROM holidays WHERE country_code=? AND YEAR(holiday_date)=?",[country,year]);
    const regionalRows=localRows.filter(row=>String(row.note||'').toLocaleLowerCase('sl').startsWith('regionalno'));
    const applicableRows=localRows.filter(row=>!String(row.note||'').toLocaleLowerCase('sl').startsWith('regionalno')||regionalHolidayMatches(row.note,region));
    const regionalExcluded=regionalRows.some(row=>(!rangeStart||row.holiday_date>=rangeStart)&&(!rangeEnd||row.holiday_date<=rangeEnd))&&!region;
    const localDates=applicableRows.map(row=>row.holiday_date);
    let yearDates=localDates; let yearSource='excel-fallback';
    try {
      const response=await fetch(`https://nagerholidays.com/api/v4/Holidays/${encodeURIComponent(country)}/${year}`,{headers:{'User-Agent':'RailoptDesktop/1.0 (public-holiday lookup)'},signal:AbortSignal.timeout(6000)});
      if(response.ok) {
        const payload=await response.json();
        const national=Array.isArray(payload)?payload.filter(row=>row.nationalHoliday===true&&/^\d{4}-\d{2}-\d{2}$/.test(row.date)):[];
        const known=new Set(localRows.map(row=>row.holiday_date));
        for(const holiday of national) if(!known.has(holiday.date)) {
          await pool.execute('INSERT INTO holidays (country_code,holiday_date,holiday_name,note) VALUES (?,?,?,?)',[country,holiday.date,String(holiday.name||'Praznik').slice(0,200),'Uvoz iz Nager.Date API v4']);
        }
        yearDates=[...new Set([...localDates,...national.map(row=>row.date)])];
        yearSource='Nager.Date API v4 + Excel baza';
      }
    } catch { /* Use the locally imported holiday list when the public calendar is unavailable. */ }
    holidayCache.set(key,{dates:yearDates,source:yearSource,regionalExcluded,expiresAt:Date.now()+30*24*60*60*1000});
    yearDates.forEach(date=>dates.add(date)); source=yearSource;
  }
  const regionalExcluded=[...years].some(year=>holidayCache.get(`${country}-${year}-${normalizedRegion(region)}-${period}`)?.regionalExcluded);
  return {dates:[...dates],source,regionalExcluded};
}

module.exports={estimateDeliveryPlan,simulateDrive,normalizeLoading,planUnload,holidaysForRange};
