<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import { api, stream, type State, type Event } from './api';
import Envelope from './views/Envelope.vue';
import Record from './views/Record.vue';
import Staff from './views/Staff.vue';
import Feed from './views/Feed.vue';
import Commons from './views/Commons.vue';
import Work from './views/Work.vue';

const VIEWS = [
  { id: 'envelope', label: 'Envelope', comp: Envelope },
  { id: 'record',   label: 'Record',   comp: Record },
  { id: 'staff',    label: 'Staff',    comp: Staff },
  { id: 'work',     label: 'Work',     comp: Work },
  { id: 'commons',  label: 'Commons',  comp: Commons },
  { id: 'feed',     label: 'Feed',     comp: Feed },
] as const;

const view = ref<string>('envelope');
const state = ref<State | null>(null);
const events = ref<Event[]>([]);
const err = ref('');

const current = computed(() => VIEWS.find((v) => v.id === view.value)?.comp ?? Envelope);

const refresh = async () => {
  try { state.value = await api.state(); err.value = ''; }
  catch (e) { err.value = e instanceof Error ? e.message : String(e); }
};

let stop: (() => void) | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  await refresh();
  stop = stream((batch) => {
    events.value = [...batch.reverse(), ...events.value].slice(0, 300);
    // Anything that changes what is waiting on the board should update the count.
    if (batch.some((e) => e.kind.startsWith('gate.escalate') || e.kind.startsWith('approval.')
      || e.kind === 'role.filled' || e.kind === 'commons.posted')) void refresh();
  });
  timer = setInterval(refresh, 20_000);
});
onUnmounted(() => { stop?.(); if (timer) clearInterval(timer); });

const util = computed(() => {
  const u = state.value?.rateLimit?.utilization;
  return u == null ? null : Math.round(u * 100);
});
</script>

<template>
  <div class="shell">
    <nav class="rail">
      <div class="brand">
        <h2>{{ state?.company.name ?? 'The Desk' }}</h2>
        <div class="faint biz">{{ state?.company.business }}</div>
      </div>
      <button v-for="v in VIEWS" :key="v.id" class="navitem"
              :class="{ on: view === v.id }" @click="view = v.id">
        <span>{{ v.label }}</span>
        <span v-if="v.id === 'envelope' && state?.pendingBoard" class="pill">{{ state.pendingBoard }}</span>
        <span v-else-if="v.id === 'staff' && state" class="faint">{{ state.headcount }}</span>
      <span v-else-if="v.id === 'work' && state?.tasks" class="faint">{{ state.tasks }}</span>
        <span v-else-if="v.id === 'commons' && state" class="faint">
          {{ state.commons.held }}/{{ state.commons.ceiling }}
        </span>
      </button>
      <div class="grow" />
      <div class="who faint" v-if="state">
        <div v-for="b in state.board" :key="b.id">{{ b.name }} · {{ b.role }}</div>
      </div>
    </nav>

    <main class="main">
      <div v-if="err" class="err">Can't reach the company — {{ err }}</div>
      <component v-else-if="state" :is="current" :state="state" :events="events" @changed="refresh" />
      <div v-else class="muted pad">Opening the books…</div>
    </main>

    <footer class="status mono" v-if="state">
      <span :style="{ color: state.running ? 'var(--ok)' : 'var(--faint)' }">
        {{ state.running ? '● working' : '○ idle' }}
      </span>
      <span>{{ state.pendingBoard }} waiting on you</span>
      <span>{{ state.headcount }} staff</span>
      <span>commons {{ state.commons.held }}/{{ state.commons.ceiling }}</span>
      <span v-if="util !== null">{{ state.rateLimit?.rateLimitType ?? 'limit' }} {{ util }}%</span>
      <span class="grow" />
      <span class="faint">{{ state.seq }} events</span>
    </footer>
  </div>
</template>

<style scoped>
.shell { display: grid; grid-template-columns: 208px 1fr; grid-template-rows: 1fr 34px; height: 100%; }
.rail {
  grid-row: 1 / span 2; background: var(--rail); border-right: 1px solid var(--line);
  padding: 22px 0 14px; display: flex; flex-direction: column; overflow: hidden;
}
.brand { padding: 0 20px 20px; }
.brand h2 { font-size: 18px; line-height: 1.25; }
.biz { font-size: 12px; margin-top: 4px; }
.navitem {
  background: none; border: 0; border-radius: 0; text-align: left;
  padding: 9px 20px; display: flex; align-items: center; gap: 8px;
  color: var(--muted); font-size: 14px; width: 100%;
}
.navitem:hover { background: #1a1512; color: var(--ink-2); }
.navitem.on { background: var(--panel); color: var(--ink); box-shadow: inset 2px 0 0 var(--accent); }
.navitem span:first-child { flex: 1; }
.pill { background: var(--alert); color: #fff; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 600; }
.grow { flex: 1; }
.who { padding: 0 20px; font-size: 12px; line-height: 1.7; }
.main { overflow-y: auto; }
.pad { padding: 40px; }
.err { margin: 40px; padding: 16px; border: 1px solid #5c2f26; background: #241611; border-radius: 6px; }
.status {
  grid-column: 2; background: var(--rail); border-top: 1px solid var(--line);
  display: flex; align-items: center; gap: 20px; padding: 0 26px; font-size: 11px; color: var(--faint);
}
</style>
