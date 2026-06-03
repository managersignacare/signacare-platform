/**
 * Signacare EMR — Standalone Packaging Configuration
 *
 * Architecture for standalone laptop deployment:
 *
 * ┌─────────────────────────────────────────────────┐
 * │                 Electron App                      │
 * │  ┌──────────────┐  ┌──────────────────────────┐  │
 * │  │  React UI     │  │  Embedded Node.js API     │  │
 * │  │  (Renderer)   │  │  (Main process child)     │  │
 * │  │  - Vite build │  │  - Express server         │  │
 * │  │  - MUI 7      │  │  - SQLite (via better-    │  │
 * │  │  - React 19   │  │    sqlite3 or Knex)       │  │
 * │  └──────────────┘  │  - Local file storage      │  │
 * │                     └──────────────────────────┘  │
 * │                                                    │
 * │  ┌──────────────────────────────────────────────┐  │
 * │  │  Ollama (External dependency)                 │  │
 * │  │  - Auto-detected on localhost:11434           │  │
 * │  │  - Models: llama3.2, mentallama, emollm,      │  │
 * │  │           mentalbert                           │  │
 * │  └──────────────────────────────────────────────┘  │
 * └─────────────────────────────────────────────────┘
 *
 * Database Strategy:
 * - Production (server):     PostgreSQL via Knex
 * - Standalone (laptop):     SQLite via Knex (same migrations)
 *   Knex supports both — just change the connection config.
 *
 * Build steps:
 * 1. npm run build:web        → builds React frontend
 * 2. npm run build:api        → compiles API to JS
 * 3. npm run package:electron → bundles into .app/.exe/.deb
 */

export const electronBuilderConfig = {
  appId: 'com.signacare.signacare',
  productName: 'Signacare EMR',
  copyright: 'Copyright © 2026 SignaCare',

  directories: {
    output: 'dist-electron',
    buildResources: 'standalone/resources',
  },

  files: [
    // Compiled API
    'apps/api/dist/**/*',
    // Built web frontend
    'apps/web/dist/**/*',
    // Electron main process
    'standalone/main.js',
    'standalone/preload.js',
    // Node modules (pruned)
    'node_modules/**/*',
    // SQLite database template
    'standalone/signacare.db',
  ],

  extraResources: [
    // Ollama model files for first-run setup
    { from: 'models/', to: 'models/' },
  ],

  mac: {
    category: 'public.app-category.medical',
    target: ['dmg', 'zip'],
    icon: 'standalone/resources/icon.icns',
    hardenedRuntime: true,
    entitlements: 'standalone/entitlements.mac.plist',
  },

  win: {
    target: ['nsis', 'portable'],
    icon: 'standalone/resources/icon.ico',
  },

  linux: {
    target: ['AppImage', 'deb'],
    category: 'Science',
    icon: 'standalone/resources/icon.png',
  },

  nsis: {
    oneClick: false,
    allowToChangeInstallationDirectory: true,
    installerIcon: 'standalone/resources/icon.ico',
  },
}
