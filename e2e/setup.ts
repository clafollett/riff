import { TEST_HOME } from '../playwright.config.ts';
import { resolveConfig } from '../src/core/config.ts';
import { openTheInn } from '../src/village/open.ts';
import { Ledger } from '../src/ledger/ledger.ts';
import { systemClock } from '../src/core/clock.ts';

/**
 * Build a fresh Inn for the run, and put one draft in the envelope so the
 * approval UI has something real to render. Torn down and rebuilt every time,
 * so tests never inherit state from a previous run.
 */
export default async function globalSetup() {
  // TEST_HOME is unique per run, so there is nothing to tear down first —
  // and crucially nothing to delete out from under an already-open ledger.
  process.env['INN_HOME'] = TEST_HOME;
  process.env['INN_KEEPER'] = 'Tester';

  const cfg = resolveConfig();
  const { ledger } = openTheInn(cfg, systemClock);
  ledger.close();

  const l = new Ledger(cfg.ledgerPath, systemClock);
  l.createApproval({
    requestedBy: 'posy',
    capability: 'external.write',
    tier: 'innkeeper',
    summary: 'Publish 3 Etsy listings for the autumn set',
    target: 'etsy',
  });
  l.close();
}
