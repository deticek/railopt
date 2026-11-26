const express = require("express");
const {readJson}=require('../lib/parameter-store');

function placeFromFeature(feature) {
  const p = feature?.properties || {};
  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const unique = (values) => [
    ...new Set(
      values.map((value) => String(value || "").trim()).filter(Boolean),
    ),
  ];
  const street = [p.housenumber, p.street].filter(Boolean).join(" ");
  const city = p.city || p.town || p.village || p.locality || p.name;
  const label = unique([
    p.name,
    street,
    p.postcode,
    city,
    p.state,
    p.country,
  ]).join(", ");
  return {
    label: label || "Izbrana lokacija",
    lat: Number(coords[1]),
    lon: Number(coords[0]),
    countryCode:
      String(p.countrycode || p.country_code || "").toUpperCase() || null,
    street: street || null,
    postcode: p.postcode || null,
    city: city || null,
    state: p.state || null,
    country: p.country || null,
  };
}
function createPlacesRouter({ pool, requireSession, asyncRoute }) {
  const router = express.Router();
  const cache = new Map();
  let lastRequest = 0;
  let queue = Promise.resolve();
  const endpoint = () =>
    process.env.GEOCODER_URL || "https://photon.komoot.io/api/";
  async function unitTerminalRows(type){
    try{const [rows]=await pool.execute("SELECT id,name,country_code,city,address,latitude,longitude,NULL AS website FROM unit_terminals WHERE unit_type=? AND active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL",[type]);return rows;}
    catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const rows=await readJson(pool,'app_unit_terminals_catalog')||[];return rows.filter(row=>row.unitType===type&&row.active!==false&&row.latitude!=null&&row.longitude!=null).map(row=>({id:row.id,name:row.name,country_code:row.countryCode,city:row.city,address:row.address,latitude:row.latitude,longitude:row.longitude,website:null}));}
  }
  async function request(url) {
    const task = queue.then(async () => {
      const wait = Math.max(0, 700 - (Date.now() - lastRequest));
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
      lastRequest = Date.now();
      const response = await fetch(url, {
        headers: { "User-Agent": "RailoptDesktop/1.0 (place search)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok)
        throw new Error("Iskanje lokacij trenutno ni dosegljivo.");
      return response.json();
    });
    queue = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }
  router.post(
    "/places/search",
    requireSession,
    asyncRoute(async (req, res) => {
      const query = String(req.body?.query || "")
        .trim()
        .slice(0, 200);
      if (query.length < 2) return res.json([]);
      const key = query.toLocaleLowerCase("sl");
      const hit = cache.get(`q:${key}`);
      if (hit && hit.expiresAt > Date.now()) return res.json(hit.value);
      const url = new URL(endpoint());
      url.searchParams.set("q", query);
      url.searchParams.set("limit", "8");
      const data = await request(url);
      const results = (Array.isArray(data?.features) ? data.features : [])
        .map(placeFromFeature)
        .filter(Boolean);
      cache.set(`q:${key}`, {
        value: results,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      res.json(results);
    }),
  );
  router.post(
    "/places/reverse",
    requireSession,
    asyncRoute(async (req, res) => {
      const lat = Number(req.body?.lat);
      const lon = Number(req.body?.lon);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        return res.status(400).json({ error: "Koordinati nista veljavni." });
      const key = `r:${lat.toFixed(5)},${lon.toFixed(5)}`;
      const hit = cache.get(key);
      if (hit && hit.expiresAt > Date.now()) return res.json(hit.value);
      const base = new URL(endpoint());
      base.pathname = base.pathname.replace(/\/api\/?$/, "/reverse");
      base.search = "";
      base.searchParams.set("lat", String(lat));
      base.searchParams.set("lon", String(lon));
      const data = await request(base);
      const result = placeFromFeature(data?.features?.[0]) || {
        label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
        lat,
        lon,
        countryCode: null,
      };
      result.lat = lat;
      result.lon = lon;
      cache.set(key, {
        value: result,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      });
      res.json(result);
    }),
  );
  router.post(
    "/places/terminals",
    requireSession,
    asyncRoute(async (req, res) => {
      const lat = Number(req.body?.lat),
        lon = Number(req.body?.lon);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lon) ||
        Math.abs(lat) > 90 ||
        Math.abs(lon) > 180
      )
        return res
          .status(400)
          .json({ error: "Koordinati lokacije niso veljavni." });
      const rolaOnly = req.body?.rolaOnly === true;
      const unitType = String(req.body?.unitType || '').toLocaleLowerCase('sl');
      let rows;
      if (unitType.includes('p400')) {
        rows = await unitTerminalRows('P400');
      } else if (unitType.includes('zabojnik') || unitType.includes('container') || unitType.includes('kontejner') || /zaboj\s*45/.test(unitType)) {
        rows = await unitTerminalRows('CONTAINER');
      } else if (unitType.includes('izmenljivi') || unitType.includes('swap')) {
        rows = await unitTerminalRows('SWAP_BODY');
      } else if (rolaOnly) {
        [rows] = await pool.execute("SELECT id,name,country_code,city,address,latitude,longitude,website FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL");
      } else {
        const [rola] = await pool.execute("SELECT id,name,country_code,city,address,latitude,longitude,website FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL");
        const units = [...await unitTerminalRows('P400'),...await unitTerminalRows('CONTAINER'),...await unitTerminalRows('SWAP_BODY')];
        rows = [...rola,...units];
      }
      if ((unitType.includes('p400') || unitType.includes('zabojnik') || unitType.includes('container') || unitType.includes('kontejner') || unitType.includes('izmenljivi') || unitType.includes('swap')) && (!rows.length || rows.every(row=>row.latitude==null||row.longitude==null))) {
        const wanted=unitType.includes('p400')?'P400':unitType.includes('zabojnik')||unitType.includes('container')||unitType.includes('kontejner')?'CONTAINER':'SWAP_BODY';
        const catalog=await readJson(pool,'app_unit_terminals_catalog')||[];
        rows=catalog.filter(row=>row.unitType===wanted&&row.active!==false&&row.latitude!=null&&row.longitude!=null).map(row=>({id:row.id,name:row.name,country_code:row.countryCode,city:row.city,address:row.address,latitude:row.latitude,longitude:row.longitude,website:null}));
      }
      const candidates = rows
        .map((row) => {
          const terminalLat = Number(row.latitude),
            terminalLon = Number(row.longitude);
          const km =
            6371 *
            2 *
            Math.asin(
              Math.sqrt(
                Math.sin(((terminalLat - lat) * Math.PI) / 360) ** 2 +
                  Math.cos((lat * Math.PI) / 180) *
                    Math.cos((terminalLat * Math.PI) / 180) *
                    Math.sin(((terminalLon - lon) * Math.PI) / 360) ** 2,
              ),
            );
          return {
            id: row.id,
            label: row.name,
            lat: terminalLat,
            lon: terminalLon,
            countryCode: row.country_code,
            city: row.city,
            address: row.address,
            distanceKm: Math.round(km * 10) / 10,
            website: row.website,
            source: rolaOnly
              ? "Ro-La terminal database"
              : "Railopt terminal database",
          };
        })
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 5);
      res.json(candidates);
    }),
  );
  return router;
}
module.exports = { createPlacesRouter };
