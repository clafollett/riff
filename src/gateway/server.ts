import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Gate } from '../policy/gate.ts';
import { constitutionFor } from '../policy/rules.ts';
import { Scheduler } from '../runtime/scheduler.ts';
import { systemClock } from '../core/clock.ts';
import { resolveConfig } from '../core/config.ts';
import { found } from '../company/genesis.ts';

const PORT = Number(process.env['PORT'] ?? 4173);
const cfg = resolveConfig();
const clock = systemClock;

// Bootstrap on first boot: a fresh checkout on any machine becomes a working
// company with no setup step.
const { ledger, world, firstRun } = found(cfg, clock);
const constitution = constitutionFor({ ceo: cfg.ceo.id, board: cfg.board.map((b) => b.id) });
const gate = new Gate(ledger, constitution, {
  count: () => world.commonsCount(),
  exists: (p) => world.exists(p),
});
const scheduler = new Scheduler({ ledger, gate, world, clock, connectors: cfg.connectors });

// ---------------------------------------------------------------- SSE fan-out
const watchers = new Set<ServerResponse>();
let lastSeq = ledger.latestSeq();

setInterval(() => {
  const fresh = ledger.eventsSince(lastSeq, 200);
  if (!fresh.length) return;
  lastSeq = fresh[fresh.length - 1]!.seq;
  const payload = JSON.stringify({ events: fresh });
  for (const w of watchers) {
    try { w.write(`event: tick\ndata: ${payload}\n\n`); } catch { watchers.delete(w); }
  }
}, 700).unref();

const json = (res: ServerResponse, body: unknown, status = 200): void => {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(s) });
  res.end(s);
};

const readBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 1_000_000) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { return {}; }
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;
  const method = req.method ?? 'GET';

  try {
    if (p === '/api/state' && method === 'GET') {
      const agents = ledger.listAgents();
      return json(res, {
        company: cfg.company,
        board: cfg.board,
        ceo: cfg.ceo,
        agents,
        headcount: agents.filter((a) => a.tier !== 'board').length,
        pending: ledger.listApprovals('pending').length,
        pendingBoard: ledger.listApprovals('pending', 'board').length,
        notes: ledger.countNotes(),
        commons: { held: world.commonsCount(), ceiling: constitution.commonsCeiling },
        tasks: ledger.listTasks().length,
        seq: ledger.latestSeq(),
        running: scheduler.running,
        rateLimit: scheduler.rateLimit,
      });
    }

    if (p === '/api/stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      watchers.add(res);
      const ka = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 20_000);
      req.on('close', () => { clearInterval(ka); watchers.delete(res); });
      return;
    }

    if (p === '/api/approvals' && method === 'GET') return json(res, ledger.listApprovals('pending'));

    if (p.startsWith('/api/approvals/') && method === 'POST') {
      const id = p.slice('/api/approvals/'.length);
      const body = await readBody(req);
      const who = typeof body['as'] === 'string' ? body['as'] : (cfg.board[0]?.id ?? '');
      const ok = gate.decide(id, who, body['approved'] === true,
        typeof body['reason'] === 'string' ? body['reason'] : '');
      return json(res, { ok }, ok ? 200 : 409);
    }

    if (p === '/api/commons' && method === 'GET') {
      return json(res, {
        held: world.commonsCount(), ceiling: constitution.commonsCeiling,
        documents: world.listCommons(),
      });
    }

    if (p === '/api/whathappened' && method === 'GET') {
      const since = url.searchParams.get('since') ?? '3.days';
      return json(res, {
        commits: world.git.since(since),
        contributions: world.git.contributionsSince(since),
      });
    }

    if (p === '/api/say' && method === 'POST') {
      const body = await readBody(req);
      const to = typeof body['to'] === 'string' ? body['to'] : null;
      const text = String(body['text'] ?? '').slice(0, 4000);
      if (!text) return json(res, { error: 'nothing to say' }, 400);
      const from = cfg.board[0]?.id ?? 'board';
      const n = ledger.sendMessage(from, to, text);
      ledger.emit(from, 'message.sent', to, { recipients: n, text });
      if (to) scheduler.nudge(to);
      else for (const a of ledger.listAgents()) scheduler.nudge(a.id);
      return json(res, { delivered: n });
    }

    if (p === '/api/open' && method === 'POST') { scheduler.start(); return json(res, { running: true }); }
    if (p === '/api/close' && method === 'POST') { await scheduler.stop(); return json(res, { running: false }); }

    return json(res, { error: 'no such route' }, 404);
  } catch (err) {
    return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

server.listen(PORT, () => {
  if (firstRun) console.log(`\n  Founded ${cfg.company.name} at ${cfg.home}`);
  console.log(`\n  ${cfg.company.name}${cfg.company.business ? ` — ${cfg.company.business}` : ''}`);
  console.log(`  board: ${cfg.board.map((b) => b.name).join(', ')}  ·  CEO: ${cfg.ceo.name}`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  Nobody is working yet. POST /api/open to start.\n`);
});

const shutdown = async () => {
  await scheduler.stop();
  for (const w of watchers) { try { w.end(); } catch { /* gone */ } }
  server.close(() => { ledger.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
