import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { worstWindow, isWeekly, windowsFromUsage, limitsReadable } from '../src/runtime/limits.ts';

const at = (utilization: number, rateLimitType?: string): SDKRateLimitInfo => ({
  status: 'allowed',
  ...(rateLimitType ? { rateLimitType } : {}),
  utilization,
} as SDKRateLimitInfo);

/**
 * A subscription runs several windows at once and they are all live. The
 * company is paced off one number, so which number it is decides whether the
 * pacing works at all.
 */
describe('which subscription window the company is paced against', () => {
  test('a five-hour window fresh from a reset does not hide a spent weekly one', () => {
    // The bug: the scheduler kept only the last rate-limit event, so a
    // five-hour window that had just reset put the throttle back to 1 while
    // the weekly sat nearly empty — the company then sprinted into the one
    // ceiling that takes days rather than hours to clear.
    const windows = new Map([
      ['seven_day', at(0.92, 'seven_day')],
      ['five_hour', at(0.15, 'five_hour')],
    ]);
    assert.equal(worstWindow(windows)?.rateLimitType, 'seven_day');
    assert.equal(worstWindow(windows)?.utilization, 0.92);
  });

  test('the tightest window wins whichever kind it happens to be', () => {
    const windows = new Map([
      ['seven_day', at(0.10, 'seven_day')],
      ['five_hour', at(0.88, 'five_hour')],
    ]);
    assert.equal(worstWindow(windows)?.rateLimitType, 'five_hour');
  });

  test('the weekly figure ignores the five-hour window entirely', () => {
    const windows = new Map([
      ['five_hour', at(0.99, 'five_hour')],
      ['seven_day', at(0.30, 'seven_day')],
    ]);
    assert.equal(worstWindow(windows, isWeekly)?.utilization, 0.30);
  });

  test('a per-model weekly window counts as weekly', () => {
    // seven_day_opus and seven_day_sonnet are seven-day windows and an
    // operator plans around them the same way. Matching 'seven_day' exactly
    // would have quietly dropped both.
    assert.equal(isWeekly('seven_day_opus'), true);
    assert.equal(isWeekly('seven_day_sonnet'), true);
    assert.equal(isWeekly('seven_day'), true);
    assert.equal(isWeekly('five_hour'), false);
    const windows = new Map([['seven_day_opus', at(0.81, 'seven_day_opus')]]);
    assert.equal(worstWindow(windows, isWeekly)?.utilization, 0.81);
  });

  test('the fullest of two weekly windows is the binding one', () => {
    const windows = new Map([
      ['seven_day_opus', at(0.40, 'seven_day_opus')],
      ['seven_day_sonnet', at(0.77, 'seven_day_sonnet')],
    ]);
    assert.equal(worstWindow(windows, isWeekly)?.rateLimitType, 'seven_day_sonnet');
  });

  test('nothing reported is null, not a comfortable zero', () => {
    // A zero here would read as "the window is empty, go faster", which is the
    // opposite of what "we have not heard" means.
    assert.equal(worstWindow(new Map()), null);
    assert.equal(worstWindow(new Map([['five_hour', at(0.5, 'five_hour')]]), isWeekly), null);
  });

  test('a window reporting no utilization at all does not outrank a real reading', () => {
    const windows = new Map([
      ['five_hour', { status: 'allowed', rateLimitType: 'five_hour' } as SDKRateLimitInfo],
      ['seven_day', at(0.6, 'seven_day')],
    ]);
    assert.equal(worstWindow(windows)?.rateLimitType, 'seven_day');
  });
});

/**
 * `rate_limit_event` is a push, and a rare one: 15 of 155 shifts in one
 * company, and 0 of 14 across a whole night. So the figure that governs pacing
 * on a subscription was almost never present, and a night's report came out in
 * tokens — which is not what anyone on a subscription is billed against. The
 * SDK will answer on demand instead; it just answers on a different scale.
 */
describe('a usage reading asked for, rather than waited for', () => {
  const reading = {
    rate_limits_available: true,
    rate_limits: {
      five_hour: { utilization: 34, resets_at: '2026-09-03T11:00:00.000Z' },
      seven_day: { utilization: 71.5, resets_at: '2026-09-08T00:00:00.000Z' },
      seven_day_opus: { utilization: 88, resets_at: null },
    },
  };

  test('percentages become the 0-1 scale everything else pace against', () => {
    const w = new Map(windowsFromUsage(reading));
    assert.equal(w.get('five_hour')?.utilization, 0.34);
    assert.equal(w.get('seven_day')?.utilization, 0.715);
    assert.equal(w.get('seven_day_opus')?.utilization, 0.88);
  });

  test('the fullest window is the one to pace against, not the last one seen', () => {
    assert.equal(worstWindow(windowsFromUsage(reading))?.utilization, 0.88);
  });

  test('the weekly figure is separable from the five-hour one', () => {
    assert.equal(worstWindow(windowsFromUsage(reading), isWeekly)?.utilization, 0.88);
  });

  test('88% would trip a pause set at 92%? no — but 0.88 is compared, not 88', () => {
    // The bug this guards: a 0-100 figure left unconverted reads as 8800% and
    // pauses a company that has used a third of its week.
    const worst = worstWindow(windowsFromUsage(reading))?.utilization ?? 0;
    assert.ok(worst <= 1, `${worst} is not on the 0-1 scale`);
    assert.equal(worst > 0.92, false);
  });

  test('a window with no reading is skipped rather than counted as zero', () => {
    const w = new Map(windowsFromUsage({
      rate_limits_available: true,
      rate_limits: { five_hour: { utilization: null, resets_at: null },
                     seven_day: { utilization: 12, resets_at: null } },
    }));
    assert.equal(w.has('five_hour'), false);
    assert.equal(w.get('seven_day')?.utilization, 0.12);
  });

  test('an API-key session has no plan limits and yields nothing', () => {
    assert.deepEqual(windowsFromUsage({ rate_limits_available: false, rate_limits: null }), []);
    assert.deepEqual(windowsFromUsage(null), []);
    assert.deepEqual(windowsFromUsage(undefined), []);
  });

  test('a window the event type does not know is still kept and still weekly', () => {
    const w = new Map(windowsFromUsage({
      rate_limits_available: true,
      rate_limits: { seven_day_oauth_apps: { utilization: 40, resets_at: null } },
    }));
    assert.equal(w.get('seven_day_oauth_apps')?.utilization, 0.4);
    assert.equal(worstWindow(w, isWeekly)?.utilization, 0.4);
  });

  test('a reset time is carried through as epoch seconds', () => {
    const w = new Map(windowsFromUsage(reading));
    assert.equal(w.get('five_hour')?.resetsAt, Date.parse('2026-09-03T11:00:00.000Z') / 1000);
  });
});

/**
 * A `setup-token` credential carries `user:inference` and not `user:profile`,
 * so a container holding one spends the subscription without being able to see
 * what is left. Downstream that is indistinguishable from a plan with room —
 * which is how a whole night got paced off token counts nobody is billed for.
 */
describe('a plan the runtime cannot see is not a plan with room', () => {
  test('a scopeless credential is reported as unreadable, not as empty', () => {
    assert.equal(limitsReadable({ rate_limits_available: false, rate_limits: null }), false);
  });

  test('a reading that answers is readable even when every window is null', () => {
    assert.equal(limitsReadable({ rate_limits_available: true, rate_limits: { five_hour: null } }), true);
  });

  test('no reading at all is not a claim either way about the plan', () => {
    assert.equal(limitsReadable(null), false);
    assert.equal(limitsReadable(undefined), false);
  });
});
