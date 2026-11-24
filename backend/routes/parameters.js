const express = require("express");

function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, asyncRoute, crypto } = deps;
  router.get(
    "/api/parameters",
    requireSession,
    asyncRoute(async (_req, res) => {
      const [rows] = await pool.query(
        "SELECT parameter_code,parameter_group,parameter_name,fixed_value,per_unit_value,numeric_value,unit,text_value,source_note FROM parameters WHERE parameter_group NOT IN ('Excel dokumentacija','Izračuni dostav') ORDER BY parameter_group,parameter_name",
      );
      res.json(rows);
    }),
  );

  router.post(
    "/api/parameters",
    requireSession,
    asyncRoute(async (req, res) => {
      const group = String(req.body?.group || "").trim();
      const name = String(req.body?.name || "").trim();
      const rawValue = String(req.body?.value || "").trim();
      const unit = String(req.body?.unit || "").trim();
      const note = String(req.body?.note || "").trim();
      if (
        !group ||
        group.length > 100 ||
        !name ||
        name.length > 200 ||
        !rawValue ||
        rawValue.length > 2000 ||
        unit.length > 50 ||
        note.length > 2000
      )
        return res
          .status(400)
          .json({ error: "Izpolnite skupino, naziv in vrednost parametra." });
      const numberMatch = rawValue
        .replace(/\s/g, "")
        .match(/^(-?\d+(?:[,.]\d+)?)(?:\+(-?\d+(?:[,.]\d+)?))?$/);
      const fixed = numberMatch?.[2]
        ? Number(numberMatch[1].replace(",", "."))
        : null;
      const perUnit = numberMatch?.[2]
        ? Number(numberMatch[2].replace(",", "."))
        : null;
      const numeric =
        numberMatch && !numberMatch[2]
          ? Number(numberMatch[1].replace(",", "."))
          : null;
      const code = `manual_${crypto.randomUUID()}`;
      await pool.execute(
        `INSERT INTO parameters (parameter_code,parameter_group,parameter_name,fixed_value,per_unit_value,numeric_value,unit,text_value,source_note)
      VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          code,
          group,
          name,
          fixed,
          perUnit,
          numeric,
          unit || null,
          numberMatch ? null : rawValue,
          note || null,
        ],
      );
      res.status(201).json({ parameterCode: code });
    }),
  );
  return router;
}

module.exports = createRouter;
