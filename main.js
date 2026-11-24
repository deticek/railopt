const { app, BrowserWindow } = require("electron");
const path = require("path");
const http = require("http");

const isDev = !app.isPackaged;
const frontendUrl = process.env.RAILOPT_FRONTEND_URL || "http://127.0.0.1:4200";
const builtFrontend = path.join(__dirname, "frontend/dist/browser/index.html");

function waitForFrontend(timeoutMs = 45000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const probe = () => {
      const request = http.get(frontendUrl, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) return resolve();
        retry();
      });
      request.setTimeout(1200, () => request.destroy());
      request.on("error", retry);
    };
    const retry = () => {
      if (Date.now() - started >= timeoutMs)
        return reject(
          new Error(
            `Angular vmesnik ni dosegljiv na ${frontendUrl}. Zaženi aplikacijo z npm run dev.`,
          ),
        );
      setTimeout(probe, 500);
    };
    probe();
  });
}

async function createWindow() {
  let useDevServer = false;
  if (isDev) {
    try {
      await waitForFrontend(process.env.RAILOPT_FRONTEND_URL ? 45000 : 1200);
      useDevServer = true;
    } catch (error) {
      if (!require("node:fs").existsSync(builtFrontend)) {
        const { dialog } = require("electron");
        dialog.showErrorBox(
          "Railopt frontend ni zgrajen",
          "Najprej zaženi npm run build.",
        );
        app.quit();
        return;
      }
    }
  }
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      additionalArguments: isDev ? ["--railopt-development"] : [],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (useDevServer) {
    win.loadURL(frontendUrl).catch((error) => {
      const { dialog } = require("electron");
      dialog.showErrorBox("Railopt ni mogel naložiti vmesnika", error.message);
    });
  } else {
    win.loadFile(
      builtFrontend,
      isDev ? { query: { electronDev: "1" } } : undefined,
    );
  }
}

app
  .whenReady()
  .then(createWindow)
  .catch((error) => {
    const { dialog } = require("electron");
    dialog.showErrorBox("Railopt se ni zagnal", error.message || String(error));
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
