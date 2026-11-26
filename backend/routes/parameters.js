const express = require("express");

function createRouter(deps) {
  const router = express.Router();
  const { pool, requireSession, requireAdmin, asyncRoute, crypto } = deps;
  router.get(
    "/api/parameters",
    requireSession,
    asyncRoute(async (_req, res) => {
      const [rows] = await pool.query(
        `SELECT parameter_code,parameter_group,parameter_name,fixed_value,per_unit_value,numeric_value,unit,text_value,source_note FROM parameters
         WHERE parameter_group NOT IN ('Excel dokumentacija','Izračuni dostav','Revizijski dnevnik','Ro-La','Terminali','Lokalni vozni red')
         AND LOWER(CONCAT(parameter_group,' ',parameter_name,' ',parameter_code)) NOT REGEXP 'revizijski|audit|ro-la|rola|terminal|lokalni vozni red|vozni red'
         ORDER BY parameter_group,parameter_name`,
      );
      res.json(rows);
    }),
  );

  router.post(
    "/api/parameters",
    requireSession, requireAdmin,
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
  router.put('/api/parameters/:code', requireSession, requireAdmin, asyncRoute(async (req,res)=>{
    const code=String(req.params.code||'');
    const raw=String(req.body?.value??'').trim();
    if(!/^[a-zA-Z0-9_.-]{1,120}$/.test(code)||!raw||raw.length>2000)return res.status(400).json({error:'Vrednost parametra ni veljavna.'});
    const numberMatch=raw.replace(/\s/g,'').match(/^(-?\d+(?:[,.]\d+)?)(?:\+(-?\d+(?:[,.]\d+)?))?$/);
    const fixed=numberMatch?.[2]?Number(numberMatch[1].replace(',','.')):null;
    const perUnit=numberMatch?.[2]?Number(numberMatch[2].replace(',','.')):null;
    const numeric=numberMatch&&!numberMatch[2]?Number(numberMatch[1].replace(',','.')):null;
    const [result]=await pool.execute("UPDATE parameters SET fixed_value=?,per_unit_value=?,numeric_value=?,text_value=? WHERE parameter_code=? AND parameter_group NOT IN ('Excel dokumentacija','Izračuni dostav','Revizijski dnevnik','Ro-La','Terminali','Lokalni vozni red') AND LOWER(CONCAT(parameter_group,' ',parameter_name,' ',parameter_code)) NOT REGEXP 'revizijski|audit|ro-la|rola|terminal|lokalni vozni red|vozni red'",[fixed,perUnit,numeric,numberMatch?null:raw,code]);
    if(!result.affectedRows)return res.status(404).json({error:'Parametra ni mogoče najti ali pa ni urejljiv.'});
    res.json({parameterCode:code,value:raw});
  }));
  return router;
}

module.exports = createRouter;
