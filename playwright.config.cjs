const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/ui',
  timeout: 30000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
});
