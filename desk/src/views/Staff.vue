<script setup lang="ts">
import { ref, computed } from 'vue';
import { api, type Agent, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';

const props = defineProps<{ state: State; events: Event[] }>();
const open = ref<string | null>(null);
const persona = ref('');
const draft = ref('');
const sending = ref(false);

/** Report lines, walked from the board down. Depth is for the indent. */
const tree = computed(() => {
  const out: Array<{ a: Agent; depth: number }> = [];
  const walk = (parent: string | null, depth: number) => {
    for (const a of props.state.agents.filter((x) => x.reportsTo === parent)) {
      out.push({ a, depth });
      walk(a.id, depth + 1);
    }
  };
  walk(null, 0);
  // Anyone orphaned by a rename still deserves a line rather than vanishing.
  for (const a of props.state.agents) if (!out.some((o) => o.a.id === a.id)) out.push({ a, depth: 0 });
  return out;
});

const select = async (a: Agent) => {
  open.value = open.value === a.id ? null : a.id;
  persona.value = '';
  if (!open.value) return;
  try { persona.value = (await api.doc(`staff/${a.id}/persona.md`)).body; }
  catch { persona.value = a.mandate; }
};

onEvents(() => props.events, /^(agent\.slept|remember)/, async () => {
  const id = open.value;
  if (!id) return;
  const a = props.state.agents.find((x) => x.id === id);
  if (a) { try { persona.value = (await api.doc(`staff/${id}/persona.md`)).body; } catch { /* keep */ } }
});

const send = async (a: Agent) => {
  if (!draft.value.trim()) return;
  sending.value = true;
  await api.say(a.id, draft.value.trim());
  draft.value = '';
  sending.value = false;
};
</script>

<template>
  <div class="wrap">
    <h1>Staff</h1>
    <p class="muted lede">
      Everyone here was hired by someone here. The only two seats not chosen from inside are the board and the CEO.
    </p>

    <div v-for="{ a, depth } in tree" :key="a.id" class="row" :style="{ marginLeft: depth * 24 + 'px' }">
      <button class="card" :class="{ on: open === a.id }" @click="select(a)">
        <span class="dot" :class="[a.status, { awake: state.awake.includes(a.id) }]" />
        <span class="name">{{ a.name }}</span>
        <span class="role">{{ a.role }}</span>
        <span class="faint tier mono">{{ a.tier }}</span>
        <span class="grow" />
        <span v-if="state.awake.includes(a.id)" class="now mono">working now</span>
        <span class="activity muted">{{ a.activity || '—' }}</span>
      </button>

      <div v-if="open === a.id" class="detail">
        <div class="meta faint mono">
          {{ a.department }} · hired {{ new Date(a.hiredAt).toLocaleDateString() }}
          <template v-if="a.hiredBy"> by {{ a.hiredBy }}</template>
        </div>
        <div class="persona body" v-html="render(persona || 'No persona on file.')" />
        <div class="say">
          <textarea v-model="draft" rows="2" placeholder="Leave word. They read it when they next wake." />
          <button class="go" :disabled="sending" @click="send(a)">Send</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px; max-width: 1000px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 26px; font-size: 14px; max-width: 64ch; }
.row { margin-bottom: 6px; }
.card { width: 100%; display: flex; align-items: baseline; gap: 12px; text-align: left;
  background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 11px 15px; }
.card:hover { border-color: var(--line-2); }
.card.on { border-color: var(--accent); }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); align-self: center; flex: none; }
.dot.working, .dot.active { background: var(--ok); }
.dot.departed { background: #5a463c; }
.dot.awake { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 22%, transparent); }
.now { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--ok); }
@media (prefers-reduced-motion: no-preference) {
  .dot.awake { animation: pulse 1.8s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: .45; } }
}
.name { font-family: var(--serif); font-size: 17px; color: var(--ink); white-space: nowrap; }
.role { color: var(--accent); font-size: 13px; white-space: nowrap; }
.tier { white-space: nowrap; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; }
.grow { flex: 1; }
.activity { font-size: 12px; font-style: italic; max-width: 40ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.detail { border: 1px solid var(--line); border-top: 0; border-radius: 0 0 6px 6px;
  background: #191411; padding: 16px 18px; margin: -6px 0 14px; }
.meta { font-size: 11px; margin-bottom: 12px; }
.persona { font-size: 14px; color: var(--ink-2); max-height: 380px; overflow-y: auto; }
.say { display: flex; gap: 8px; margin-top: 14px; }
.say textarea { flex: 1; font: inherit; font-size: 13px; background: #15100d; color: var(--ink);
  border: 1px solid var(--line-2); border-radius: 5px; padding: 8px; resize: vertical; }
</style>
