import { rmSync } from 'node:fs';
import { TEST_HOME } from '../playwright.config.ts';

/** Delete the throwaway company only after the server that held it is gone. */
export default async function globalTeardown(): Promise<void> {
  rmSync(TEST_HOME, { recursive: true, force: true });
}
