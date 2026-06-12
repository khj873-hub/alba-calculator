// 퍼펙트근태 키오스크 — Electron 메인 (P0 데모, macOS 우선)
const { app, BrowserWindow, session } = require('electron');
const path = require('node:path');

function createWindow() {
  const win = new BrowserWindow({
    width: 960,
    height: 760,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#0f1216',
    title: '퍼펙트근태 키오스크',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // win.webContents.openDevTools(); // 디버그 필요 시 주석 해제
}

app.whenReady().then(() => {
  // 카메라/마이크 권한 자동 허용 (키오스크 단말 전제)
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'camera' || permission === 'microphone');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
