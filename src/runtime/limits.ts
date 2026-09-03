import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

/**
 * Which subscription window is the one to pace against.
 *
 * A Claude subscription runs several at once — five-hour, seven-day, and
 * per-model seven-day — and they are all live constraints, so the fullest is
 * the only honest input to a decision about slowing down. Pacing off the last
 * event to arrive instead let a five-hour window fresh from a reset read 15%
 * and put the throttle back to 1 while the weekly sat at 92%, which is how a
 * company sprints into the one ceiling that takes days rather than hours to
 * clear.
 *
 * A leaf on purpose: the scheduler decides pace with it and a shift records
 * its reading with it, and those two must not be able to disagree.
 */
export const worstWindow = (
  windows: Iterable<[string, SDKRateLimitInfo]>,
  pick: (kind: string) => boolean = () => true,
): SDKRateLimitInfo | null => {
  let worst: SDKRateLimitInfo | null = null;
  for (const [kind, w] of windows) {
    if (!pick(kind)) continue;
    if (!worst || (w.utilization ?? 0) > (worst.utilization ?? 0)) worst = w;
  }
  return worst;
};

/**
 * The seven-day windows, per-model ones included. This is the figure an
 * operator plans around: five hours spent by lunch is back by dinner, and a
 * week spent on Tuesday is gone until Tuesday.
 */
export const isWeekly = (kind: string): boolean => kind.startsWith('seven_day');

const KNOWN_LIMIT_TYPES = new Set<string>([
  'five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet',
  'seven_day_overage_included', 'overage',
]);

/** The subset of the SDK's experimental usage response that we depend on. */
export type UsageReading = {
  rate_limits_available?: boolean;
  rate_limits?: Record<string, { utilization: number | null; resets_at: string | null } | null | undefined> | null;
};

/**
 * Turn an on-demand usage reading into the same windows a `rate_limit_event`
 * would have produced.
 *
 * The push event is the only source the runtime had, and it is rare: 15 of 155
 * shifts in one company, and 0 of 14 across a whole night's run. So the figure
 * that is supposed to govern pacing on a subscription was almost never
 * present, and a report that should have been in percent-of-window came out in
 * tokens, which nobody on a subscription is billed for.
 *
 * The two sources disagree about scale — the event reports 0-1, this reports
 * 0-100 — so the conversion happens here, once, rather than at each of the
 * three places that read a utilization.
 */
export const windowsFromUsage = (u: UsageReading | null | undefined): Array<[string, SDKRateLimitInfo]> => {
  if (!u || u.rate_limits_available === false || !u.rate_limits) return [];
  const out: Array<[string, SDKRateLimitInfo]> = [];
  for (const [kind, w] of Object.entries(u.rate_limits)) {
    if (!w || w.utilization == null) continue;
    // `seven_day_oauth_apps` is reported here and is not one of the event's
    // types. Keep the window under its own key either way — `isWeekly` reads
    // the key, not this field — and only name a type the event could carry.
    const named = KNOWN_LIMIT_TYPES.has(kind);
    out.push([kind, {
      status: 'allowed',
      utilization: w.utilization / 100,
      ...(named ? { rateLimitType: kind as NonNullable<SDKRateLimitInfo['rateLimitType']> } : {}),
      ...(w.resets_at ? { resetsAt: Date.parse(w.resets_at) / 1000 } : {}),
    }]);
  }
  return out;
};

/**
 * Whether the plan's windows can be read at all.
 *
 * A `claude setup-token` credential carries `user:inference` but not
 * `user:profile`, so a container holding one can spend the subscription and
 * cannot see what is left of it: `rate_limits_available` comes back false and
 * every window is missing. That is indistinguishable, downstream, from a plan
 * with plenty of room — which is how a night's run got paced off token counts
 * that nobody is billed for. Recorded per shift so the console can say the
 * throttle is flying blind rather than implying it is satisfied.
 */
export const limitsReadable = (u: UsageReading | null | undefined): boolean =>
  u != null && u.rate_limits_available !== false;

/**
 * Fold a new reading of one window into what was already known about it.
 *
 * Two sources describe the same window and neither is complete: the usage
 * reading carries utilisation and no reset time, the `rate_limit_event`
 * carries a reset time and frequently no utilisation. Setting one over the
 * other drops whichever field the newcomer lacks — the first shift to record
 * windows by name logged a five-hour reset stamp and no five-hour figure,
 * which is the one number an operator on a subscription is asking for.
 */
export const mergeWindow = (
  had: SDKRateLimitInfo | undefined, next: SDKRateLimitInfo,
): SDKRateLimitInfo => ({
  ...next,
  ...(next.utilization == null && had?.utilization != null ? { utilization: had.utilization } : {}),
  ...(next.resetsAt == null && had?.resetsAt != null ? { resetsAt: had.resetsAt } : {}),
  ...(next.rateLimitType == null && had?.rateLimitType != null
    ? { rateLimitType: had.rateLimitType } : {}),
});

export type PlanWindow = { kind: string; utilization: number | null; resetsAt: number | null };

/**
 * The windows a finished shift recorded, for a company nothing is running.
 *
 * A scheduler holds its readings in memory, so a console opened on a company
 * that has not woken in this process shows no plan usage at all — which is
 * exactly when an operator asks what the plan has left, because the company
 * is stopped and they are deciding whether to start it.
 */
export const windowsFromShift = (data: unknown): PlanWindow[] => {
  if (!data || typeof data !== 'object') return [];
  const d = data as Record<string, unknown>;
  const out: PlanWindow[] = [];
  for (const [k, v] of Object.entries(d)) {
    if (!k.startsWith('used_') || typeof v !== 'number') continue;
    const kind = k.slice('used_'.length);
    const at = d[`resets_${kind}`];
    out.push({ kind, utilization: v, resetsAt: typeof at === 'number' ? at : null });
  }
  return out;
};
