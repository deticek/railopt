const express = require("express");

function createAuthRouter(deps) {
  const router = express.Router();
  const {
    authPool,
    sessions,
    administrator,
    databaseUsersEnabled,
    userSchema,
    userColumn,
    normalizeRole,
    bcryptRounds,
    bcrypt,
    crypto,
    requireSession,
    asyncRoute,
  } = deps;
  router.post(
    "/api/auth/login",
    asyncRoute(async (req, res) => {
      const email = String(req.body?.email || "")
        .trim()
        .toLowerCase();
      const password = String(req.body?.password || "");
      if (
        !email ||
        !/^\S+@\S+\.\S+$/.test(email) ||
        !password ||
        password.length > 256
      ) {
        return res
          .status(400)
          .json({ error: "Vnesite veljaven e-poštni naslov in geslo." });
      }
      let account = administrator;
      if (databaseUsersEnabled) {
        const active = userSchema.hasActive ? "active" : "TRUE";
        const [rows] = await authPool.execute(
          `SELECT id,username,email,${userColumn(userSchema.password)} AS password_hash,role,${active} AS active FROM users WHERE email=? LIMIT 1`,
          [email],
        );
        account = rows[0]
          ? {
              ...rows[0],
              name: rows[0].username,
              passwordHash: rows[0].password_hash,
              role: normalizeRole(rows[0].role),
            }
          : null;
      }
      if (!account || (!account.active && databaseUsersEnabled)) {
        return res
          .status(401)
          .json({ error: "Napačen e-poštni naslov ali geslo." });
      }
      const passwordMatches = await bcrypt.compare(
        password,
        account.passwordHash,
      );
      if (!passwordMatches)
        return res
          .status(401)
          .json({ error: "Napačen e-poštni naslov ali geslo." });
      if (
        databaseUsersEnabled &&
        bcrypt.getRounds(account.passwordHash) > bcryptRounds
      ) {
        const updatedHash = await bcrypt.hash(password, bcryptRounds);
        await authPool.execute(
          `UPDATE users SET ${userColumn(userSchema.password)}=? WHERE id=?`,
          [updatedHash, account.id],
        );
      }
      const token = crypto.randomBytes(32).toString("base64url");
      const user = {
        id: account.id || null,
        username:
          account.username || process.env.RAILOPT_ADMIN_USERNAME || "admin",
        email: account.email,
        name: account.name || account.username,
        role: Number(account.role || 1),
      };
      sessions.set(crypto.createHash("sha256").update(token).digest("hex"), {
        expiresAt: Date.now() + 12 * 60 * 60 * 1000,
        user,
      });
      res.json({ token, expiresIn: 43200, user });
    }),
  );

  router.post("/api/auth/dev-session", (req, res) => {
    if (process.env.NODE_ENV === "production")
      return res.status(404).json({ error: "Razvojna prijava ni na voljo." });
    const token = crypto.randomBytes(32).toString("base64url");
    const user = {
      id: "development",
      username: "developer",
      email: "developer@localhost",
      name: "Razvojni uporabnik",
      role: 1,
    };
    sessions.set(crypto.createHash("sha256").update(token).digest("hex"), {
      expiresAt: Date.now() + 12 * 60 * 60 * 1000,
      user,
    });
    res.json({ token, expiresIn: 43200, user });
  });

  router.post(
    "/api/auth/logout",
    requireSession,
    asyncRoute(async (req, res) => {
      const token = String(req.headers.authorization).replace(
        /^Bearer\s+/i,
        "",
      );
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      sessions.delete(hash);
      res.status(204).end();
    }),
  );
  router.get("/api/auth/me", requireSession, (req, res) => res.json(req.user));
  return router;
}

module.exports = createAuthRouter;
