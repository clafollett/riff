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

export type CommonsDoc = {
  path: string; title: string; author: string | null; updated: string | null;
};

export type Event = {
  id: string; seq: number; at: string; actor: string;
  kind: string; subject: string | null; dataJson: string | null;
};

export type State = {
  company: { name: string; business: string };
  board: Array<{ id: string; name: string; role: string }>;
  ceo: { id: string; name: string };
  agents: Agent[];
  headcount: number;
  pending: number;
  pendingBoard: number;
  notes: number;
  commons: { held: number; ceiling: number };
  tasks: number;
  seq: number;
  running: boolean;
  rateLimit: { status?: string; utilization?: number; rateLimitType?: string } | null;
};

const get = async <T>(path: string): Promise<T> => {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} → ${r.status}`);
  return r.json() as Promise<T>;
};

export const api = {
  state: () => get<State>('/api/state'),
  approvals: () => get<Approval[]>('/api/approvals'),
  commons: () => get<{ held: number; ceiling: number; documents: CommonsDoc[] }>('/api/commons'),
  happened: (since = '3.days') =>
    get<{ commits: Array<{ sha: string; author: string; at: string; subject: string }>;
          contributions: Array<{ author: string; commits: number }> }>(
      `/api/whathappened?since=${encodeURIComponent(since)}`),
  doc: (path: string) =>
    get<{ path: string; body: string; title: string | null; author: string | null; updated: string | null }>(
      `/api/doc?path=${encodeURIComponent(path)}`),
  decide: async (id: string, approved: boolean, reason: string) => {
    const r = await fetch(`/api/approvals/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ approved, reason }),
    });
    return r.ok;
  },
  say: async (to: string | null, text: string) => {
    const r = await fetch('/api/say', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to, text }),
    });
    return r.ok;
  },
};

/** Live event tail. Returns an unsubscribe. */
export const stream = (onEvents: (e: Event[]) => void): (() => void) => {
  const es = new EventSource('/api/stream');
  es.addEventListener('tick', (ev) => {
    try { onEvents(JSON.parse((ev as MessageEvent).data).events ?? []); } catch { /* malformed frame */ }
  });
  return () => es.close();
};
