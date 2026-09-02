/** Everything the Desk knows, it knows from these. */
export type Agent = {
  id: string; name: string; tier: string; role: string;
  department: string; reportsTo: string | null; status: string;
  activity: string; mandate: string; hiredAt: string; hiredBy: string | null;
};

export type Approval = {
  id: string; requestedBy: string; capability: string; tier: string;
  state: string; summary: string; target: string | null;
  amountCents: number | null; payloadJson: string | null;
  requestedAt: string; decidedBy: string | null;
  decidedAt: string | null; decisionReason: string | null;
};

export type Task = {
  id: string; title: string; body: string; status: string;
  createdBy: string; assignedTo: string | null;
  priority: number; createdAt: string; updatedAt: string;
};

export type Message = {
  id: string; from: string; to: string; alsoTo: string[]; body: string;
  broadcast: boolean; sentAt: string; readAt: string | null;
  /** Whether it reached you. Only your own mail has read state you can act on. */
  yours: boolean;
};

export type Inbox = {
  me: string; messages: Message[]; unread: number;
  /** 'mine' is what reached you; 'all' is the whole company talking. */
  scope?: 'mine' | 'all';
};

export type Work = {
  tasks: Task[];
  notes: number;
  orphans: Array<{ id: string; name: string; reportsTo: string | null }>;
};

export type CommonsDoc = {
  path: string; title: string; author: string | null; updated: string | null;
  /** When it first landed, from the event log. Null for anything older than it. */
  created: string | null;
  /** How many times it has been posted over — 1 means written once. */
  revisions: number;
};

export type Event = {
  id: string; seq: number; at: string; actor: string;
  kind: string; subject: string | null; dataJson: string | null;
};

/** Mirrors src/analytics/vitals.ts. Everything here is derived on read — no
 *  table backs any of it, so the window costs nothing to widen. */
export type Trend = {
  shifts: number; costUsd: number; commits: number; messages: number;
  posted: number; removed: number; filed: number; released: number;
  done: number; dropped: number; blind: number; failed: number;
  hired: number; retired: number; barren: number;
};

export type Vitals = {
  window: { spec: string; since: string; until: string; days: number };
  previous: Trend | null;
  shifts: {
    woke: number; slept: number; failed: number; blind: number;
    truncated: number; rotated: number; rotateFailed: number; compacted: number;
    turns: number; costUsd: number; costPerShift: number; turnsPerShift: number;
    troubleRate: number; barren: number; costShareTop: number;
  };
  org: {
    headcount: number; hired: number; retired: number; net: number;
    orphans: number; depth: number; widest: number; shiftsPerHead: number;
  };
  throttle: { rateLimited: number; throttled: number; usagePaused: number };
  commons: {
    held: number; ceiling: number; posted: number; added: number;
    revised: number; removed: number; net: number; refused: number;
  };
  envelope: {
    filed: number; approved: number; rejected: number; withdrawn: number;
    released: number; pending: number;
    oldestPendingHours: number | null; medianDecisionHours: number | null;
  };
  work: {
    opened: number; claimed: number; done: number; dropped: number;
    blocked: number; openNow: number; completionRate: number;
  };
  talk: {
    messages: number; deliveries: number; broadcastFanout: number;
    notes: number; memoryConsolidated: number;
    commits: number; byStaff: number; unattributed: number;
    perCommit: number; costPerCommit: number;
  };
  money: { spends: number; cents: number; exceptions: number };
  gate: {
    allow: number; deny: number; escalate: number;
    rules: Array<{ kind: string; rule: string; capability: string; n: number }>;
  };
  people: Array<{
    id: string; name: string; tier: string; role: string;
    shifts: number; turns: number; costUsd: number; commits: number;
    messages: number; posted: number; filed: number; done: number; denied: number;
  }>;
};

export type CompanyPolicy = {
  maxTurns: number;
  concurrency: number;
  baseIntervalMinutes: number;
  throttleAboveUtilization: number;
  pauseAboveUtilization: number;
  rotateAtContextPct: number;
  commonsCeiling: number;
  dailyCapCents: number;
};

export type State = {
  slug: string;
  company: { name: string; business: string };
  policy: CompanyPolicy;
  board: Array<{ id: string; name: string; role: string }>;
  ceo: { id: string; name: string };
  agents: Agent[];
  headcount: number;
  pending: number;
  pendingBoard: number;
  notes: number;
  unread: number;
  commons: { held: number; ceiling: number };
  tasks: number;
  seq: number;
  running: boolean;
  awake: string[];
  dueAt: Record<string, number>;
  pausedUntil: number | null;
  ticks: number;
  rateLimit: { status?: string; utilization?: number; rateLimitType?: string } | null;
};

export type CompanyRef = {
  slug: string; name: string; business: string;
  home: string; ceo: string; founded: boolean;
  running: boolean; awake: string[];
};

/**
 * Which company the console is looking at.
 *
 * Every request carries it. The server refuses an unknown slug rather than
 * falling back to some other company, so a stale value here fails loudly
 * instead of quietly reading and writing the wrong world.
 */
let current = '';
export const setCompany = (slug: string): void => { current = slug; };
export const getCompany = (): string => current;

const withCompany = (path: string): string => {
  if (!current) return path;
  return path + (path.includes('?') ? '&' : '?') + 'c=' + encodeURIComponent(current);
};

const get = async <T>(path: string): Promise<T> => {
  const r = await fetch(withCompany(path));
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
};

const send = async <T>(path: string, method: string, body?: unknown): Promise<T> => {
  const r = await fetch(withCompany(path), {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  const data = await r.json().catch(() => ({})) as T & { error?: string };
  if (!r.ok) throw new Error(data.error ?? `${path} → ${r.status}`);
  return data;
};

export const api = {
  // The installation, not one company — these never carry a slug in the query.
  companies: async (): Promise<{ companies: CompanyRef[]; active: string | null }> => {
    const r = await fetch('/api/companies');
    if (!r.ok) throw new Error(`/api/companies → ${r.status}`);
    return r.json() as Promise<{ companies: CompanyRef[]; active: string | null }>;
  },
  foundCompany: (input: { name: string; business: string; ceo: string; chair: string }) =>
    send<{ slug: string }>('/api/companies', 'POST', input),
  setCompanyRunning: (slug: string, running: boolean) =>
    send<{ running: boolean }>(`/api/companies/${encodeURIComponent(slug)}/running`, 'POST', { running }),
  renameCompany: (slug: string,
                  patch: { name?: string; business?: string; slug?: string;
                           policy?: Partial<CompanyPolicy> }) =>
    send<{ slug: string }>(`/api/companies/${encodeURIComponent(slug)}`, 'PATCH', patch),
  archiveCompany: (slug: string) =>
    send<{ archived: string; at: string }>(`/api/companies/${encodeURIComponent(slug)}`, 'DELETE'),
  /**
   * The archive itself is the body. There is exactly one file, so a multipart
   * form would be ceremony around a single blob — and the browser streams it
   * rather than building one in memory.
   */
  importCompany: async (f: File, name?: string) => {
    const q = name?.trim() ? `?name=${encodeURIComponent(name.trim())}` : '';
    const r = await fetch(`/api/companies/import${q}`, {
      method: 'POST', headers: { 'content-type': 'application/gzip' }, body: f,
    });
    const data = await r.json().catch(() => ({})) as
      { slug: string; renamed: boolean; manifest: { name: string }; error?: string };
    if (!r.ok) throw new Error(data.error ?? `import → ${r.status}`);
    return data;
  },

  state: () => get<State>('/api/state'),
  approvals: () => get<Approval[]>('/api/approvals'),
  decided: () => get<{ approvals: Approval[] }>('/api/approvals/decided'),
  work: () => get<Work>('/api/work'),
  inbox: (scope: 'mine' | 'all' = 'mine') =>
    get<Inbox>(scope === 'all' ? '/api/inbox?scope=all' : '/api/inbox'),
  recent: (limit = 200) => get<{ events: Event[] }>(`/api/events?limit=${limit}`),
  markRead: (ids?: string[], read = true) =>
    send<{ marked: number; read: boolean }>('/api/inbox/read', 'POST', { ...(ids ? { ids } : {}), read }),
  start: () => send<{ running: boolean }>('/api/open', 'POST'),
  pause: () => send<{ running: boolean }>('/api/close', 'POST'),
  wake: (who?: string) => send<{ waking: string }>('/api/wake', 'POST', who ? { who } : {}),
  commons: () => get<{ held: number; ceiling: number; documents: CommonsDoc[] }>('/api/commons'),
  vitals: (window = '7.days') =>
    get<Vitals>(`/api/vitals?window=${encodeURIComponent(window)}`),
  happened: (since = '3.days') =>
    get<{ commits: Array<{ sha: string; author: string; at: string; subject: string }>;
          contributions: Array<{ author: string; commits: number }> }>(
      `/api/whathappened?since=${encodeURIComponent(since)}`),
  doc: (path: string) =>
    get<{ path: string; body: string; title: string | null; author: string | null; updated: string | null }>(
      `/api/doc?path=${encodeURIComponent(path)}`),
  decide: async (id: string, approved: boolean, reason: string) => {
    const r = await fetch(withCompany(`/api/approvals/${id}`), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved, reason }),
    });
    return r.ok;
  },
  say: async (to: string | string[] | null, text: string) => {
    const r = await fetch(withCompany('/api/say'), {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, text }),
    });
    return r.ok;
  },
};

/** Live event tail. Returns an unsubscribe. */
export const stream = (onEvents: (e: Event[]) => void): (() => void) => {
  const es = new EventSource(withCompany('/api/stream'));
  es.addEventListener('tick', (ev) => {
    try { onEvents(JSON.parse((ev as MessageEvent).data).events ?? []); } catch { /* malformed frame */ }
  });
  return () => es.close();
};
