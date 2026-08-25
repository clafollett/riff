<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api, type CommonsDoc, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';

const props = defineProps<{ state: State; events: Event[] }>();
const who = computed(() => namer(props.state));
const docs = ref<CommonsDoc[]>([]);
const open = ref<CommonsDoc | null>(null);
const body = ref('');
const html = computed(() => render(body.value));

const load = async () => { docs.value = (await api.commons()).documents; };
const read = async (d: CommonsDoc) => {
  open.value = d; body.value = '…';
  try { body.value = (await api.doc(d.path)).body; } catch (e) { body.value = String(e); }
};
onMounted(load);
onEvents(() => props.events, /^commons\./, async () => {
  await load();
  // Keep whatever is open readable; it may have just been rewritten.
  if (open.value) await read(open.value);
});

const pressure = computed(() => props.state.commons.held / props.state.commons.ceiling);
const shelf = (path: string) => path.replace(/^commons\//, '').split('/').slice(0, -1).join(' / ');
</script>

<template>
  <div class="wrap">
    <aside class="list">
      <header>
        <h1>Commons</h1>
        <div class="gauge">
          <div class="bar"><div class="fill" :style="{ width: Math.min(100, pressure * 100) + '%',
            background: pressure > 0.85 ? 'var(--alert)' : 'var(--gold)' }" /></div>
          <span class="faint mono">{{ state.commons.held }}/{{ state.commons.ceiling }}</span>
        </div>
        <p class="muted note">
          A ceiling, not a quota. At the top, adding means removing something that stopped being true.
        </p>
      </header>
      <button v-for="d in docs" :key="d.path" class="doc" :class="{ on: open?.path === d.path }" @click="read(d)">
        <span class="shelf faint mono">{{ shelf(d.path) }}</span>
        <span class="t">{{ d.title }}</span>
      </button>
      <p v-if="!docs.length" class="muted note">Nothing posted yet.</p>
    </aside>

    <article class="reader">
      <template v-if="open">
        <h2 class="title">{{ open.title }}</h2>
        <div class="faint mono meta">
          {{ open.path }}
          <template v-if="open.author"> · {{ who(open.author) }}</template>
          <template v-if="open.updated"> · {{ new Date(open.updated).toLocaleString() }}</template>
        </div>
        <div class="body" v-html="html" />
      </template>
      <p v-else class="muted center">Pick a document.</p>
    </article>
  </div>
</template>

<style scoped>
.wrap { display: grid; grid-template-columns: minmax(230px, 280px) 1fr; height: 100%; }
/* Below this the reader gets squeezed to a word per line, which is worse than
   no reader at all. Stack the index above it and let the page scroll. */
@media (max-width: 780px) {
  .wrap { grid-template-columns: 1fr; height: auto; }
  .list { border-right: 0; border-bottom: 1px solid var(--line); padding-bottom: 14px; }
  .reader { padding: 24px 22px 50px; }
}
.list { border-right: 1px solid var(--line); padding: 30px 0 20px; overflow-y: auto; }
.list header { padding: 0 22px 16px; }
h1 { font-size: 24px; }
.gauge { display: flex; align-items: center; gap: 9px; margin-top: 10px; }
.bar { flex: 1; height: 5px; background: #2a221c; border-radius: 3px; overflow: hidden; }
.fill { display: block; height: 100%; }
.note { font-size: 12px; line-height: 1.6; margin-top: 10px; }
.doc { display: block; width: 100%; text-align: left; background: none; border: 0; border-radius: 0; padding: 8px 22px; }
.doc:hover { background: #1a1512; }
.doc.on { background: var(--panel); box-shadow: inset 2px 0 0 var(--accent); }
.doc.on .t { color: var(--accent); }
.shelf { display: block; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.t { display: block; font-family: var(--serif); font-size: 15px; color: var(--muted); line-height: 1.35; margin-top: 2px; }
.doc:hover .t { color: var(--ink); }
.reader { overflow-y: auto; padding: 34px 46px 60px; }
.reader .title { font-size: 26px; margin-bottom: 0; }
.meta { font-size: 11px; margin: 8px 0 22px; }
/* Only the measure and size are local. Everything else comes from the shared
   .body rules — this used to carry white-space: pre-wrap from before the
   markdown renderer existed, which preserved the newline BETWEEN every pair of
   rendered blocks as a real blank line. */
.body { font-size: 16px; max-width: 74ch; }
.center { margin-top: 60px; text-align: center; }
</style>
