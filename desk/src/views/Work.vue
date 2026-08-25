<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api, type Task, type Work, type State, type Event } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';

const props = defineProps<{ state: State; events: Event[] }>();

const who = computed(() => namer(props.state));
const work = ref<Work | null>(null);
const open = ref<string | null>(null);

const load = async () => { work.value = await api.work(); };
onMounted(load);
onEvents(() => props.events, /^(task\.|role\.|note\.)/, load);

const byStatus = computed(() => {
  const t = work.value?.tasks ?? [];
  // The real TaskStatus union, in the order a person wants to read it.
  const rank: Record<string, number> = {
    blocked: 0, in_progress: 1, claimed: 2, open: 3, done: 4, dropped: 5,
  };
  return [...t].sort((a, b) =>
    (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || b.priority - a.priority);
});
// Dropped is not finished and it is certainly not in flight. For a company
// whose weakest seam is removal, abandoning a task deliberately is a signal
// worth its own heading rather than something to bury under "done".
const ENDED = new Set(['done']);
const GONE = new Set(['dropped']);
const live = computed(() => byStatus.value.filter((t) => !ENDED.has(t.status) && !GONE.has(t.status)));
const done = computed(() => byStatus.value.filter((t) => ENDED.has(t.status)));
const gone = computed(() => byStatus.value.filter((t) => GONE.has(t.status)));
</script>

<template>
  <div class="wrap">
    <h1>Work</h1>
    <p class="muted lede">
      What the staff opened for themselves. Nobody here was handed a backlog —
      every one of these is a thing somebody decided was worth doing.
    </p>

    <!-- A reporting line pointing at nobody is the shape a bad rename leaves
         behind, and it used to be visible only from a terminal. -->
    <div v-if="work?.orphans.length" class="warn">
      <strong>{{ work.orphans.length }} broken reporting line{{ work.orphans.length > 1 ? 's' : '' }}.</strong>
      <span v-for="o in work.orphans" :key="o.id">
        {{ o.name }} reports to <code>{{ o.reportsTo }}</code>, who does not work here.
      </span>
    </div>

    <div v-if="work" class="tally">
      <span><b>{{ live.length }}</b> in flight</span>
      <span><b>{{ done.length }}</b> finished</span>
      <span v-if="gone.length"><b>{{ gone.length }}</b> dropped</span>
      <span><b>{{ work.notes }}</b> notes on each other</span>
      <span><b>{{ state.seq }}</b> events</span>
    </div>

    <p v-if="work && !work.tasks.length" class="muted empty">
      No open tasks. This company works from its own rulings and records rather
      than a queue, which is a finding rather than a fault.
    </p>

    <section v-if="live.length">
      <h2>In flight</h2>
      <article v-for="t in live" :key="t.id" class="task" :class="t.status">
        <header @click="open = open === t.id ? null : t.id">
          <span class="status">{{ t.status.replace('_', ' ') }}</span>
          <span class="title">{{ t.title }}</span>
          <span class="grow" />
          <span class="who faint">{{ who(t.assignedTo ?? t.createdBy) }}</span>
        </header>
        <div v-if="open === t.id && t.body" class="body detail" v-html="render(t.body)" />
      </article>
    </section>

    <section v-if="gone.length">
      <h2>Dropped on purpose</h2>
      <article v-for="t in gone" :key="t.id" class="task gone">
        <header @click="open = open === t.id ? null : t.id">
          <span class="status">{{ t.status.replace('_', ' ') }}</span>
          <span class="title">{{ t.title }}</span>
          <span class="grow" />
          <span class="who faint">{{ who(t.assignedTo ?? t.createdBy) }}</span>
        </header>
        <div v-if="open === t.id && t.body" class="body detail" v-html="render(t.body)" />
      </article>
    </section>

    <section v-if="done.length">
      <h2>Finished</h2>
      <article v-for="t in done" :key="t.id" class="task done">
        <header @click="open = open === t.id ? null : t.id">
          <span class="status">done</span>
          <span class="title">{{ t.title }}</span>
          <span class="grow" />
          <span class="who faint">{{ who(t.assignedTo ?? t.createdBy) }}</span>
        </header>
        <div v-if="open === t.id && t.body" class="body detail" v-html="render(t.body)" />
      </article>
    </section>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 980px; }
h1 { font-size: 30px; }
h2 { font-size: 13px; font-family: var(--sans); text-transform: uppercase;
  letter-spacing: .1em; color: var(--faint); margin: 34px 0 10px; }
.lede { margin: 6px 0 24px; font-size: 14px; max-width: 62ch; }
.empty { font-size: 15px; max-width: 58ch; }
.warn { border: 1px solid #5c3a26; background: #241a11; border-radius: 5px;
  padding: 12px 16px; margin-bottom: 20px; font-size: 14px;
  display: flex; flex-direction: column; gap: 4px; }
.tally { display: flex; flex-wrap: wrap; gap: 22px; padding: 13px 18px;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  font-size: 13px; color: var(--muted); }
.tally b { color: var(--gold); font-family: var(--mono); font-size: 16px; margin-right: 5px; }
.task { border: 1px solid var(--line); border-radius: 5px; background: var(--panel); margin-bottom: 7px; }
.task header { display: flex; align-items: baseline; gap: 12px; padding: 11px 15px; cursor: pointer; }
.task header:hover { background: #1a1512; }
.status { font-family: var(--mono); font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; color: var(--gold); width: 72px; flex: none; }
.task.done .status { color: var(--ok); }
.task.blocked .status { color: var(--alert); }
.task.gone .status { color: var(--accent); }
.task.gone .title { color: var(--muted); text-decoration: line-through;
  text-decoration-color: var(--line-2); }
.title { font-family: var(--serif); font-size: 16px; color: var(--ink); }
.task.done .title { color: var(--muted); }
.grow { flex: 1; }
.who { font-size: 11px; }
.detail { padding: 4px 15px 16px; font-size: 14px; }
</style>
