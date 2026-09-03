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
