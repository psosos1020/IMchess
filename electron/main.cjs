const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');

let viteProcess = null;

async function waitForVite(url, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { await fetch(url); return; } catch {}
    await new Promise(r => setTimeout(r, 250));
  }
  throw new Error('Vite 개발 서버가 시작되지 않았다.');
}

async function startDevServer() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  viteProcess = spawn(npm, ['run', 'dev', '--', '--host', '127.0.0.1'], { stdio: 'inherit', windowsHide: true });
  viteProcess.on('exit', code => { if (!app.isQuitting && code) console.error(`Vite exited with ${code}`); });
  await waitForVite('http://127.0.0.1:5173');
}

async function createWindow() {
  if (!app.isPackaged) await startDevServer();
  const win = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 980,
    minHeight: 720,
    title: 'IMchess',
    backgroundColor: '#0e1116',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (app.isPackaged) await win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  else await win.loadURL('http://127.0.0.1:5173');
}

app.whenReady().then(async () => {
  try { await createWindow(); }
  catch (e) { console.error(e); app.quit(); }
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (viteProcess && !viteProcess.killed) viteProcess.kill();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
