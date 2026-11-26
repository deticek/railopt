const express = require("express");
const { estimateDeliveryPlan } = require("../services/delivery-planner");
const {readJson}=require('../lib/parameter-store');
const trailerCatalog = require('../data/trailer-catalog.json');

function createDeliveryPlansRouter({ pool, requireSession, crypto }) {
  const router = express.Router();
  const pending = new Map();
  const group = "Izračuni dostav";
  function normalizeCatalogEquipment(input) {
    const id=String(input?.equipmentCatalogId||'');
    if(!id)return input;
    const item=trailerCatalog.find(row=>row.id===id);
    if(!item)throw new Error('Izbrane prikolice ni v katalogu.');
    const weight=Number(input.weightKg),gross=Number(item.tare_t)+Number(item.tractor_t)+weight/1000;
    if(!Number.isFinite(weight)||weight<=0||weight>Number(item.payload_t)*1000)throw new Error(`Nosilnost prikolice ${item.name} je ${item.payload_t} t.`);
    if(input.adr&&!item.adr)throw new Error(`${item.name} v katalogu ni označena kot primerna za ADR.`);
    const choice=String(input.selectedTransportMode||'AUTO').toUpperCase();
    const liftable=item.uct!=='ne';
    const rolaEligible=item.length_m<=18.8&&item.width_m<=2.6&&item.height_m<=4&&gross<=(item.category==='zabojnik'?44:40);
    if(choice==='INTERMODAL'&&!liftable)throw new Error(`${item.name} ni dvigljiva enota; za vlak izberi združljivo prikolico.`);
    if(choice==='RO_LA'&&!rolaEligible)throw new Error(`${item.name} ne ustreza omejitvam Ro-La (mere ali skupna masa).`);
    let unitType=String(input.unitType||item.name);
    if(choice==='ROAD') unitType=item.name;
    else if(choice==='RO_LA'||(choice==='AUTO'&&!liftable&&rolaEligible)) unitType='Nedvigljiva prikolica s ponjavo';
    else if(choice==='AUTO'&&!liftable&&!rolaEligible) return {...input,unitType:item.name,equipmentName:item.name,equipmentCatalogId:id,transportMode:'road',catalogWarnings:[`${item.name} presega modelirane omejitve Ro-La; izračunana je samo cesta.`]};
    else if(item.id==='P400') unitType='P400 – dvigljiva prikolica';
    else if(item.id==='ZABOJ1360') unitType='Izmenljivi zaboj';
    else if(item.id==='Z40HC') unitType='Kontejner 40 HC';
    else if(item.id==='Z45PW') unitType='Zabojnik 45′';
    else if(liftable) unitType='P400 – dvigljiva prikolica';
    else unitType='Nedvigljiva prikolica s ponjavo';
    return {...input,unitType,equipmentName:item.name,equipmentCatalogId:id,catalogWarnings:[...(item.uct==='zamenjava'?['Za železniški odsek je potrebna dvigljiva nadomestna enota; pribitek se obračuna v ceni.']:[])]};
  }
  const userId = (user) =>
    String(user?.id || user?.email || "development").slice(0, 254);
  async function loadParameters() {
    const [rows] = await pool.execute(
      "SELECT parameter_code,fixed_value,per_unit_value,numeric_value,text_value FROM parameters WHERE parameter_code IN ('cesta_cena_na_posiljko','cesta_doplacilo_za_nevarno_blago_adr','cesta_povprecna_hitrost_tovornjaka','cesta_pravila_voznje','cesta_cas_naklada_in_razklada','emisije_iso_14083_cesta_ter_dovoz_in_odvoz','kombinirani_prevoz_dovoz_ali_odvoz','kombinirani_prevoz_povprecna_hitrost_dovoza_in_odvoza','kombinirani_prevoz_pretovor_na_terminalu','kombinirani_prevoz_vlak','kombinirani_prevoz_dolzina_zelezniske_poti','kombinirani_prevoz_doplacilo_za_nevarno_blago_rid','kombinirani_prevoz_pribitek_za_dvigljivo_enoto','kombinirani_prevoz_oddaja_in_prevzem_enote_na_terminalu','kombinirani_prevoz_rezerva_za_zamudo_vlaka','ro_la_cena_ro_la','emisije_iso_14083_vlak_elektrovleka','emisije_iso_14083_ro_la_tovornjak_na_vlaku')",
    );
    return new Map(rows.map((row) => [row.parameter_code, row]));
  }
  function closestTerminal(place, terminals) {
    const lat = Number(place?.lat);
    const lon = Number(place?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    const closest = terminals.reduce((nearest, terminal) => {
      const terminalLat = Number(terminal.latitude);
      const terminalLon = Number(terminal.longitude);
      const dLat = ((terminalLat - lat) * Math.PI) / 180;
      const dLon = ((terminalLon - lon) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat * Math.PI) / 180) *
          Math.cos((terminalLat * Math.PI) / 180) *
          Math.sin(dLon / 2) ** 2;
      const distance = 6371 * 2 * Math.asin(Math.sqrt(a));
      return !nearest || distance < nearest.distance
        ? { distance, terminal }
        : nearest;
    }, null);
    if (!closest) return null;
    const terminal = closest.terminal;
    return {
      label: terminal.name,
      lat: Number(terminal.latitude),
      lon: Number(terminal.longitude),
      countryCode: terminal.country_code || null,
    };
  }
  async function useDatabaseTerminals(input) {
    input=normalizeCatalogEquipment(input);
    const unit = String(input.unitType || '').toLocaleLowerCase('sl');
    const unitKind = unit.includes('p400') ? 'P400'
      : unit.includes('zabojnik') || unit.includes('container') || unit.includes('kontejner') || /zaboj\s*45/.test(unit) ? 'CONTAINER'
      : unit.includes('izmenljivi') || unit.includes('swap') ? 'SWAP_BODY' : null;
    let terminals;
    if(unitKind){
      try{[terminals]=await pool.execute("SELECT CONCAT(name,' (',city,')') AS name,country_code,latitude,longitude FROM unit_terminals WHERE unit_type=? AND active=1 AND latitude IS NOT NULL AND longitude IS NOT NULL",[unitKind]);}
      catch(error){if(error.code!=='ER_NO_SUCH_TABLE')throw error;const rows=await readJson(pool,'app_unit_terminals_catalog')||[];terminals=rows.filter(row=>row.unitType===unitKind&&row.active!==false&&row.latitude!=null&&row.longitude!=null).map(row=>({name:row.name,country_code:row.countryCode,latitude:row.latitude,longitude:row.longitude}));}
    }else [terminals]=await pool.execute("SELECT name,country_code,latitude,longitude FROM terminals WHERE latitude IS NOT NULL AND longitude IS NOT NULL");
    const terminalOrigin = closestTerminal(input.origin, terminals);
    const terminalDestination = closestTerminal(input.destination, terminals);
    if (
      input.transportMode === "compare" &&
      (!terminalOrigin || !terminalDestination)
    ) {
      throw new Error(
        "Za primerjavo prevozov ni mogoče najti ustreznih terminalov v bazi. Preveri lokaciji in koordinate terminalov.",
      );
    }
    return {
      ...input,
      terminalOrigin,
      terminalDestination,
    };
  }
  function validPlan(body) {
    const label = (value) =>
      String(typeof value === "string" ? value : value?.label || "").trim();
    const validDateTime = (value) =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(value || "")) &&
      !Number.isNaN(new Date(value).getTime());
    const weight = Number(body?.weightKg);
    const catalogItem=trailerCatalog.find(row=>row.id===String(body?.equipmentCatalogId||''));
    const maxWeight=catalogItem?Number(catalogItem.payload_t)*1000:24000;
    const extraTime = Number(body?.extraTimeMinutes ?? 0);
    const globalExtraTime = Number(body?.globalExtraTimeMinutes ?? 0);
    const hasPoint = (place) =>
      place?.lat !== null &&
      place?.lat !== undefined &&
      place?.lon !== null &&
      place?.lon !== undefined &&
      Number.isFinite(Number(place.lat)) &&
      Number.isFinite(Number(place.lon));
    return (
      label(body?.origin).length >= 2 &&
      label(body?.origin).length <= 500 &&
      hasPoint(body?.origin) &&
      label(body?.destination).length >= 2 &&
      label(body?.destination).length <= 500 &&
      hasPoint(body?.destination) &&
      validDateTime(body?.loadingAt) &&
      validDateTime(body?.deliveryDeadlineAt) &&
      new Date(body.deliveryDeadlineAt) > new Date(body.loadingAt) &&
      Number.isFinite(weight) &&
      weight > 0 &&
      weight <= maxWeight &&
      String(body?.unitType || "").length <= 100 &&
      Number.isInteger(extraTime) &&
      extraTime >= 0 &&
      extraTime <= 720 &&
      Number.isInteger(globalExtraTime) &&
      globalExtraTime >= 0 &&
      globalExtraTime <= 720
    );
  }
  function planValidationMessage(body, fallback) {
    const unit = String(body?.unitType || "").toLocaleLowerCase("sl-SI");
    const weight = Number(body?.weightKg);
    if (!body?.equipmentCatalogId && (unit.includes("zabojnik 45") || /zaboj\s*45/.test(unit)) && weight > 22000)
      return "Za zabojnik 45′ je največja teža tovora 22.000 kg.";
    if (!body?.equipmentCatalogId && unit.includes("izmenljivi zaboj") && weight > 23000)
      return "Za izmenljivi zaboj je največja teža tovora 23.000 kg.";
    return validPlan(body) ? null : fallback;
  }
  function applySelectedTransport(input, result) {
    const choice = String(input?.selectedTransportMode || 'AUTO').toUpperCase();
    if (!['AUTO','ROAD','INTERMODAL','RO_LA'].includes(choice))
      throw new Error('Izbran način prevoza ni veljaven.');
    const unit = String(input?.unitType || '').toLocaleLowerCase('sl-SI');
    const liftable = /p400|izmenljivi zaboj|zabojnik (?:40|45)|zaboj\s*45|kontejner/.test(unit);
    const rola = /nedvigljiv|ponjav|tovornjak/.test(unit);
    if (choice === 'INTERMODAL' && !liftable)
      throw new Error('Kombinirani vlak je na voljo samo za dvigljive enote (P400, zaboj ali kontejner).');
    if (choice === 'RO_LA' && !rola)
      throw new Error('Ro-La je na voljo za tovornjak oziroma nedvigljivo prikolico.');
    if (choice === 'ROAD') result.options = result.options.filter(option => option.id === 'road');
    if (choice === 'INTERMODAL') result.options = result.options.filter(option => option.id === 'rail');
    if (choice === 'RO_LA') result.options = result.options.filter(option => option.id === 'rola');
    if (!result.options.length)
      throw new Error('Za izbrano enoto in način prevoza ni mogoče sestaviti izvedljive možnosti.');
    if (choice !== 'AUTO') result.recommendedOptionId = result.options[0].id;
    if(input.equipmentName)result.unitType=input.equipmentName;
    if(input.catalogWarnings?.length)result.warnings=[...(result.warnings||[]),...input.catalogWarnings];
    return result;
  }
  function localDateTimeInput(value) {
    const date=new Date(value);
    if(Number.isNaN(date.getTime()))return String(value||'').slice(0,16);
    const pad=n=>String(n).padStart(2,'0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }
  function normalizeRow(row, storage = "normalized") {
    const objectValue = (value) => {
      if (typeof value === "string") {
        try {
          value = JSON.parse(value);
        } catch {
          return {};
        }
      }
      return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
    };
    const savedInput = objectValue(row.input_json ?? row.input);
    const savedResult = objectValue(row.result_json ?? row.result);
    // Older saves wrapped the actual planner payload in another input/result
    // object. Flatten it so both current and legacy rows hydrate the same form.
    const input = { ...savedInput, ...objectValue(savedInput.input) };
    const result = { ...savedResult, ...objectValue(savedResult.result) };
    const wallClock = (value) => {
      if (value instanceof Date)
        return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}T${String(value.getHours()).padStart(2, "0")}:${String(value.getMinutes()).padStart(2, "0")}`;
      const text = String(value || "");
      const match = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      return match ? `${match[1]}T${match[2]}` : text;
    };
    const inputOrigin = objectValue(input.origin);
    const inputDestination = objectValue(input.destination);
    const resultOrigin = objectValue(result.origin);
    const resultDestination = objectValue(result.destination);
    const origin = {
      ...resultOrigin,
      ...inputOrigin,
      label: inputOrigin.label || resultOrigin.label || row.origin_label || "",
      lat: inputOrigin.lat ?? resultOrigin.lat ?? row.origin_lat ?? null,
      lon: inputOrigin.lon ?? resultOrigin.lon ?? row.origin_lon ?? null,
      countryCode:
        inputOrigin.countryCode ??
        resultOrigin.countryCode ??
        row.origin_country ??
        null,
    };
    const destination = {
      ...resultDestination,
      ...inputDestination,
      label:
        inputDestination.label ||
        resultDestination.label ||
        row.destination_label ||
        "",
      lat:
        inputDestination.lat ??
        resultDestination.lat ??
        row.destination_lat ??
        null,
      lon:
        inputDestination.lon ??
        resultDestination.lon ??
        row.destination_lon ??
        null,
      countryCode:
        inputDestination.countryCode ??
        resultDestination.countryCode ??
        row.destination_country ??
        null,
    };
    const loadingAt = wallClock(
      input.loadingAt ||
        result.requestedLoadingAt ||
        row.loading_at ||
        result.actualLoadingAt,
    );
    const deadlineAt = wallClock(
      input.deliveryDeadlineAt || row.delivery_deadline_at || result.deadlineAt,
    );
    const weightKg = Number(
      input.weightKg ?? row.weight_kg ?? result.weightKg ?? 0,
    );
    const unitType = input.unitType || row.unit_type || result.unitType || "";
    // Fill normalized values back into the planner input, preserving every
    // saved planner-specific field (terminals, windows, cost details, etc.).
    Object.assign(input, {
      origin,
      destination,
      loadingAt: input.loadingAt || loadingAt,
      deliveryDeadlineAt: input.deliveryDeadlineAt || deadlineAt,
      weightKg: input.weightKg ?? weightKg,
      unitType: input.unitType || unitType,
      adr: input.adr ?? Boolean(row.adr ?? result.adr ?? false),
      costMode: input.costMode || row.cost_mode || result.cost?.mode || "excel",
    });
    return {
      id: row.id,
      origin: origin.label,
      destination: destination.label,
      loadingAt,
      deadlineAt,
      weightKg,
      unitType,
      costMode: row.cost_mode || input.costMode || result?.cost?.mode,
      createdAt: row.created_at || row.createdAt,
      input,
      result: { ...result, origin, destination },
      storage,
    };
  }
  async function persistSnapshot(snapshot) {
    const code = `delivery_plan_${snapshot.id.replaceAll("-", "")}`;
    await pool.execute(
      `INSERT INTO parameters (parameter_code,parameter_group,parameter_name,numeric_value,unit,text_value,source_note) VALUES (?,?,?,NULL,NULL,?,?)`,
      [
        code,
        group,
        `${snapshot.input.origin.label} → ${snapshot.input.destination.label}`.slice(
          0,
          200,
        ),
        JSON.stringify(snapshot),
        `created_by:${snapshot.createdBy}`,
      ],
    );
  }
  async function listSnapshots(owner) {
    const [rows] = await pool.execute(
      "SELECT parameter_code,text_value,source_note FROM parameters WHERE parameter_group=? AND source_note=?",
      [group, `created_by:${owner}`],
    );
    return rows
      .map((row) => {
        try {
          return JSON.parse(row.text_value);
        } catch {
          return null;
        }
      })
      .filter((snapshot) => snapshot && snapshot.id)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .slice(0, 30)
      .map((snapshot) =>
        normalizeRow(
          {
            ...snapshot,
            id: snapshot.id,
            input_json: snapshot.input,
            result_json: snapshot.result,
            createdAt: snapshot.createdAt,
          },
          "parameters",
        ),
      );
  }
  router.post(
    "/delivery-plans/estimate",
    requireSession,
    async (req, res, next) => {
      try {
        const validationMessage = planValidationMessage(
          req.body,
          req.body?.transportMode === "compare"
            ? "Samodejno iskanje tovornih terminalov ni uspelo. Preveri izbrani lokaciji, datume in težo."
            : "Preveri lokaciji, termin, rok, težo in dodatni čas (0–720 minut).",
        );
        if (validationMessage)
          return res
            .status(400)
            .json({ error: validationMessage });
        const input = await useDatabaseTerminals(req.body);
        const result = applySelectedTransport(input, await estimateDeliveryPlan(input, {
          pool,
          params: await loadParameters(),
        }));
        const estimateId = crypto.randomUUID();
        const owner = userId(req.user);
        for (const [key, value] of pending)
          if (value.expiresAt <= Date.now()) pending.delete(key);
        pending.set(estimateId, {
          owner,
          input,
          result,
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
        res.json({ estimateId, result });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/delivery-plans/latest-loading",
    requireSession,
    async (req, res, next) => {
      try {
        const validationMessage = planValidationMessage(
          req.body,
          "Preveri lokaciji, rok dostave, težo in dodatni čas.",
        );
        if (validationMessage)
          return res
            .status(400)
            .json({ error: validationMessage });
        const earliest = new Date(req.body.loadingAt);
        const deadline = new Date(req.body.deliveryDeadlineAt);
        if (deadline - earliest > 90 * 24 * 60 * 60 * 1000)
          return res
            .status(400)
            .json({
              error:
                "Za iskanje najkasnejšega naklada izberi obdobje največ 90 dni.",
            });
        const params = await loadParameters();
        const owner = userId(req.user);
        const baseInput = await useDatabaseTerminals(req.body);
        const evaluate = async (epoch) => {
          const date = new Date(epoch);
          const input = {
            ...baseInput,
            loadingAt: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
          };
          const result = applySelectedTransport(input, await estimateDeliveryPlan(input, { pool, params }));
          return {
            input,
            result,
            feasible: result.options.some(
              (option) =>
                (input.transportMode === "compare" || option.id === "road") &&
                option.feasible,
            ),
          };
        };
        let earliestResult = await evaluate(earliest.getTime());
        if (!earliestResult.feasible)
          return res
            .status(422)
            .json({
              error:
                "Tudi najzgodnejši izbrani naklad ne doseže roka. Premakni začetek iskanja bolj nazaj.",
            });
        let low = earliest.getTime(),
          high = deadline.getTime() - 60000,
          best = earliestResult;
        for (let i = 0; i < 23 && high - low > 60000; i++) {
          let middle = Math.floor((low + high) / 120000) * 60000 + 60000;
          if (middle <= low) middle = low + 60000;
          if (middle > high) middle = high;
          const candidate = await evaluate(middle);
          if (candidate.feasible) {
            low = middle;
            best = candidate;
          } else high = middle - 60000;
        }
        // Show and save the actual normalized start of loading. The requested
        // delivery deadline remains unchanged; only this loading time moves.
        best.input.loadingAt = localDateTimeInput(best.result.actualLoadingAt);
        const estimateId = crypto.randomUUID();
        pending.set(estimateId, {
          owner,
          input: best.input,
          result: best.result,
          expiresAt: Date.now() + 15 * 60 * 1000,
        });
        res.json({
          estimateId,
          latestLoadingAt: best.input.loadingAt,
          result: best.result,
        });
      } catch (error) {
        next(error);
      }
    },
  );
  router.post(
    "/delivery-plans/save",
    requireSession,
    async (req, res, next) => {
      try {
        const estimateId = String(req.body?.estimateId || "");
        const estimate = pending.get(estimateId);
        if (
          !estimate ||
          estimate.expiresAt <= Date.now() ||
          estimate.owner !== userId(req.user)
        )
          return res
            .status(410)
            .json({
              error: "Izračun je potekel. Izračunaj ga znova in nato shrani.",
            });
        const chosen = String(req.body?.selectedOptionId || "");
        const selectedOptionId = estimate.result.options?.some(
          (option) => option.id === chosen,
        )
          ? chosen
          : estimate.result.recommendedOptionId || "road";
        const savedResult = { ...estimate.result, selectedOptionId };
        const snapshot = {
          id: estimateId,
          createdBy: estimate.owner,
          createdAt: new Date().toISOString(),
          input: estimate.input,
          result: savedResult,
        };
        let storage = "normalized";
        try {
          const r = estimate.result;
          await pool.execute(
            `INSERT INTO delivery_plans (id,created_by,origin_label,origin_country,origin_lat,origin_lon,destination_label,destination_country,destination_lat,destination_lon,loading_at,delivery_deadline_at,weight_kg,unit_type,adr,cost_mode,input_json,result_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            [
              estimateId,
              estimate.owner,
              r.origin.label,
              r.origin.countryCode,
              r.origin.lat,
              r.origin.lon,
              r.destination.label,
              r.destination.countryCode,
              r.destination.lat,
              r.destination.lon,
              new Date(r.actualLoadingAt),
              new Date(r.deadlineAt),
              r.weightKg,
              r.unitType,
              r.adr ? 1 : 0,
              r.cost.mode,
              JSON.stringify(estimate.input),
              JSON.stringify(savedResult),
            ],
          );
        } catch (error) {
          if (
            !["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(
              error.code,
            )
          )
            throw error;
          await persistSnapshot(snapshot);
          storage = "parameters";
        }
        pending.delete(estimateId);
        res.status(201).json({ id: estimateId, saved: true, storage });
      } catch (error) {
        next(error);
      }
    },
  );
  router.put("/delivery-plans/:id", requireSession, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      const owner = userId(req.user);
      const isAdmin = Number(req.user?.role) === 1;
      const validationMessage = planValidationMessage(
        req.body,
        "Preveri lokaciji, termin, rok, težo in dodatni čas (0–720 minut).",
      );
      if (!/^[0-9a-f-]{36}$/i.test(id) || validationMessage)
        return res
          .status(400)
          .json({ error: validationMessage || "ID relacije ni veljaven." });
      const selectedOptionId = String(req.body?.selectedOptionId || "");
      const input = { ...req.body };
      delete input.selectedOptionId;
      const normalizedInput = await useDatabaseTerminals(input);
      const result = applySelectedTransport(normalizedInput, await estimateDeliveryPlan(normalizedInput, {
        pool,
        params: await loadParameters(),
      }));
      const chosen = result.options?.some(
        (option) => option.id === selectedOptionId,
      )
        ? selectedOptionId
        : result.recommendedOptionId || result.options?.[0]?.id;
      const savedResult = { ...result, selectedOptionId: chosen };
      const snapshot = {
        id,
        createdBy: owner,
        createdAt: new Date().toISOString(),
        input: normalizedInput,
        result: savedResult,
      };
      let storage = "normalized";
      try {
        const [rows] = await pool.execute(
          "SELECT id,created_by FROM delivery_plans WHERE id=? AND (created_by=? OR ?=1) LIMIT 1",
          [id, owner, isAdmin ? 1 : 0],
        );
        if (!rows.length)
          return res
            .status(404)
            .json({ error: "Načrtovane relacije ni mogoče najti." });
        snapshot.createdBy = String(rows[0].created_by || owner);
        await pool.execute(
          `UPDATE delivery_plans SET origin_label=?,origin_country=?,origin_lat=?,origin_lon=?,destination_label=?,destination_country=?,destination_lat=?,destination_lon=?,loading_at=?,delivery_deadline_at=?,weight_kg=?,unit_type=?,adr=?,cost_mode=?,input_json=?,result_json=? WHERE id=? AND (created_by=? OR ?=1)`,
          [
            result.origin.label,
            result.origin.countryCode,
            result.origin.lat,
            result.origin.lon,
            result.destination.label,
            result.destination.countryCode,
            result.destination.lat,
            result.destination.lon,
            new Date(result.actualLoadingAt),
            new Date(result.deadlineAt),
            result.weightKg,
            result.unitType,
            result.adr ? 1 : 0,
            result.cost.mode,
            JSON.stringify(normalizedInput),
            JSON.stringify(savedResult),
            id,
            owner,
            isAdmin ? 1 : 0,
          ],
        );
      } catch (error) {
        if (
          !["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(
            error.code,
          )
        )
          throw error;
        storage = "parameters";
        const code = `delivery_plan_${id.replaceAll("-", "")}`;
        const [rows] = await pool.execute(
          "SELECT source_note,text_value FROM parameters WHERE parameter_code=? LIMIT 1",
          [code],
        );
        let originalOwner = rows[0]?.source_note?.replace(/^created_by:/, '');
        if (isAdmin && rows.length) {
          try { originalOwner = JSON.parse(rows[0].text_value || '{}').createdBy || originalOwner; } catch {}
        }
        if (!rows.length || (!isAdmin && originalOwner !== owner))
          return res
            .status(404)
            .json({ error: "Načrtovane relacije ni mogoče najti." });
        snapshot.createdBy = originalOwner || owner;
        await pool.execute(
          "UPDATE parameters SET parameter_name=?,text_value=? WHERE parameter_code=? AND source_note=?",
          [
            `${normalizedInput.origin.label} → ${normalizedInput.destination.label}`.slice(
              0,
              200,
            ),
            JSON.stringify(snapshot),
            code,
            rows[0].source_note,
          ],
        );
      }
      res.json(
        normalizeRow(
          {
            id,
            origin_label: result.origin.label,
            destination_label: result.destination.label,
            loading_at: result.actualLoadingAt,
            delivery_deadline_at: result.deadlineAt,
            weight_kg: result.weightKg,
            unit_type: result.unitType,
            cost_mode: result.cost.mode,
            createdAt: snapshot.createdAt,
            input_json: normalizedInput,
            result_json: savedResult,
          },
          storage,
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/delivery-plans", requireSession, async (req, res, next) => {
    try {
      try {
        const [rows] = await pool.execute(
          "SELECT id,origin_label,origin_country,origin_lat,origin_lon,destination_label,destination_country,destination_lat,destination_lon,loading_at,delivery_deadline_at,weight_kg,unit_type,adr,cost_mode,created_at,input_json,result_json FROM delivery_plans WHERE created_by=? ORDER BY created_at DESC LIMIT 30",
          [userId(req.user)],
        );
        res.json(rows.map((row) => normalizeRow(row)));
      } catch (error) {
        if (
          !["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(
            error.code,
          )
        )
          throw error;
        res.json(await listSnapshots(userId(req.user)));
      }
    } catch (error) {
      next(error);
    }
  });
  router.get("/delivery-plans/all", requireSession, async (req, res, next) => {
    try {
      let plans;
      try {
        const [rows] = await pool.execute(
          "SELECT id,origin_label,origin_country,origin_lat,origin_lon,destination_label,destination_country,destination_lat,destination_lon,loading_at,delivery_deadline_at,weight_kg,unit_type,adr,cost_mode,created_at,input_json,result_json FROM delivery_plans ORDER BY created_at DESC LIMIT 500",
        );
        plans = rows.map((row) => normalizeRow(row));
      } catch (error) {
        if (
          !["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(
            error.code,
          )
        )
          throw error;
        const [rows] = await pool.execute(
          "SELECT text_value FROM parameters WHERE parameter_group=? AND source_note LIKE 'created_by:%'",
          [group],
        );
        plans = rows
          .map((row) => {
            try {
              const snapshot = JSON.parse(row.text_value);
              return normalizeRow(
                {
                  ...snapshot,
                  id: snapshot.id,
                  input_json: snapshot.input,
                  result_json: snapshot.result,
                  createdAt: snapshot.createdAt,
                },
                "parameters",
              );
            } catch {
              return null;
            }
          })
          .filter(Boolean);
      }
      res.json(
        plans.sort((a, b) =>
          String(b.createdAt).localeCompare(String(a.createdAt)),
        ),
      );
    } catch (error) {
      next(error);
    }
  });
  router.get("/delivery-plans/:id", requireSession, async (req, res, next) => {
    try {
      const id = String(req.params.id || "");
      if (!/^[0-9a-f-]{36}$/i.test(id))
        return res
          .status(404)
          .json({ error: "Načrtovane relacije ni mogoče najti." });
      try {
        const [rows] = await pool.execute(
          "SELECT id,origin_label,origin_country,origin_lat,origin_lon,destination_label,destination_country,destination_lat,destination_lon,loading_at,delivery_deadline_at,weight_kg,unit_type,adr,cost_mode,created_at,input_json,result_json FROM delivery_plans WHERE id=? LIMIT 1",
          [id],
        );
        if (!rows.length)
          return res
            .status(404)
            .json({ error: "Načrtovane relacije ni mogoče najti." });
        return res.json(normalizeRow(rows[0]));
      } catch (error) {
        if (
          !["ER_NO_SUCH_TABLE", "ER_TABLEACCESS_DENIED_ERROR"].includes(
            error.code,
          )
        )
          throw error;
        const code = `delivery_plan_${id.replaceAll("-", "")}`;
        const [rows] = await pool.execute(
          "SELECT text_value,source_note FROM parameters WHERE parameter_code=? LIMIT 1",
          [code],
        );
        if (
          !rows.length ||
          !String(rows[0].source_note || "").startsWith("created_by:")
        )
          return res
            .status(404)
            .json({ error: "Načrtovane relacije ni mogoče najti." });
        const snapshot = objectSnapshot(rows[0].text_value);
        if (!snapshot)
          return res
            .status(404)
            .json({ error: "Shranjeni podatki relacije niso berljivi." });
        return res.json(
          normalizeRow(
            {
              ...snapshot,
              id,
              input_json: snapshot.input,
              result_json: snapshot.result,
              createdAt: snapshot.createdAt,
            },
            "parameters",
          ),
        );
      }
    } catch (error) {
      next(error);
    }
  });
  return router;
}
function objectSnapshot(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
module.exports = createDeliveryPlansRouter;
