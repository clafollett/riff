import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { Ledger } from '../ledger/ledger.ts';
import { World } from '../worldfs/world.ts';
import { PolicyGate } from '../policy/gate.ts';
import { DEFAULT_HOUSE_RULES } from '../policy/rules.ts';
import { Scheduler } from '../runtime/scheduler.ts';
import { systemClock } from '../core/clock.ts';
import { computeMorale } from './morale.ts';
import { HOUSES, MAP_W, MAP_H, TILE, FOUNTAIN } from '../village/map.ts';
import type { Event } from '../core/types.ts';

import { resolveConfig } from '../core/config.ts';

const PORT = Number(process.env['PORT'] ?? 4173);
const cfg = resolveConfig();
const WORLD_DIR = cfg.worldDir;
const LEDGER = cfg.ledgerPath;
const CLIENT_DIR = resolve('client');

const clock = systemClock;
const ledger = new Ledger(LEDGER, clock);
const world = new World(WORLD_DIR, clock);
const rules = DEFAULT_HOUSE_RULES;
const gate = new PolicyGate(ledger, rules);
const scheduler = new Scheduler({ ledger, gate, world, clock });

// ---------------------------------------------------------------- SSE fan-out
/**
 * One-way by nature: the village produces events, the browser watches. SSE gets
 * this for free — EventSource reconnects on its own, and there is no upgrade
 * handshake or extra dependency to carry for traffic that never needed to be
 * bidirectional. Commands come back up as ordinary POSTs.
 */
const watchers = new Set<ServerResponse>();
let lastBroadcastSeq = ledger.latestSeq();

const broadcast = (): void => {
  const fresh = ledger.eventsSince(lastBroadcastSeq, 200);
  if (fresh.length === 0) return;
  lastBroadcastSeq = fresh[fresh.length - 1]!.seq;

  const payload = JSON.stringify({ events: fresh, positions: ledger.listPositions() });
  for (const w of watchers) {
    // A dead client must not take the village down with it.
    try { w.write(`event: tick\ndata: ${payload}\n\n`); } catch { watchers.delete(w); }
  }
};
setInterval(broadcast, 700).unref();

// -------------------------------------------------------------------- helpers
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
  if (chunks.length === 0) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>; }
  catch { return {}; }
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp',
};

const serveStatic = async (res: ServerResponse, urlPath: string): Promise<void> => {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const abs = resolve(CLIENT_DIR, rel);
  // The client dir is the whole world this handler may see.
  if (abs !== CLIENT_DIR && !abs.startsWith(CLIENT_DIR + sep)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const buf = await readFile(abs);
    res.writeHead(200, { 'content-type': MIME[extname(abs)] ?? 'application/octet-stream' });
    res.end(buf);
  } catch {
    res.writeHead(404).end('not found');
  }
};

// --------------------------------------------------------------------- routes
const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const p = url.pathname;
  const method = req.method ?? 'GET';

  try {
    // ---- the map and everyone on it ----
    if (p === '/api/state' && method === 'GET') {
      return json(res, {
        map: { w: MAP_W, h: MAP_H, tile: TILE, fountain: FOUNTAIN },
        houses: HOUSES,
        staff: ledger.listAgents(),
        positions: ledger.listPositions(),
        seq: ledger.latestSeq(),
        pendingApprovals: ledger.listApprovals('pending', 'innkeeper').length,
        notes: ledger.countNotes(),
        inn: {
          running: scheduler.running,
          rateLimit: scheduler.rateLimit,
          pausedUntil: scheduler.pausedUntil,
          rules: {
            treasurers: rules.treasurers,
            dailyCapCents: rules.dailyCapCents,
            steward: rules.steward,
            innkeeper: rules.innkeeper,
          },
        },
      });
    }

    // ---- live stream ----
    if (p === '/api/stream' && method === 'GET') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
      });
      res.write(`retry: 2000\n\n`);
      watchers.add(res);
      const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch { /* gone */ } }, 20_000);
      req.on('close', () => { clearInterval(keepAlive); watchers.delete(res); });
      return;
    }

    // ---- the envelope ----
    if (p === '/api/approvals' && method === 'GET') {
      return json(res, ledger.listApprovals('pending'));
    }

    if (p.startsWith('/api/approvals/') && method === 'POST') {
      const id = p.slice('/api/approvals/'.length);
      const body = await readBody(req);
      const approved = body['approved'] === true;
      const reason = typeof body['reason'] === 'string' ? body['reason'] : '';
      const ok = gate.decide(id, rules.innkeeper, approved, reason);
      return json(res, { ok }, ok ? 200 : 409);
    }

    // ---- morale, recomputed from the log every time ----
    if (p === '/api/morale' && method === 'GET') {
      return json(res, computeMorale(ledger, clock, rules.innkeeper));
    }

    // ---- notes about someone ----
    if (p === '/api/notes' && method === 'GET') {
      const about = url.searchParams.get('about');
      return json(res, about ? ledger.notesAbout(about) : { total: ledger.countNotes() });
    }

    // ---- "what happened while I was gone" ----
    if (p === '/api/whathappened' && method === 'GET') {
      const since = url.searchParams.get('since') ?? '3.days';
      return json(res, {
        commits: world.git.since(since),
        contributions: world.git.contributionsSince(since),
      });
    }

    // ---- the Inn Keeper speaks ----
    if (p === '/api/say' && method === 'POST') {
      const body = await readBody(req);
      const to = typeof body['to'] === 'string' ? body['to'] : null;
      const text = String(body['text'] ?? '').slice(0, 2000);
      if (!text) return json(res, { error: 'nothing to say' }, 400);

      const n = ledger.sendMessage(rules.innkeeper, to, text);
      ledger.emit(rules.innkeeper, 'message.sent', to, { recipients: n, text });
      if (to) scheduler.nudge(to);
      else for (const a of ledger.listAgents()) scheduler.nudge(a.id);
      return json(res, { delivered: n });
    }

    // ---- call everyone to the Inn ----
    if (p === '/api/meeting' && method === 'POST') {
      const body = await readBody(req);
      const topic = String(body['topic'] ?? 'A meeting has been called.').slice(0, 2000);
      const inn = HOUSES.find((h) => h.id === 'the-inn')!;
      for (const a of ledger.listAgents()) {
        if (a.id === rules.innkeeper) continue;
        ledger.setPosition({ agentId: a.id, x: inn.doorX, y: inn.doorY, facing: 'up', activity: 'at the meeting' });
        scheduler.nudge(a.id);
      }
      const n = ledger.sendMessage(rules.innkeeper, null, `[MEETING AT THE INN] ${topic}`);
      ledger.emit(rules.innkeeper, 'meeting.called', null, { topic, summoned: n });
      return json(res, { summoned: n });
    }

    // ---- open and close the Inn ----
    if (p === '/api/inn/open' && method === 'POST') { scheduler.start(); return json(res, { running: true }); }
    if (p === '/api/inn/close' && method === 'POST') { await scheduler.stop(); return json(res, { running: false }); }

    if (p.startsWith('/api/')) return json(res, { error: 'no such door' }, 404);
    return await serveStatic(res, p);
  } catch (err) {
    return json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`\n  The LaFollett Bed & Breakfast`);
  console.log(`  ${ledger.listAgents().length} staff · ${HOUSES.length} houses`);
  console.log(`  http://localhost:${PORT}\n`);
  console.log(`  The staff are asleep. POST /api/inn/open to start the day.\n`);
});

const shutdown = async () => {
  console.log('\n  Closing the Inn...');
  await scheduler.stop();
  for (const w of watchers) { try { w.end(); } catch { /* gone */ } }
  server.close(() => { ledger.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
