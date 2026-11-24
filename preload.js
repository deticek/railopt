const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('railoptEnvironment', {
  isElectron: true,
  isDevelopment: process.argv.includes('--railopt-development')
});
