import { defineConfig } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * UI tests run against a THROWAWAY company, never the operator's real one.
 * A test that can hire staff or approve drafts in a live company is not a
 * test, it is a hazard.
 *
 * The home is UNIQUE per run. An earlier version reused one path and deleted
 * it in globalSetup — if the web server had already opened ledger.db it was
 * left holding a deleted inode and served an empty company for the whole run,
 * no matter what the fixtures wrote. Nothing to race on if nothing is reused.
 */
export const TEST_HOME = join(tmpdir(), `helmsted-e2e-${process.pid}-${Date.now()}`);
export const PORT = 4174;

/**
 * Playwright starts the web server BEFORE globalSetup, so the server boots
 * against a home that does not exist yet and resolves identity from defaults.
 * Passing it here means both processes agree no matter which runs first —
 * which is also exactly how the container is configured.
 */
export const COMPANY = {
  // The INSTALLATION root, not just one company's home. Without this the
  // server lists — and can open — the operator's real companies, because the
  // companies directory is derived from the home directory.
  HELMSTED_ROOT: TEST_HOME,
  HELMSTED_HOME: join(TEST_HOME, 'companies', 'testwright-co'),
  HELMSTED_COMPANY: 'Testwright Co',
  HELMSTED_BUSINESS: 'proving the console renders',
  HELMSTED_CHAIR: 'Tester',
  HELMSTED_CEO: 'Wren',
};

export default defineConfig({
  testDir: './e2e',
  timeout: 20_000,
  expect: { timeout: 7_000 },
  fullyParallel: false,       // one company, one server
  workers: 1,
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  webServer: {
    // The node running Playwright, not whatever `node` resolves to on PATH.
    // Type-stripping needs 26, and a shell that has not run `nvm use` does not
    // have it — that failure reads as a syntax error in an unrelated file.
    command: `${process.execPath} src/gateway/server.ts`,
    port: PORT,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ...COMPANY, PORT: String(PORT) },
  },
  globalSetup: './e2e/setup.ts',
  globalTeardown: './e2e/teardown.ts',
});
