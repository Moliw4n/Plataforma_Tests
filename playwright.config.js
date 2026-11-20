const { defineConfig, devices } = require('@playwright/test');

// Las mismas pruebas se ejecutan a 1280 px (escritorio) y a 390 px (móvil).
module.exports = defineConfig({
  testDir: 'pruebas',
  timeout: 30000,
  fullyParallel: true,
  reporter: [['list']],
  // Usa el Google Chrome instalado (en GitHub Actions también viene instalado)
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', channel: 'chrome' },
  webServer: {
    command: 'node pruebas/servidor.js',
    url: 'http://localhost:4173/test.html',
    reuseExistingServer: !process.env.CI
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'movil', use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
