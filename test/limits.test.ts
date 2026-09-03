import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import { worstWindow, isWeekly } from '../src/runtime/limits.ts';

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
