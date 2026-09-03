/**
 * How often the company as a whole may start work.
 *
 * Separate from `#intervalFor`, which spaces out one person's shifts and lets
 * rank set who comes due first. That per-agent rule alone cannot pace a
 * company: with four staff on a ten-minute interval, somebody is always due,
 * and a real run spent 69.9 of 70 minutes working. The rate control has to be
 * company-wide or every hire quietly speeds the company up.
 *
 * Throttling multiplies it for the same reason it multiplies the per-agent
 * gap: a company pacing itself against a filling subscription window should
 * start rounds further apart, not merely stagger the same number of them.
 */
export const roundIsDue = (
  now: number, lastRound: number, intervalMs: number, throttle = 1,
): boolean => now - lastRound >= intervalMs * throttle;
