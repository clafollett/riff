<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { api } from '../api';

const since = ref('3.days');
const data = ref<Awaited<ReturnType<typeof api.happened>> | null>(null);
const loading = ref(true);

const load = async () => {
  loading.value = true;
  try { data.value = await api.happened(since.value); } finally { loading.value = false; }
};
const pick = (s: string) => { since.value = s; void load(); };
onMounted(load);

const RANGES = [['1.day', 'Today'], ['3.days', '3 days'], ['1.week', 'A week'], ['1.month', 'A month']] as const;
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>The Record</h1>
        <p class="muted lede">Not what they said they'd do. What is actually in the world.</p>
      </div>
      <div class="ranges">
        <button v-for="[v, label] in RANGES" :key="v" class="ghost"
                :class="{ on: since === v }" @click="pick(v)">{{ label }}</button>
      </div>
    </header>

    <div v-if="loading" class="muted">Reading the log…</div>
    <template v-else-if="data">
      <div v-if="data.contributions.length" class="tally">
        <div v-for="c in data.contributions" :key="c.author" class="who">
          <span class="n mono">{{ c.commits }}</span>
          <span>{{ c.author }}</span>
        </div>
      </div>

      <ol class="log">
        <li v-for="c in data.commits" :key="c.sha">
          <span class="sha mono">{{ c.sha.slice(0, 7) }}</span>
          <span class="subject">{{ c.subject }}</span>
          <span class="by">{{ c.author }}</span>
          <span class="when faint mono">{{ new Date(c.at).toLocaleString() }}</span>
        </li>
      </ol>
      <p v-if="!data.commits.length" class="muted">Nothing landed in this window.</p>
    </template>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px; max-width: 1000px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 26px; font-size: 14px; }
.ranges { display: flex; gap: 6px; }
.ghost.on { border-color: var(--accent); color: var(--accent); }
.tally { display: flex; flex-wrap: wrap; gap: 22px; padding: 14px 18px; background: var(--panel);
  border: 1px solid var(--line); border-radius: 7px; margin-bottom: 24px; }
.who { display: flex; align-items: baseline; gap: 8px; }
.n { font-size: 20px; color: var(--gold); }
.log { list-style: none; }
.log li { display: grid; grid-template-columns: 62px 1fr auto auto; gap: 14px; align-items: baseline;
  padding: 9px 2px; border-bottom: 1px solid var(--line); }
.sha { color: var(--faint); font-size: 12px; }
.subject { font-family: var(--serif); font-size: 15px; }
.by { color: var(--accent); font-size: 12px; }
.when { font-size: 11px; }
</style>
