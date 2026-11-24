const express = require("express");

function createHealthRouter({ pool, authPool, asyncRoute }) {
  const router = express.Router();
  router.get(
    "/health",
    asyncRoute(async (_req, res) => {
      await Promise.all([pool.query("SELECT 1"), authPool.query("SELECT 1")]);
      res.json({ status: "ok" });
    }),
  );
  return router;
}

module.exports = createHealthRouter;
