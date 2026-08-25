import { watch } from 'vue';
import type { Event } from './api';

/**
 * Re-run a loader when the company does something that changes what a view is
 * showing.
 *
 * Views used to load once on mount, so a document posted while you were
 * looking at the commons simply did not appear until you navigated away and
 * back. The event stream already knows; this connects it.
 *
 * Each view names the kinds it cares about rather than reloading on every
 * event, so a busy feed does not turn into a request storm.
 */
export const onEvents = (
  events: () => Event[],
  kinds: RegExp,
  reload: () => void | Promise<void>,
): void => {
  watch(events, (now, before) => {
    // Only the batch that just arrived — the array is a rolling window, so
    // comparing lengths would re-fire on every trim.
    const fresh = now.slice(0, Math.max(0, now.length - (before?.length ?? 0)));
    const seen = fresh.length ? fresh : now.slice(0, 1);
    if (seen.some((e) => kinds.test(e.kind))) void reload();
  });
};
