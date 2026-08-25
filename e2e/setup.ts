import { COMPANY } from '../playwright.config.ts';
import { resolveConfig, scaffoldConfig, type HelmstedConfig } from '../src/core/config.ts';
import { found } from '../src/company/genesis.ts';
import { fillSeat } from '../src/company/hire.ts';
import { World } from '../src/worldfs/world.ts';
import { systemClock } from '../src/core/clock.ts';

/**
 * Build a company with something in every surface the Desk renders. A view
 * that is only ever tested empty passes forever and shows nothing.
 */
export default async function globalSetup(): Promise<void> {
  Object.assign(process.env, COMPANY);

  const cfg: HelmstedConfig = resolveConfig();
  scaffoldConfig(cfg);
  const { ledger } = found(cfg, systemClock);
  const world = new World(cfg.worldDir, systemClock);

  fillSeat(ledger, world, systemClock, {
    name: 'Fen', tier: 'lead', role: 'Head of Proof', department: 'assurance',
    reportsTo: cfg.ceo.id, proposedBy: cfg.ceo.id,
    mandate: 'Find out whether the thing we say happened actually happened.',
  });

  world.writeCommons('doctrine/what-we-are-for.md',
    { title: 'What we are for', author: cfg.ceo.id, updated: systemClock.iso() },
    '# What we are for\n\nOne claim, **testable**, or it does not go in here.\n\n- Evidence over recollection\n- Removal is a first-class act\n');

  // The path an agent gets wrong: a prefix the tool used to prepend twice.
  world.writeCommons('commons/records/scores.md',
    { title: 'Scores, including ours', author: 'fen', updated: systemClock.iso() },
    '# Scores\n\n| subject | score |\n| - | - |\n| us | 5/24 |\n');

  // Work in three states, so the Work view is not only ever tested empty.
  const t1 = ledger.createTask({
    id: 'tsk_open', title: 'Score a system we do not own', body: 'Track B, from published artifacts.',
    status: 'open', createdBy: cfg.ceo.id, assignedTo: 'fen', parentId: null, priority: 2,
  });
  ledger.createTask({
    id: 'tsk_done', title: 'Write the removal criterion before anyone needs it',
    body: 'Done.', status: 'open', createdBy: cfg.ceo.id, assignedTo: cfg.ceo.id, parentId: null, priority: 1,
  });
  ledger.updateTaskStatus('tsk_done', 'done');
  ledger.createTask({
    id: 'tsk_gone', title: 'Grade ourselves under v0.1 again',
    body: 'Dropped: the grader would have been the author.',
    status: 'open', createdBy: cfg.ceo.id, assignedTo: null, parentId: null, priority: 0,
  });
  ledger.updateTaskStatus('tsk_gone', 'dropped');
  void t1;

  // A draft waiting on the board, so the Envelope has something to render.
  const draftPath = 'staff/fen/drafts/2026-01-01-first-contact.md';
  world.writeDoc(draftPath, {
    data: { title: 'First contact', author: 'fen', updated: systemClock.iso() },
    body: '# First contact\n\nWe would like to run the test on you.\n\n**What it costs you.** An hour.\n\n<script>alert(1)</script>\n',
  });
  ledger.createApproval({
    requestedBy: 'fen', capability: 'external.write', tier: 'board',
    summary: '[email] Asking an outside org to sit a run.',
    target: draftPath,
    payload: { channel: 'email', draftPath },
  });

  ledger.close();
}
