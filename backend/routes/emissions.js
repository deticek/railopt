const express = require("express");

const roadEmissionFactor = 0.095;
const geocodeCache = new Map();
const routeDistanceCache = new Map();
let lastGeocodeRequestAt = 0;
let geocodeQueue = Promise.resolve();
const cityAliases = new Map([
  ["dunaj", "Vienna"],
  ["trst", "Trieste"],
  ["gradec", "Graz"],
  ["benetke", "Venice"],
  ["rim", "Rome"],
  ["praga", "Prague"],
  ["budimpešta", "Budapest"],
]);
const countryAliases = new Map([
  ["slovenija", "Slovenia"],
  ["avstrija", "Austria"],
  ["nemčija", "Germany"],
  ["italija", "Italy"],
  ["hrvaška", "Croatia"],
  ["madžarska", "Hungary"],
  ["slovaška", "Slovakia"],
  ["češka", "Czechia"],
  ["francija", "France"],
  ["poljska", "Poland"],
  ["švica", "Switzerland"],
  ["belgija", "Belgium"],
  ["nizozemska", "Netherlands"],
]);

function normalizedPlace(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("sl");
}
function isMapsHost(hostname) {
  return (
    hostname === "google.com" ||
    hostname.endsWith(".google.com") ||
    hostname === "goo.gl" ||
    hostname === "maps.app.goo.gl"
  );
}
function coordinatesFromUrl(url) {
  const source = url.href;
  let match = source.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (!match) match = source.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/);
  if (!match)
    match = source
      .match(/!2d(-?\d{1,3}\.\d+)!3d(-?\d{1,2}\.\d+)/)
      ?.map((value, index, all) =>
        index === 1 ? all[2] : index === 2 ? all[1] : value,
      );
  if (!match) return null;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
function placeTextFromUrl(url) {
  const pathPlace = url.pathname.match(/\/place\/([^/]+)/)?.[1];
  const queryPlace = url.searchParams.get("query") || url.searchParams.get("q");
  const text = queryPlace || pathPlace || "";
  try {
    return decodeURIComponent(text.replace(/\+/g, " "))
      .replace(/,/g, ", ")
      .replace(/\s+/g, " ")
      .trim();
  } catch {
    return text.replace(/\+/g, " ").trim();
  }
}
async function expandMapsLink(value) {
  let current;
  try {
    current = new URL(value);
  } catch {
    throw new Error("Prilepi veljaven naslov ali povezavo Google Maps.");
  }
  if (
    !["https:", "http:"].includes(current.protocol) ||
    !isMapsHost(current.hostname)
  )
    throw new Error("Povezava mora biti iz Google Maps.");
  for (
    let hop = 0;
    hop < 4 &&
    (current.hostname === "goo.gl" || current.hostname === "maps.app.goo.gl");
    hop++
  ) {
    let response;
    try {
      response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        headers: { Range: "bytes=0-0" },
        signal: AbortSignal.timeout(2500),
      });
    } catch {
      break;
    }
    const location = response.headers.get("location");
    if (!location) break;
    const next = new URL(location, current);
    if (!isMapsHost(next.hostname))
      throw new Error("Google Maps povezava vodi na neznano spletno mesto.");
    current = next;
  }
  return current;
}
async function parsePlace(value, label, onProgress = () => {}) {
  const input = String(value || "").trim();
  if (/^https?:\/\//i.test(input)) {
    onProgress("Preverjam povezavo Google Maps za " + label + "…");
    const url = await expandMapsLink(input);
    const coordinates = coordinatesFromUrl(url);
    const name = placeTextFromUrl(url) || input;
    if (coordinates) return { ...coordinates, label: name };
    if (name && name !== input) return geocodePlace(name, label, onProgress);
    throw new Error(
      "Povezave kraja " +
        label +
        " ne znam razbrati. Prilepi daljšo Google Maps povezavo ali naslov kraja.",
    );
  }
  const coordinateMatch = input.match(
    /^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/,
  );
  if (coordinateMatch) {
    const lat = Number(coordinateMatch[1]);
    const lon = Number(coordinateMatch[2]);
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
      return { lat, lon, label: input };
  }
  return geocodePlace(input, label, onProgress);
}
function geocoderQuery(place) {
  const parts = place.split(",").map((part) => part.trim());
  if (parts.length === 1) {
    const value = parts[0].toLocaleLowerCase("sl");
    const commonSlovenianPlaces = new Map([
      ["koper", "Koper, Slovenia"],
      ["dunaj", "Vienna, Austria"],
      ["ljubljana", "Ljubljana, Slovenia"],
      ["maribor", "Maribor, Slovenia"],
      ["celje", "Celje, Slovenia"],
      ["kranj", "Kranj, Slovenia"],
      ["novo mesto", "Novo Mesto, Slovenia"],
      ["nova gorica", "Nova Gorica, Slovenia"],
      ["murska sobota", "Murska Sobota, Slovenia"],
    ]);
    return (
      commonSlovenianPlaces.get(value) || cityAliases.get(value) || parts[0]
    );
  }
  return parts
    .map((value, index) => {
      const alias =
        index === 0
          ? cityAliases.get(value.toLocaleLowerCase("sl"))
          : countryAliases.get(value.toLocaleLowerCase("sl"));
      return alias || value;
    })
    .join(", ");
}
async function geocodePlace(place, label, onProgress) {
  const key = normalizedPlace(place);
  if (geocodeCache.has(key)) return geocodeCache.get(key);
  onProgress("Iščem " + label + " na zemljevidu: " + place + "…");
  const query = new URLSearchParams({ q: geocoderQuery(place), limit: "5" });
  const request = geocodeQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastGeocodeRequestAt));
    if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
    lastGeocodeRequestAt = Date.now();
    const endpoint =
      process.env.GEOCODER_URL || "https://photon.komoot.io/api/";
    const response = await fetch(endpoint + "?" + query, {
      headers: {
        "User-Agent": "RailoptTransportDashboard/1.0 (route distance lookup)",
      },
      signal: AbortSignal.timeout(6000),
    });
    if (!response.ok)
      throw new Error("Iskanje krajev trenutno ni dosegljivo. Poskusi znova.");
    return response.json();
  });
  geocodeQueue = request.then(
    () => undefined,
    () => undefined,
  );
  const data = await request;
  const requestedCountry =
    geocoderQuery(place).split(",").at(-1)?.trim().toLocaleLowerCase("en") ||
    "";
  const features = (Array.isArray(data?.features) ? data.features : []).filter(
    (feature) =>
      Array.isArray(feature.geometry?.coordinates) &&
      feature.geometry.coordinates.length >= 2,
  );
  features.sort((a, b) => {
    const countryA = String(a.properties?.country || "").toLocaleLowerCase(
      "en",
    );
    const countryB = String(b.properties?.country || "").toLocaleLowerCase(
      "en",
    );
    const countryScore =
      Number(countryB.includes(requestedCountry)) -
      Number(countryA.includes(requestedCountry));
    if (countryScore) return countryScore;
    const preferred = new Set(["city", "town", "village", "municipality"]);
    return (
      Number(preferred.has(b.properties?.type)) -
      Number(preferred.has(a.properties?.type))
    );
  });
  const feature = features[0];
  if (!feature)
    throw new Error(
      "Kraja »" +
        place +
        "« nisem našel. Poskusi dodati državo ali prilepi Google Maps povezavo.",
    );
  const [lon, lat] = feature.geometry.coordinates;
  const result = {
    lat: Number(lat),
    lon: Number(lon),
    label: [feature.properties?.name || place, feature.properties?.country]
      .filter(Boolean)
      .join(", "),
    countryCode:
      String(
        feature.properties?.countrycode ||
          feature.properties?.country_code ||
          "",
      ).toUpperCase() || null,
  };
  geocodeCache.set(key, result);
  if (geocodeCache.size > 500)
    geocodeCache.delete(geocodeCache.keys().next().value);
  return result;
}
async function calculateTrip(
  origin,
  destination,
  weightKg,
  onProgress = () => {},
  roadDisruptions = [],
) {
  const disruptionKey = roadDisruptions.map(item => item.id).sort().join(',');
  const key = normalizedPlace(origin) + "|" + normalizedPlace(destination) + `|${disruptionKey}`;
  const entry = routeDistanceCache.get(key);
  let route = entry?.expiresAt > Date.now() ? entry.route : null;
  const cached = Boolean(route);
  if (!route) {
    const from = await parsePlace(origin, "kraja A", onProgress);
    const to = await parsePlace(destination, "kraja B", onProgress);
    onProgress("Računam cestno razdaljo med izbranima krajema…");
    const primaryRouter =
      process.env.OSRM_URL ||
      "https://router.project-osrm.org/route/v1/driving/";
    const routers = [
      ...new Set([
        primaryRouter.endsWith("/") ? primaryRouter : `${primaryRouter}/`,
        "https://routing.openstreetmap.de/routed-car/route/v1/driving/",
      ]),
    ];
    const requestRoute = async points => {
      const coordinates = points.map(point => `${point.lon},${point.lat}`).join(';');
      for (const routerUrl of routers) {
        try {
          const response = await fetch(routerUrl + coordinates + "?overview=full&geometries=geojson&steps=true", {
            headers: { "User-Agent": "RailoptTransportDashboard/1.0 (route distance lookup)" },
            signal: AbortSignal.timeout(8000),
          });
          if (!response.ok) continue;
          const data = await response.json();
          const candidate = data.routes?.[0];
          const distanceKm = Number(candidate?.distance) / 1000;
          if (data.code === "Ok" && candidate && Number.isFinite(distanceKm) && distanceKm > 0) return candidate;
        } catch (error) {
          console.warn(`Road routing provider failed: ${error.code || error.name || "Error"}.`);
        }
      }
      return null;
    };
    let routeData = await requestRoute([from, to]);
    const routeCoordinates = candidate => simplifyCoordinates(candidate?.geometry?.coordinates || [])
      .map(([lon, lat]) => [Number(lat), Number(lon)]);
    const closuresOnRoute = candidate => roadDisruptions.filter(item =>
      routeTouchesLocation(routeCoordinates(candidate), item.location, Number(item.radiusKm || 2)));
    let detouredDisruptions = [];
    let unavoidedDisruptions = [];
    if (routeData) {
      const affected = closuresOnRoute(routeData);
      if (affected.length) {
        const waypoints = [from, ...affected.map(item => ({ lat: Number(item.bypass.lat), lon: Number(item.bypass.lon) })), to];
        const detour = await requestRoute(waypoints);
        if (detour) {
          routeData = detour;
          detouredDisruptions = affected.map(item => item.name);
          unavoidedDisruptions = closuresOnRoute(routeData).map(item => item.name);
        } else unavoidedDisruptions = affected.map(item => item.name);
    } else {
      unavoidedDisruptions = roadDisruptions
        .filter(item => routeTouchesLocation([[from.lat, from.lon], [to.lat, to.lon]], item.location, Number(item.radiusKm || 2)))
        .map(item => item.name);
      }
    }
    if (!routeData) {
      const radians = Math.PI / 180;
      const dLat = (to.lat - from.lat) * radians;
      const dLon = (to.lon - from.lon) * radians;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(from.lat * radians) *
          Math.cos(to.lat * radians) *
          Math.sin(dLon / 2) ** 2;
      const directDistanceKm = 6371 * 2 * Math.asin(Math.sqrt(a));
      if (!Number.isFinite(directDistanceKm) || directDistanceKm < 0) {
        throw new Error(
          "Za približno cestno razdaljo manjkajo veljavne koordinate.",
        );
      }
      const distanceKm = Math.max(
        1,
        Math.round(directDistanceKm * 1.3 * 10) / 10,
      );
      route = {
        origin: from.label,
        destination: to.label,
        distanceKm,
        durationHours: distanceKm / 65,
        segments: [],
        routeCoordinates: [[from.lat, from.lon], [to.lat, to.lon]],
        detouredDisruptions,
        unavoidedDisruptions,
        approximate: true,
      };
      onProgress(
        "Cestni usmerjevalniki niso dosegljivi; uporabljam približno razdaljo.",
      );
    } else {
      const distanceKm = Number(routeData.distance) / 1000;
      const durationHours = Number(routeData.duration) / 3600;
      if (!Number.isFinite(durationHours) || durationHours <= 0)
        throw new Error("Cestna pot nima veljavne ocene trajanja.");
      const segments = (routeData.legs || []).flatMap((leg) =>
        (leg.steps || [])
          .map((step) => ({
            distanceKm: Number(step.distance) / 1000,
            durationHours: Number(step.duration) / 3600,
            roadName: String(step.name || "").slice(0, 120) || null,
            speedLimitKmh: Number.isFinite(Number(step.maxspeed))
              ? Number(step.maxspeed)
              : null,
          }))
          .filter((step) => step.distanceKm > 0 && step.durationHours > 0),
      );
      route = {
        origin: from.label,
        destination: to.label,
        distanceKm: Math.round(distanceKm * 10) / 10,
        durationHours,
        segments,
        routeCoordinates: routeCoordinates(routeData),
        detouredDisruptions,
        unavoidedDisruptions,
      };
    }
    routeDistanceCache.set(key, { route, expiresAt: Date.now() + 86400000 });
    if (routeDistanceCache.size > 500)
      routeDistanceCache.delete(routeDistanceCache.keys().next().value);
  }
  onProgress("Računam tonske kilometre in emisije…");
  const tonKilometers = (weightKg / 1000) * route.distanceKm;
  return {
    origin: route.origin,
    destination: route.destination,
    distanceKm: route.distanceKm,
    durationHours: route.durationHours,
    segments: route.segments,
    routeCoordinates: route.routeCoordinates || [],
    detouredDisruptions: route.detouredDisruptions || [],
    unavoidedDisruptions: route.unavoidedDisruptions || [],
    weightKg,
    tonKilometers: Math.round(tonKilometers * 10) / 10,
    factorKgCo2ePerTkm: roadEmissionFactor,
    emissionsKgCo2e: Math.round(tonKilometers * roadEmissionFactor * 10) / 10,
    attribution: "© OpenStreetMap contributors",
    cached,
    approximate: Boolean(route.approximate),
  };
}
function routeTouchesLocation(routeCoordinates, place, radiusKm = 2) {
  if (!place || !Number.isFinite(Number(place.lat)) || !Number.isFinite(Number(place.lon))) return false;
  const lat = Number(place.lat), lon = Number(place.lon);
  const distanceTo = (a, b) => {
    const scaleY = 111.195;
    const scaleX = 111.195 * Math.cos(lat * Math.PI / 180);
    const ax = (Number(a[1]) - lon) * scaleX, ay = (Number(a[0]) - lat) * scaleY;
    const bx = (Number(b[1]) - lon) * scaleX, by = (Number(b[0]) - lat) * scaleY;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1)));
    return Math.hypot(ax + t * dx, ay + t * dy);
  };
  if (routeCoordinates.some(coordinate => distanceTo(coordinate, coordinate) <= radiusKm)) return true;
  for (let i = 1; i < routeCoordinates.length; i++)
    if (distanceTo(routeCoordinates[i - 1], routeCoordinates[i]) <= radiusKm) return true;
  return false;
}
function simplifyCoordinates(coordinates, limit = 700) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
  const step = Math.max(1, Math.ceil(coordinates.length / limit));
  const result = coordinates.filter((_point, index) => index % step === 0);
  if (result.at(-1) !== coordinates.at(-1)) result.push(coordinates.at(-1));
  return result;
}
function validateInput(body) {
  const origin = String(body?.origin || "").trim();
  const destination = String(body?.destination || "").trim();
  const weightKg = Number(body?.weightKg);
  if (
    origin.length < 2 ||
    origin.length > 2000 ||
    destination.length < 2 ||
    destination.length > 2000 ||
    normalizedPlace(origin) === normalizedPlace(destination) ||
    !Number.isFinite(weightKg) ||
    weightKg < 1 ||
    weightKg > 1000000
  )
    return null;
  return { origin, destination, weightKg };
}
function createEmissionsRouter({ requireSession, asyncRoute }) {
  const router = express.Router();
  router.post(
    "/emissions/road",
    requireSession,
    asyncRoute(async (req, res) => {
      const input = validateInput(req.body);
      if (!input)
        return res
          .status(400)
          .json({
            error:
              "Vnesite dva različna kraja in težo tovora med 1 in 1.000.000 kg.",
          });
      res.json(
        await calculateTrip(input.origin, input.destination, input.weightKg),
      );
    }),
  );
  router.post("/emissions/road/stream", requireSession, (req, res) => {
    const input = validateInput(req.body);
    if (!input)
      return res
        .status(400)
        .json({
          error:
            "Vnesite dva različna kraja in težo tovora med 1 in 1.000.000 kg.",
        });
    res
      .status(200)
      .set({
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
    res.flushHeaders?.();
    const send = (payload) =>
      res.write("data: " + JSON.stringify(payload) + "\n\n");
    calculateTrip(input.origin, input.destination, input.weightKg, (message) =>
      send({ type: "progress", message }),
    )
      .then((result) => send({ type: "result", result }))
      .catch((error) =>
        send({ type: "error", error: error.message || "Izračun ni uspel." }),
      )
      .finally(() => res.end());
  });
  return router;
}
module.exports = {
  createEmissionsRouter,
  calculateTrip,
  resolvePlace: parsePlace,
};
