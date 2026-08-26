<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Event, State } from '../api';
import { namer } from '../names';
import Pager from '../Pager.vue';
import Toolbar, { type SortOption } from '../Toolbar.vue';

const props = defineProps<{ events: Event[]; state: State }>();
const who = computed(() => namer(props.state));
const filter = ref('');
const page = ref(0);

/** An event is a line, so pages can be long — but the reader chooses. */
const SIZES = [10, 25, 40, 100];
const perPage = ref(Number(localStorage.getItem('riff.feedPerPage')) || 40);
watch(perPage, (n) => { try { localStorage.setItem('riff.feedPerPage', String(n)); } catch { /* no storage */ } });

/**
 * The machinery, as opposed to the work.
 *
 * Two thirds of a busy company's log is this: a permission check that passed,
 * a staff member waking up, a memory rewritten on schedule. All of it is true
 * and none of it is ever the answer to "what happened while I was out". Left
 * in, it buries the four events that were.
 *
 * A DENY list rather than an allow list, deliberately. A kind nobody has
 * thought about yet is far more likely to matter than not, and a console that
 * silently hides events it does not recognise is how you miss the one that
 * did. Everything new shows up until someone decides it is plumbing.
 */
const ROUTINE = new Set([
  'gate.allow',          // 46% of a busy company's log; a check that passed
  'agent.woke',          // the heartbeat — who is awake is already in the status bar
  'agent.slept',
  'memory.consolidated', // housekeeping on a schedule
  'agent.activity',      // recorded so it can be recovered, not so it can be read
]);
// Deliberately NOT here: message.sent. A sixth of the log is staff writing to
// each other, and that is the company working — the closest thing to a
// narrative the feed has. Hiding it left a page that looked like nothing had
// happened all day.

const all = ref(false);
const matches = (e: Event) => !filter.value
  || (who.value(e.actor) + e.kind + who.value(e.subject) + detail(e)).toLowerCase()
       .includes(filter.value.toLowerCase());

const kept = computed(() => props.events.filter((e) => (all.value || !ROUTINE.has(e.kind)) && matches(e)));
const hidden = computed(() => props.events.filter((e) => ROUTINE.has(e.kind) && matches(e)).length);

const SORTS: SortOption[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'actor', label: 'By person' },
];
const sort = ref<string>(localStorage.getItem('riff.feedSort') ?? 'newest');
watch(sort, (v) => { try { localStorage.setItem('riff.feedSort', v); } catch { /* no storage */ } });

const ordered = computed(() => {
  const list = [...kept.value];
  // The stream arrives newest-first, so that order needs no work.
  if (sort.value === 'oldest') list.reverse();
  else if (sort.value === 'actor') {
    list.sort((a, b) => who.value(a.actor).localeCompare(who.value(b.actor)) || b.seq - a.seq);
  }
  return list;
});

const pages = computed(() => Math.max(1, Math.ceil(ordered.value.length / perPage.value)));
const shown = computed(() =>
  ordered.value.slice(page.value * perPage.value, page.value * perPage.value + perPage.value));

// Live events arrive at the top while you are reading page three. The page you
// are on must not slide out from under you, but it must not outlive the list.
watch(pages, (n) => { if (page.value >= n) page.value = n - 1; });
// Re-ordering resets the page, as filtering does.
watch([filter, all, sort, perPage], () => { page.value = 0; });

const tone = (kind: string) =>
  kind.startsWith('gate.deny') || kind === 'agent.failed' ? 'deny'
  : kind.startsWith('gate.escalate') || kind === 'company.rate_limited' ? 'wait'
  : kind.startsWith('approval.') || kind === 'role.filled' || kind === 'agent.woke' ? 'good' : '';

function detail(e: Event): string {
  if (!e.dataJson) return '';
  try {
    const d = JSON.parse(e.dataJson) as Record<string, unknown>;
    return (d['reason'] ?? d['summary'] ?? d['text'] ?? d['activity'] ?? d['title'] ?? '') as string;
  } catch { return ''; }
}
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>Feed</h1>
        <p class="muted lede">Live. Newest first. Nothing here is retold to you later.</p>
      </div>
    </header>

    <Toolbar v-model:filter="filter" v-model:sort="sort" :sorts="SORTS"
             v-model:per-page="perPage" :sizes="SIZES" label="Filter events"
             :count="`${kept.length} event${kept.length === 1 ? '' : 's'}`">
      <button class="ghost scope" :class="{ on: !all }" @click="all = false">What changed</button>
      <button class="ghost scope" :class="{ on: all }" @click="all = true">Everything</button>
    </Toolbar>

    <ol class="feed">
      <li v-for="e in shown" :key="e.id" :class="tone(e.kind)">
        <span class="t faint mono">{{ new Date(e.at).toLocaleTimeString() }}</span>
        <span class="actor">{{ who(e.actor) }}</span>
        <span class="kind mono">{{ e.kind }}</span>
        <span class="detail muted">{{ detail(e) || who(e.subject) }}</span>
      </li>
    </ol>

    <p v-if="!kept.length" class="muted">
      <template v-if="hidden">
        Nothing but routine. {{ hidden }} permission check{{ hidden === 1 ? '' : 's' }},
        waking{{ hidden === 1 ? '' : 's' }} and the like — Everything shows them.
      </template>
      <template v-else>Quiet. Events appear as they happen.</template>
    </p>

    <p v-else-if="!all && hidden" class="muted note">
      {{ hidden }} routine event{{ hidden === 1 ? '' : 's' }} hidden — permission checks,
      wakings and scheduled memory rewrites.
    </p>

    <Pager v-model:page="page" :pages="pages" />
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 1100px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 20px; font-size: 14px; }
input { background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 7px 10px; font: inherit; font-size: 13px; width: 180px; }

.bar { display: flex; align-items: center; gap: 6px; padding-bottom: 12px;
  border-bottom: 1px solid var(--line); margin-bottom: 10px; }
.count { font-size: 11px; }
.grow { flex: 1; }
.scope { font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  border: 1px solid transparent; border-radius: 4px; padding: 3px 7px; }
.scope.on { color: var(--gold); border-color: var(--line-2); }

.feed { list-style: none; }
.feed li { display: grid; grid-template-columns: 74px 116px 168px 1fr; gap: 12px; align-items: baseline;
  padding: 6px 8px; border-left: 2px solid transparent; }
.feed li:hover { background: #1a1512; }
.feed li.deny { border-left-color: var(--alert); }
.feed li.wait { border-left-color: var(--gold); }
.feed li.good { border-left-color: var(--ok); }
.t { font-size: 11px; }
.actor { color: var(--accent); font-size: 13px; }
.kind { font-size: 11px; color: var(--muted); }
.detail { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.note { font-size: 12px; margin-top: 14px; text-align: center; }
</style>
