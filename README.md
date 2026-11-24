# Railopt · Transport Intelligence

Electron desktop app with an Angular dashboard and local API. The interface is in Slovenian and keeps the existing Electron framework and MySQL transport schema.

## Start

1. Start MySQL and make the existing `railopt` database available.
2. Run `npm install` in the project root, `frontend`, and `backend` once.
3. Configure the transport database and login database connections in the private, Git-ignored `backend/.env` file.
4. Run `npm run dev` from the project root to start the API, Angular preview, and Electron desktop window.

The API runs at `http://localhost:8080`; the Angular preview runs at `http://localhost:4200`. Run `npm run build` in the project root to build the Windows installer. The installer bundles the Electron interface; deploy the API separately with `backend/.env` kept private.

The complete Excel workbook is imported with `npm run import:excel` (or `node backend/import_excel.js <pot-do-xlsx>`). Import can be repeated safely: it updates existing rows by route code, shipment number, parameter code, and country/date/name. Operational rows go into their matching tables; the instructions and column descriptions are preserved as text records in `parameters` and are never executed.

The current transport data lives in MySQL database `railopt`; login accounts live in `MYSQL_AUTH_DATABASE` (currently `prevozi`). Dashboard totals, shipment list, and route list read from `railopt`. User passwords are stored as bcrypt hashes. Role IDs are numeric: `1` administrator and `2` standard user. User IDs are UUIDs.

The existing `prevozi.users` table is used for login. Add accounts from Settings → Users; login uses email. The **Vnos podatkov** screen adds shipments, routes, parameters, and holidays directly to MySQL. The password column contains bcrypt hashes. Use numeric roles `1` (administrator) and `2` (standard user). The DDL migration in `migrations/001_uuid_users.sql` is only needed if converting the separate `railopt` transport table IDs to UUIDs.

The Angular shell uses a dedicated sidebar component and router; the emissions page and its API client are isolated under `frontend/src/app/features/emissions` and `frontend/src/app/core/api`. Backend API groups each have a router under `backend/routes` (auth, users, dashboard, shipments, routes, parameters, holidays, health, and emissions); connection setup and shared middleware stay in `backend/server.js`.

The **Vnos podatkov** page saves new shipments, routes, parameters, and holidays through authenticated API clients. The CO₂e page geocodes arbitrary city names through Photon and requests a driving route, then multiplies route tkm by `0.095 kg CO₂e/tkm`. Place results are cached in memory for the API process and limited to one geocoding request per second. First-time searches need an internet connection; external lookup failures return within a bounded timeout. Road distance uses the fastest car road route and may not reflect truck-specific restrictions. OpenStreetMap data attribution is displayed in the UI. Set `GEOCODER_URL` to switch the geocoding service if needed.

In Angular development mode, the login page offers **Nadaljuj brez prijave (razvoj)**. The API dev-session endpoint is disabled when `NODE_ENV=production`.

Keep `backend/.env` private. Do not commit real credentials. Electron never connects directly to MySQL.
