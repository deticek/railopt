const express = require("express");
const { validDate } = require("../lib/validation");
const { estimateDeliveryPlan } = require("../services/delivery-planner");
const { resolvePlace } = require("./emissions");
const crypto = require("node:crypto");
const { nearestRailTerminals } = require("../services/kombiverkehr-network");
function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, asyncRoute, serializeShipment, validDate } =
    deps;
  const validId = (value) =>
    /^\d{1,20}$/.test(value) || /^[0-9a-f-]{36}$/i.test(value);
  const calculationTasks = new Map();
  const sqlDate = (value) =>
    value instanceof Date
      ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
      : String(value || "").slice(0, 10);
  const sqlTime = (value) =>
    `${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}:${String(value.getSeconds()).padStart(2, "0")}`;
  async function getPlannerParameters() {
    const [rows] = await pool.query(
      "SELECT parameter_code,fixed_value,per_unit_value,numeric_value,text_value FROM parameters",
    );
    return new Map(rows.map((row) => [row.parameter_code, row]));
  }
  function numericParameter(params, key, fallback = 0) {
    const value = Number(params.get(key)?.numeric_value);
    return Number.isFinite(value) ? value : fallback;
  }
  async function closestTerminals(place, terminals) {
    const sorted = terminals
      .map((row) => {
        const lat = Number(row.latitude),
          lon = Number(row.longitude);
        const dLat = ((lat - place.lat) * Math.PI) / 180,
          dLon = ((lon - place.lon) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((place.lat * Math.PI) / 180) *
            Math.cos((lat * Math.PI) / 180) *
            Math.sin(dLon / 2) ** 2;
        return {
          ...row,
          lat,
          lon,
          distanceKm: 6371 * 2 * Math.asin(Math.sqrt(a)),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);
    const row = sorted[0];
    return row
      ? {
          label: row.name,
          lat: row.lat,
          lon: row.lon,
          countryCode: row.country_code || null,
        }
      : null;
  }
  async function calculateAndSave(
    shipmentId,
    requestedMode,
    params,
    terminals,
    previewOnly = false,
  ) {
    const [[row]] = await pool.execute(
      `SELECT s.*,r.loading_country,r.loading_postal_code,r.loading_city,r.unloading_country,r.unloading_postal_code,r.unloading_city,r.loading_window_start,r.loading_window_end,r.unloading_window_start,r.unloading_window_end,COALESCE(se.numeric_value,0) AS shipment_extra_time,COALESCE(re.numeric_value,0) AS route_extra_time FROM shipments s JOIN routes r ON r.id=s.route_id LEFT JOIN parameters se ON se.parameter_code=CONCAT('shipment_extra_time_',REPLACE(s.id,'-','')) LEFT JOIN parameters re ON re.parameter_code=CONCAT('route_extra_time_',REPLACE(r.id,'-','')) WHERE s.id=? LIMIT 1`,
      [shipmentId],
    );
    if (!row) throw new Error("Pošiljka ne obstaja.");
    const weightKg = Number(row.weight_kg);
    if (!Number.isFinite(weightKg) || weightKg <= 0)
      throw new Error("V pošiljki manjka veljavna teža tovora.");
    const originLabel = `${row.loading_postal_code} ${row.loading_city}, ${row.loading_country}`;
    const destinationLabel = `${row.unloading_postal_code} ${row.unloading_city}, ${row.unloading_country}`;
    const [originGeo, destinationGeo] = await Promise.all([
      resolvePlace(originLabel, "naklada", () => {}),
      resolvePlace(destinationLabel, "razklada", () => {}),
    ]);
    const mode = String(requestedMode || "AUTO").toUpperCase();
    const sourceUnit = String(row.unit_type || "");
    const liftable = /p400|izmenljivi zaboj|zabojnik\s*45|zaboj\s*45|dvigljiv/i.test(
      sourceUnit,
    );
    const roadOnly = /samo cesta|tovornjak/i.test(sourceUnit);
    if (!["AUTO", "ROAD", "INTERMODAL", "RO_LA", "COMPARE"].includes(mode))
      throw new Error("Izbran način prevoza ni veljaven.");
    if (mode === "INTERMODAL" && !liftable)
      throw new Error("Železniški prevoz je mogoč za dvigljivo enoto.");
    if (mode === "RO_LA" && liftable)
      throw new Error("Ro-La je izbrana za nedvigljivo enoto.");
    const useCompare =
      mode === "ROAD" ? false : mode === "AUTO" ? !roadOnly : true;
    const unitType =
      mode === "INTERMODAL" && !liftable
        ? sourceUnit
        : mode === "RO_LA" && liftable
          ? "Nedvigljiva prikolica s ponjavo"
          : sourceUnit;
    const closestForUnit = async (place) => {
      if (liftable) {
        const [terminal] = await nearestRailTerminals(pool, place);
        return terminal ? {
          label: terminal.name,
          lat: Number(terminal.latitude),
          lon: Number(terminal.longitude),
          countryCode: null,
        } : null;
      }
      return closestTerminals(place, terminals);
    };
    const terminalOrigin = useCompare ? await closestForUnit(originGeo) : null;
    const terminalDestination = useCompare ? await closestForUnit(destinationGeo) : null;
    if (useCompare && (!terminalOrigin || !terminalDestination))
      throw new Error(
        "Za samodejno primerjavo v lokalni bazi ni terminala blizu ene od lokacij.",
      );
    const loadingDate = sqlDate(row.loading_date),
      deadlineDate = sqlDate(row.recipient_deadline);
    const loadingAt = `${loadingDate}T${String(row.loading_window_start || "07:00:00").slice(0, 5)}`;
    let deliveryDeadlineAt = `${deadlineDate}T18:00`;
    if (new Date(deliveryDeadlineAt) <= new Date(loadingAt))
      deliveryDeadlineAt = `${deadlineDate}T23:59`;
    if (new Date(deliveryDeadlineAt) <= new Date(loadingAt))
      throw new Error("Rok dostave mora biti po terminu naklada.");
    const globalExtra = numericParameter(params, "delivery_global_extra_time");
    const extraTimeMinutes = Math.min(
      720,
      globalExtra +
        Number(row.route_extra_time || 0) +
        Number(row.shipment_extra_time || 0),
    );
    const costs = {
      fuelPricePerLitre: 1.55,
      fuelConsumptionLPer100Km: 30,
      driverCostPerHour: 18,
      tollsEur: 0,
      customsEur: 0,
      otherVehicleEur: 0,
    };
    const input = {
      origin: {
        label: originLabel,
        lat: originGeo.lat,
        lon: originGeo.lon,
        countryCode: originGeo.countryCode,
      },
      destination: {
        label: destinationLabel,
        lat: destinationGeo.lat,
        lon: destinationGeo.lon,
        countryCode: destinationGeo.countryCode,
      },
      terminalOrigin,
      terminalDestination,
      loadingAt,
      deliveryDeadlineAt,
      loadingWindowStart: String(row.loading_window_start || "07:00").slice(
        0,
        5,
      ),
      loadingWindowEnd: String(row.loading_window_end || "11:00").slice(0, 5),
      unloadingWindowStart: String(row.unloading_window_start || "07:00").slice(
        0,
        5,
      ),
      unloadingWindowEnd: String(row.unloading_window_end || "15:00").slice(
        0,
        5,
      ),
      weightKg,
      unitType,
      extraTimeMinutes,
      globalExtraTimeMinutes: globalExtra,
      transportMode: useCompare ? "compare" : "road",
      preference: "cost",
      roLaTicketEur: 0,
      adr: Boolean(row.adr),
      weekendBan: true,
      costMode: "excel",
      costs,
    };
    const result = await estimateDeliveryPlan(input, { pool, params });
    if (previewOnly)
      return {
        options: result.options
          .filter((item) => ["road", "rail", "rola"].includes(item.id))
          .map((item) => ({
            id: item.id,
            title: item.title,
            mode: item.mode,
            costEur: item.cost.totalEur,
            emissionsKgCo2e: item.emissionsKgCo2e,
            deliveryAt: item.deliveryAt,
            totalElapsedHours: item.totalElapsedHours,
            roadKm: item.roadKm,
            railKm: item.railKm,
            feasible: item.feasible,
            warnings: item.warnings || [],
          })),
        recommendedOptionId: result.recommendedOptionId,
        input,
        result,
      };
    let option;
    if (mode === "ROAD")
      option = result.options.find((item) => item.id === "road");
    else if (mode === "INTERMODAL")
      option = result.options.find((item) => item.id === "rail");
    else if (mode === "RO_LA")
      option = result.options.find((item) => item.id === "rola");
    else
      option =
        result.options.find((item) => item.id === result.recommendedOptionId) ||
        result.options.find((item) => item.id === "road");
    if (!option)
      throw new Error("Izbrane možnosti prevoza ni bilo mogoče izračunati.");
    await pool.execute(
      "UPDATE transport_results SET recommended=0 WHERE shipment_id=?",
      [row.id],
    );
    const arrival = new Date(option.deliveryAt);
    await pool.execute(
      `INSERT INTO transport_results (shipment_id,transport_type,feasible,total_cost,delivery_date,delivery_time,co2_kg,road_distance_km,rail_distance_km,recommended,rejection_reason) VALUES (?,?,?,?,?,?,?,?,?,1,?)`,
      [
        row.id,
        option.mode === "road"
          ? "ROAD"
          : option.mode === "rola"
            ? "RO_LA"
            : "INTERMODAL",
        option.feasible ? 1 : 0,
        option.cost.totalEur,
        sqlDate(arrival),
        sqlTime(arrival),
        option.emissionsKgCo2e,
        option.roadKm,
        option.railKm,
        option.feasible
          ? null
          : option.warnings?.join("\n") || "Rok dostave ni dosežen.",
      ],
    );
    return {
      shipmentId: row.id,
      mode: option.mode,
      cost: option.cost.totalEur,
      co2Kg: option.emissionsKgCo2e,
      deliveryAt: option.deliveryAt,
      feasible: option.feasible,
    };
  }
  router.get(
    "/api/shipments",
    requireSession,
    asyncRoute(async (req, res) => {
      const limit = Math.max(
        1,
        Math.min(500, Number.parseInt(req.query.limit, 10) || 50),
      );
      const offset = Math.max(0, Number.parseInt(req.query.offset, 10) || 0);
      const q = String(req.query.q || "")
        .trim()
        .slice(0, 100);
      const status = String(req.query.status || "").trim();
      const conditions = [];
      const params = [];
      if (q) {
        conditions.push(
          "(CAST(s.shipment_number AS CHAR) LIKE ? OR r.loading_city LIKE ? OR r.unloading_city LIKE ?)",
        );
        params.push(`%${q}%`, `%${q}%`, `%${q}%`);
      }
      if (status === "optimized")
        conditions.push("tr.recommended=1 AND tr.feasible=1");
      if (status === "feasible") conditions.push("tr.feasible=1");
      if (status === "review")
        conditions.push("(tr.feasible=0 OR tr.id IS NULL)");
      const where = conditions.length
        ? `WHERE ${conditions.join(" AND ")}`
        : "";
      const [rows] = await pool.execute(
        `SELECT s.id,s.route_id,s.shipment_number,s.loading_date,s.road_delivery_date,s.recipient_deadline,s.weight_kg,s.unit_type,s.adr,r.loading_city,r.unloading_city,
      COALESCE(se.numeric_value,0) AS shipment_extra_time_minutes,COALESCE(re.numeric_value,0) AS route_extra_time_minutes,
      tr.id AS result_id,tr.transport_type,tr.feasible,tr.recommended,tr.total_cost,tr.co2_kg,tr.delivery_date AS result_delivery_date,tr.delivery_time AS result_delivery_time FROM shipments s JOIN routes r ON r.id=s.route_id
      LEFT JOIN parameters se ON se.parameter_code=CONCAT('shipment_extra_time_',REPLACE(s.id,'-',''))
      LEFT JOIN parameters re ON re.parameter_code=CONCAT('route_extra_time_',REPLACE(r.id,'-',''))
      LEFT JOIN transport_results tr ON tr.id=(SELECT t.id FROM transport_results t WHERE t.shipment_id=s.id ORDER BY t.recommended DESC,t.created_at DESC LIMIT 1)
      ${where} ORDER BY s.loading_date DESC,s.id DESC LIMIT ? OFFSET ?`,
        [...params, limit, offset],
      );
      res.json(rows.map(serializeShipment));
    }),
  );

  router.post(
    "/api/shipments/:id/calculate",
    requireSession,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "");
      if (!validId(id))
        return res.status(400).json({ error: "Oznaka pošiljke ni veljavna." });
      try {
        res.json(
          await calculateAndSave(
            id,
            req.body?.transportMode,
            await getPlannerParameters(),
            (
              await pool.query(
                "SELECT id,name,country_code,latitude,longitude,note FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL",
              )
            )[0],
          ),
        );
      } catch (error) {
        res
          .status(422)
          .json({ error: error.message || "Izračun pošiljke ni uspel." });
      }
    }),
  );

  router.get(
    "/api/shipments/:id/compare",
    requireSession,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "");
      if (!validId(id))
        return res.status(400).json({ error: "Oznaka pošiljke ni veljavna." });
      try {
        res.json(
          await calculateAndSave(
            id,
            "COMPARE",
            await getPlannerParameters(),
            (
              await pool.query(
                "SELECT id,name,country_code,latitude,longitude,note FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL",
              )
            )[0],
            true,
          ),
        );
      } catch (error) {
        res
          .status(422)
          .json({
            error:
              error.message || "Primerjave prevozov ni bilo mogoče izračunati.",
          });
      }
    }),
  );

  router.post(
    "/api/shipments/calculate-all",
    requireSession,
    asyncRoute(async (req, res) => {
      const routeId=req.body?.routeId==null?'':String(req.body.routeId);
      const upcomingOnly=req.body?.upcomingOnly===true;
      if(routeId&&!validId(routeId))return res.status(400).json({error:'Relacija za ponovni izračun ni veljavna.'});
      const filters=[],values=[];
      if(routeId){filters.push('route_id=?');values.push(routeId);}
      if(upcomingOnly)filters.push('recipient_deadline>=CURDATE()');
      const where=filters.length?` WHERE ${filters.join(' AND ')}`:'';
      const [[count]] = await pool.execute(`SELECT COUNT(*) AS total FROM shipments${where}`,values);
      const taskId = crypto.randomUUID();
      const task = {
        status: "running",
        total: Number(count.total || 0),
        completed: 0,
        failed: 0,
        errors: [],
        startedAt: new Date().toISOString(),
      };
      calculationTasks.set(taskId, task);
      res.status(202).json({ taskId, total: task.total });
      void (async () => {
        try {
          const params = await getPlannerParameters();
          const [terminals] = await pool.query(
            "SELECT id,name,country_code,latitude,longitude,note FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL",
          );
          const [rows] = await pool.execute(
            `SELECT id FROM shipments${where} ORDER BY shipment_number`,values,
          );
          for (const shipment of rows) {
            try {
              await calculateAndSave(shipment.id, "AUTO", params, terminals);
            } catch (error) {
              task.failed++;
              if (task.errors.length < 10)
                task.errors.push({
                  shipmentId: shipment.id,
                  message: String(error.message || "Izračun ni uspel.").slice(
                    0,
                    250,
                  ),
                });
            }
            task.completed++;
          }
          task.status = "complete";
          task.finishedAt = new Date().toISOString();
        } catch (error) {
          task.status = "failed";
          task.fatalError = String(error.message || "Izračun ni uspel.").slice(
            0,
            250,
          );
        }
      })();
    }),
  );

  router.get(
    "/api/shipments/calculations/:taskId",
    requireSession,
    asyncRoute(async (req, res) => {
      const task = calculationTasks.get(String(req.params.taskId || ""));
      if (!task)
        return res.status(404).json({ error: "Izračuna ni mogoče najti." });
      res.json(task);
    }),
  );

  router.put(
    "/api/shipments/:id",
    requireSession,
    asyncRoute(async (req, res) => {
      const id = String(req.params.id || "");
      const routeId = String(req.body?.routeId || "").trim();
      const loadingDate = String(req.body?.loadingDate || "");
      const deliveryDate = String(req.body?.deliveryDate || "");
      const deadline = String(req.body?.recipientDeadline || "");
      const weight = Number(req.body?.weightKg);
      const unit = String(req.body?.unitType || "").trim();
      const number = Number(req.body?.shipmentNumber);
      if (
        !validId(id) ||
        !routeId ||
        !validDate(loadingDate) ||
        !validDate(deliveryDate) ||
        !validDate(deadline) ||
        deliveryDate < loadingDate ||
        deadline < deliveryDate ||
        !Number.isFinite(weight) ||
        weight <= 0 ||
        weight > 99999999 ||
        !unit ||
        unit.length > 100 ||
        !Number.isInteger(number) ||
        number < 1
      ) {
        return res
          .status(400)
          .json({
            error: "Preverite številko, relacijo, datume, težo in vrsto enote.",
          });
      }
      const [[route]] = await pool.execute(
        "SELECT id,loading_city,unloading_city FROM routes WHERE id=? LIMIT 1",
        [routeId],
      );
      if (!route)
        return res.status(400).json({ error: "Izbrana relacija ne obstaja." });
      const [updated] = await pool.execute(
        `UPDATE shipments SET shipment_number=?,route_id=?,loading_text=?,unloading_text=?,loading_date=?,road_delivery_date=?,recipient_deadline=?,weight_kg=?,unit_type=?,adr=? WHERE id=?`,
        [
          number,
          route.id,
          route.loading_city,
          route.unloading_city,
          loadingDate,
          deliveryDate,
          deadline,
          weight,
          unit,
          req.body?.adr ? 1 : 0,
          id,
        ],
      );
      if (!updated.affectedRows)
        return res.status(404).json({ error: "Pošiljka ne obstaja." });
      res.json({ id, shipmentNumber: number });
    }),
  );

  router.post(
    "/api/shipments",
    requireSession,
    asyncRoute(async (req, res) => {
      const routeId = String(req.body?.routeId || "").trim();
      const loadingDate = String(req.body?.loadingDate || "");
      const deliveryDate = String(req.body?.deliveryDate || "");
      const deadline = String(req.body?.recipientDeadline || "");
      const weight = Number(req.body?.weightKg);
      const unit = String(req.body?.unitType || "").trim();
      if (
        !routeId ||
        !validDate(loadingDate) ||
        !validDate(deliveryDate) ||
        !validDate(deadline) ||
        deliveryDate < loadingDate ||
        deadline < deliveryDate ||
        !Number.isFinite(weight) ||
        weight <= 0 ||
        weight > 99999999 ||
        !unit ||
        unit.length > 100
      ) {
        return res
          .status(400)
          .json({ error: "Preverite relacijo, datume, težo in vrsto enote." });
      }
      const [[route]] = await pool.execute(
        "SELECT id,loading_city,unloading_city FROM routes WHERE id=? LIMIT 1",
        [routeId],
      );
      if (!route)
        return res.status(400).json({ error: "Izbrana relacija ne obstaja." });
      let shipmentNumber = Number(req.body?.shipmentNumber);
      if (!Number.isInteger(shipmentNumber) || shipmentNumber < 1) {
        const [[next]] = await pool.query(
          "SELECT COALESCE(MAX(shipment_number),0)+1 AS number FROM shipments",
        );
        shipmentNumber = Number(next.number);
      }
      try {
        const [result] = await pool.execute(
          `INSERT INTO shipments (shipment_number,route_id,loading_text,unloading_text,loading_date,road_delivery_date,recipient_deadline,weight_kg,unit_type,adr)
        VALUES (?,?,?,?,?,?,?,?,?,?)`,
          [
            shipmentNumber,
            route.id,
            `${route.loading_city}`,
            `${route.unloading_city}`,
            loadingDate,
            deliveryDate,
            deadline,
            weight,
            unit,
            req.body?.adr ? 1 : 0,
          ],
        );
        res
          .status(201)
          .json({
            id: result.insertId,
            shipmentNumber,
            route: `${route.loading_city} → ${route.unloading_city}`,
          });
      } catch (error) {
        if (error.code === "ER_DUP_ENTRY")
          return res
            .status(409)
            .json({ error: "Ta številka pošiljke je že zasedena." });
        throw error;
      }
    }),
  );
  return router;
}

module.exports = createRouter;
