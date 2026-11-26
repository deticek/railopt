const networkSnapshot = require('../data/kombiverkehr-network.json');
const { readJson } = require('../lib/parameter-store');
const { readNetworkSnapshot } = require('../lib/kombiverkehr-store');

const hourMs = 60 * 60 * 1000;
const minuteMs = 60 * 1000;
const transferMinutes = 180;

function parseJson(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return fallback;
}

function haversineKm(a, b) {
  const radians = Math.PI / 180;
  const dLat = (Number(b.latitude) - Number(a.lat)) * radians;
  const dLon = (Number(b.longitude) - Number(a.lon)) * radians;
  const q = Math.sin(dLat / 2) ** 2 +
    Math.cos(Number(a.lat) * radians) * Math.cos(Number(b.latitude) * radians) *
    Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(q));
}

async function nearestRailTerminals(pool, place, limit = 1) {
  const lat = Number(place?.lat), lon = Number(place?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  let rows;
  try {
    [rows] = await pool.execute(
      'SELECT id,name,latitude,longitude FROM rail_terminals WHERE active_in_source_week=1 AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY name',
    );
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const stored = await readNetworkSnapshot(pool);
    rows = (stored?.terminals || []).filter(row => row.latitude != null && row.longitude != null && row.activeInSourceWeek !== false);
  }
  return rows.filter(row => row.active_in_source_week !== 0 && row.activeInSourceWeek !== false).map(row => ({
    ...row,
    distanceKm: haversineKm({ lat, lon }, row),
  })).sort((a, b) => a.distanceKm - b.distanceKm).slice(0, limit);
}

function nextDeparture(after, days, times) {
  let best = null;
  const base = new Date(after);
  for (let delta = 0; delta <= 8; delta++) {
    const date = new Date(base);
    date.setDate(date.getDate() + delta);
    // The source file uses ISO weekdays (Monday=0), while JavaScript uses
    // Sunday=0.
    const isoDay = (date.getDay() + 6) % 7;
    if (!days.includes(isoDay)) continue;
    for (const time of times) {
      const [hour, minute] = String(time).split(':').map(Number);
      const candidate = new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0);
      if (candidate >= base && (!best || candidate < best)) best = candidate;
    }
  }
  return best;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function edgeBlocked(edge, start, end, disruptions) {
  return disruptions.some(item => {
    const samePair = (item.a === edge.from && item.b === edge.to) ||
      (item.a === edge.to && item.b === edge.from);
    return samePair && overlaps(start, end, item.startsAt, item.endsAt);
  });
}

async function loadNetwork(pool) {
  try {
  const [edges] = await pool.execute(
    `SELECT o.name AS origin,d.name AS destination,c.train_numbers,c.departure_days,
            c.departure_times,c.weekly_runs,c.duration_minutes,c.inferred_train_number,
            c.source_period_start,c.source_period_end
       FROM rail_connections c
       JOIN rail_terminals o ON o.id=c.origin_terminal_id
       JOIN rail_terminals d ON d.id=c.destination_terminal_id
      WHERE c.active=1`,
  );
  const [closures] = await pool.execute(
    `SELECT a.name AS terminal_a,b.name AS terminal_b,starts_at,ends_at,note
       FROM rail_disruptions r
       JOIN rail_terminals a ON a.id=r.terminal_a_id
       JOIN rail_terminals b ON b.id=r.terminal_b_id
      WHERE r.active=1 AND ends_at>NOW()`,
  );
  return {
    edges: edges.map(row => ({
      from: row.origin,
      to: row.destination,
      trainNumbers: parseJson(row.train_numbers),
      days: parseJson(row.departure_days).map(Number),
      times: parseJson(row.departure_times).map(String),
      durationMinutes: Number(row.duration_minutes),
      inferredTrainNumber: Boolean(row.inferred_train_number),
      sourcePeriodStart: String(row.source_period_start).slice(0, 10),
      sourcePeriodEnd: String(row.source_period_end).slice(0, 10),
    })),
    disruptions: closures.map(row => ({
      a: row.terminal_a,
      b: row.terminal_b,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      note: row.note || '',
    })),
  };
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const [stored, disruptions] = await Promise.all([
      readNetworkSnapshot(pool),
      readJson(pool, 'app_kombiverkehr_disruptions'),
    ]);
    if (!stored) throw error;
    return {
      edges: (stored.connections || []).map(edge => ({
        from: edge.from,
        to: edge.to,
        trainNumbers: edge.trainNumbers || [],
        days: (edge.departureDays || []).map(Number),
        times: (edge.departureTimes || []).map(String),
        durationMinutes: Number(edge.durationMinutes),
        inferredTrainNumber: Boolean(edge.inferred),
        sourcePeriodStart: stored.periodStart,
        sourcePeriodEnd: stored.periodEnd,
      })),
      disruptions: (disruptions || []).filter(row => row.active !== false).map(row => ({
        a: row.terminalA,
        b: row.terminalB,
        startsAt: new Date(row.startsAt),
        endsAt: new Date(row.endsAt),
        note: row.note || '',
      })),
    };
  }
}

function shortestScheduledPath(edges, disruptions, origin, destination, readyAt) {
  if (origin === destination) return null;
  const start = new Date(readyAt);
  const queue = [{ terminal: origin, arrival: start, legs: [], visited: new Set([origin]) }];
  const best = new Map([[origin, start.getTime()]]);
  while (queue.length) {
    queue.sort((a, b) => a.arrival - b.arrival);
    const state = queue.shift();
    if (state.terminal === destination) return state;
    if (state.legs.length >= 6) continue;
    for (const edge of edges) {
      if (edge.from !== state.terminal || state.visited.has(edge.to)) continue;
      const earliest = new Date(state.arrival.getTime() + (state.legs.length ? transferMinutes * minuteMs : 0));
      let departure = nextDeparture(earliest, edge.days, edge.times);
      let attempts = 0;
      let arrival;
      while (departure && attempts++ < 20) {
        arrival = new Date(departure.getTime() + edge.durationMinutes * minuteMs);
        if (!edgeBlocked(edge, departure, arrival, disruptions)) break;
        departure = nextDeparture(new Date(departure.getTime() + minuteMs), edge.days, edge.times);
      }
      if (!departure || !arrival || edgeBlocked(edge, departure, arrival, disruptions)) continue;
      const prior = best.get(edge.to);
      if (prior !== undefined && prior <= arrival.getTime()) continue;
      best.set(edge.to, arrival.getTime());
      const visited = new Set(state.visited);
      visited.add(edge.to);
      queue.push({
        terminal: edge.to,
        arrival,
        visited,
        legs: [...state.legs, {
          from: edge.from,
          to: edge.to,
          trainNumbers: edge.trainNumbers,
          inferredTrainNumber: edge.inferredTrainNumber,
          departureAt: departure,
          arrivalAt: arrival,
          durationMinutes: edge.durationMinutes,
          departureDays: edge.days,
          departureTimes: edge.times,
          sourcePeriodStart: edge.sourcePeriodStart,
          sourcePeriodEnd: edge.sourcePeriodEnd,
        }],
      });
    }
  }
  return null;
}

async function findScheduledRailPath(pool, origin, destination, readyAt) {
  const { edges, disruptions } = await loadNetwork(pool);
  // Also calculate the unimpeded scheduled path. This lets the planner draw
  // the exact terminal-to-terminal connection that a saved closure removed,
  // alongside the replacement connections selected by the timetable search.
  const original = shortestScheduledPath(edges, [], origin, destination, readyAt);
  const disruptedResult = disruptions.length
    ? shortestScheduledPath(edges, disruptions, origin, destination, readyAt)
    : original;
  if (!original && !disruptedResult) return null;
  let coordinates;
  try {
    [coordinates] = await pool.query(
      'SELECT name,latitude,longitude FROM rail_terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL',
    );
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const stored = await readNetworkSnapshot(pool);
    coordinates = (stored?.terminals || []).filter(row => row.latitude != null && row.longitude != null);
  }
  const byName = new Map(coordinates.map(row => [row.name, row]));
  const blockedLegs = (original?.legs || []).flatMap(leg => {
    const matches = disruptions.filter(item =>
      ((item.a === leg.from && item.b === leg.to) || (item.a === leg.to && item.b === leg.from)) &&
      overlaps(leg.departureAt, leg.arrivalAt, item.startsAt, item.endsAt));
    if (!matches.length) return [];
    const from = byName.get(leg.from), to = byName.get(leg.to);
    return [{
      from: leg.from,
      to: leg.to,
      note: matches.map(item => item.note).filter(Boolean).join('; '),
      fromCoordinate: from ? [Number(from.latitude), Number(from.longitude)] : null,
      toCoordinate: to ? [Number(to.latitude), Number(to.longitude)] : null,
    }];
  });
  // A closure elsewhere in the network or outside this shipment's actual
  // train times must not change the itinerary. Only accept the alternate
  // search when it can identify a closure on the unobstructed itinerary.
  const result = blockedLegs.length ? disruptedResult : original;
  if (!result) return null;
  let railKm = 0;
  for (const leg of result.legs) {
    const a = byName.get(leg.from), b = byName.get(leg.to);
    railKm += a && b
      ? haversineKm({ lat: a.latitude, lon: a.longitude }, b) * 1.22
      // Keep the estimate usable when a PDF terminal has no locally known
      // coordinates; at 60 km/h, each duration minute is approximately 1 km.
      : leg.durationMinutes;
  }
  return {
    originTerminal: origin,
    destinationTerminal: destination,
    departureAt: result.legs[0].departureAt,
    arrivalAt: result.arrival,
    durationMinutes: Math.round((result.arrival - result.legs[0].departureAt) / minuteMs),
    railKm: Math.round(railKm * 10) / 10,
    legs: result.legs.map(leg => {
      const from = byName.get(leg.from), to = byName.get(leg.to);
      return {
        ...leg,
        fromCoordinate: from ? [Number(from.latitude), Number(from.longitude)] : null,
        toCoordinate: to ? [Number(to.latitude), Number(to.longitude)] : null,
      };
    }),
    blockedLegs,
    terminals: [origin, ...result.legs.map(leg => leg.to)],
    sourcePeriodStart: networkSnapshot.periodStart,
    sourcePeriodEnd: networkSnapshot.periodEnd,
    timetableSnapshot: true,
  };
}

async function findNearestScheduledRailPath(pool, originPlace, destinationPlace, readyAt, excludedPair = null) {
  const [origins, destinations, network] = await Promise.all([
    nearestRailTerminals(pool, originPlace, 8),
    nearestRailTerminals(pool, destinationPlace, 8),
    loadNetwork(pool),
  ]);
  if (!origins.length || !destinations.length) return null;
  const candidates = origins.flatMap(from => destinations
    .filter(to => to.name !== from.name)
    .map(to => ({ from, to, distanceKm: from.distanceKm + to.distanceKm })))
    .filter(pair => !excludedPair || pair.from.name !== excludedPair.origin || pair.to.name !== excludedPair.destination)
    .sort((a, b) => a.distanceKm - b.distanceKm);
  let coordinates;
  try {
    [coordinates] = await pool.query(
      'SELECT name,latitude,longitude FROM rail_terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL',
    );
  } catch (error) {
    if (error.code !== 'ER_NO_SUCH_TABLE') throw error;
    const stored = await readNetworkSnapshot(pool);
    coordinates = (stored?.terminals || []).filter(row => row.latitude != null && row.longitude != null);
  }
  const byName = new Map(coordinates.map(row => [row.name, row]));
  for (const pair of candidates) {
    const path = shortestScheduledPath(network.edges, network.disruptions, pair.from.name, pair.to.name, readyAt);
    if (!path) continue;
    const original = shortestScheduledPath(network.edges, [], pair.from.name, pair.to.name, readyAt);
    const blockedLegs = (original?.legs || []).flatMap(leg => {
      const matches = network.disruptions.filter(item =>
        ((item.a === leg.from && item.b === leg.to) || (item.a === leg.to && item.b === leg.from)) &&
        overlaps(leg.departureAt, leg.arrivalAt, item.startsAt, item.endsAt));
      if (!matches.length) return [];
      const from = byName.get(leg.from), to = byName.get(leg.to);
      return [{ from: leg.from, to: leg.to, note: matches.map(item => item.note).filter(Boolean).join('; '),
        fromCoordinate: from ? [Number(from.latitude), Number(from.longitude)] : null,
        toCoordinate: to ? [Number(to.latitude), Number(to.longitude)] : null }];
    });
    const result = blockedLegs.length ? path : original;
    if (!result) continue;
    let railKm = 0;
    for (const leg of result.legs) {
      const from = byName.get(leg.from), to = byName.get(leg.to);
      railKm += from && to ? haversineKm({ lat: from.latitude, lon: from.longitude }, to) * 1.22 : leg.durationMinutes;
    }
    return {
      originTerminal: pair.from.name, destinationTerminal: pair.to.name,
      originTerminalCoordinate: [Number(pair.from.latitude), Number(pair.from.longitude)],
      destinationTerminalCoordinate: [Number(pair.to.latitude), Number(pair.to.longitude)],
      accessDistanceKm: pair.distanceKm,
      departureAt: result.legs[0].departureAt, arrivalAt: result.arrival,
      durationMinutes: Math.round((result.arrival - result.legs[0].departureAt) / minuteMs),
      railKm: Math.round(railKm * 10) / 10,
      legs: result.legs.map(leg => {
        const from = byName.get(leg.from), to = byName.get(leg.to);
        return { ...leg,
          fromCoordinate: from ? [Number(from.latitude), Number(from.longitude)] : null,
          toCoordinate: to ? [Number(to.latitude), Number(to.longitude)] : null };
      }),
      blockedLegs, terminals: [pair.from.name, ...result.legs.map(leg => leg.to)],
      sourcePeriodStart: networkSnapshot.periodStart, sourcePeriodEnd: networkSnapshot.periodEnd,
      timetableSnapshot: true, usedNearestAlternative: true,
    };
  }
  return null;
}

module.exports = {
  nearestRailTerminals,
  findScheduledRailPath,
  findNearestScheduledRailPath,
  networkSnapshot,
};
