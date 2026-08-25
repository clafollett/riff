import { rmSync } from 'node:fs';
import { TEST_HOME } from '../playwright.config.ts';

/** Remove the throwaway Inn once the server that was using it has stopped. */
export default async function globalTeardown() {
  rmSync(TEST_HOME, { recursive: true, force: true });
}
