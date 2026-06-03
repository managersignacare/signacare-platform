/**
 * Signacare EMR — Electron Main Process
 *
 * This is the entry point for the standalone desktop application.
 * It starts the embedded Express API server and opens the React UI.
 */

const { app, BrowserWindow, dialog, shell } = require('electron')
const path = require('path')
const { fork } = require('child_process')
const http = require('http')

const API_PORT = 4000
const isDev = process.env.NODE_ENV === 'development'

let mainWindow = null
let apiProcess = null

// ── Start embedded API server ──
function startApiServer() {
  return new Promise((resolve, reject) => {
    const apiEntry = isDev
      ? path.join(__dirname, '..', 'apps', 'api', 'src', 'index.ts')
      : path.join(__dirname, '..', 'apps', 'api', 'dist', 'index.js')

    const env = {
      ...process.env,
      PORT: String(API_PORT),
      NODE_ENV: 'production',
      // SQLite for standalone mode
      DB_CLIENT: 'sqlite3',
      DB_FILENAME: path.join(app.getPath('userData'), 'signacare.db'),
      // Ollama
      OLLAMA_BASE_URL: 'http://localhost:11434',
    }

    if (isDev) {
      // In dev, use ts-node
      apiProcess = fork(apiEntry, [], {
        env,
        execArgv: ['-r', 'ts-node/register', '-r', 'dotenv/config'],
      })
    } else {
      apiProcess = fork(apiEntry, [], { env })
    }

    apiProcess.on('error', reject)

    // Wait for API to be ready
    const check = setInterval(() => {
      http.get(`http://localhost:${API_PORT}/api/v1/auth/health`, (res) => {
        if (res.statusCode === 200 || res.statusCode === 404) {
          clearInterval(check)
          resolve()
        }
      }).on('error', () => {}) // still starting
    }, 500)

    // Timeout after 15 seconds
    setTimeout(() => { clearInterval(check); resolve() }, 15000)
  })
}

// ── Create main window ──
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Signacare EMR',
    icon: path.join(__dirname, 'resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    // Load the built React app
    mainWindow.loadFile(path.join(__dirname, '..', 'apps', 'web', 'dist', 'index.html'))
  }

  // Open external links in browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('closed', () => { mainWindow = null })
}

// ── Check Ollama ──
async function checkOllama() {
  try {
    const resp = await fetch('http://localhost:11434/api/tags')
    return resp.ok
  } catch {
    return false
  }
}

// ── App lifecycle ──
app.whenReady().then(async () => {
  // Check Ollama availability
  const ollamaRunning = await checkOllama()
  if (!ollamaRunning) {
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'Ollama Not Running',
      message: 'Ollama is not detected on this machine.',
      detail: 'AI features require Ollama. Install from https://ollama.com and run "ollama serve".\n\nThe application will start without AI features.',
      buttons: ['Continue'],
    })
  }

  // Start API
  try {
    await startApiServer()
  } catch (err) {
    dialog.showErrorBox('API Error', `Failed to start the API server: ${err.message}`)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (apiProcess) apiProcess.kill()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  if (apiProcess) apiProcess.kill()
})
