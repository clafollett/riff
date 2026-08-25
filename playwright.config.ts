import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * UI tests run against a THROWAWAY Inn, never the operator's real one.
 * A test that can hire staff or approve drafts in your live village is not a
 * test, it is a hazard.
 */
/**
 * A UNIQUE home per run. The previous version reused one path and deleted it
 * in globalSetup — if the web server had already opened ledger.db, it was left
 * holding a deleted inode and served an empty Inn for the whole run, no matter
 * what the fixtures wrote. Nothing to race on if nothing is reused.
 */
export const TEST_HOME = join(tmpdir(), `lfbnb-e2e-${process.pid}-${Date.now()}`);
export const PORT = 4174;

export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,       // one village, one server
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: '/Users/clafollett/.nvm/versions/node/v26.7.0/bin/node src/gateway/server.ts',
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { INN_HOME: TEST_HOME, INN_KEEPER: 'Tester', PORT: String(PORT) },
  },
  globalSetup: './e2e/setup.ts',
  globalTeardown: './e2e/teardown.ts',
});
