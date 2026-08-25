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
  id: string; from: string; to: string; body: string;
  broadcast: boolean; sentAt: string; readAt: string | null;
};

export type Inbox = { me: string; messages: Message[]; unread: number };

export type Work = {
  tasks: Task[];
  notes: number;
  orphans: Array<{ id: string; name: string; reportsTo: string | null }>;
};

export type CommonsDoc = {
  path: string; title: string; author: string | null; updated: string | null;
};

export type Event = {
  id: string; seq: number; at: string; actor: string;
  kind: string; subject: string | null; dataJson: string | null;
};

export type State = {
  slug: string;
  company: { name: string; business: string };
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
  renameCompany: (slug: string, patch: { name?: string; business?: string; slug?: string }) =>
    send<{ slug: string }>(`/api/companies/${encodeURIComponent(slug)}`, 'PATCH', patch),
  archiveCompany: (slug: string) =>
    send<{ archived: string; at: string }>(`/api/companies/${encodeURIComponent(slug)}`, 'DELETE'),

  state: () => get<State>('/api/state'),
  approvals: () => get<Approval[]>('/api/approvals'),
  work: () => get<Work>('/api/work'),
  inbox: () => get<Inbox>('/api/inbox'),
  recent: (limit = 200) => get<{ events: Event[] }>(`/api/events?limit=${limit}`),
  markRead: (ids?: string[]) => send<{ marked: number }>('/api/inbox/read', 'POST', ids ? { ids } : {}),
  start: () => send<{ running: boolean }>('/api/open', 'POST'),
  pause: () => send<{ running: boolean }>('/api/close', 'POST'),
  wake: (who?: string) => send<{ waking: string }>('/api/wake', 'POST', who ? { who } : {}),
  commons: () => get<{ held: number; ceiling: number; documents: CommonsDoc[] }>('/api/commons'),
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
  say: async (to: string | null, text: string) => {
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
