<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Event } from '../api';

const props = defineProps<{ events: Event[] }>();
const filter = ref('');

/** Events whose kind carries no information a person would act on. */
const NOISE = /^(agent\.heartbeat|tick\.(start|end))$/;

const shown = computed(() => props.events
  .filter((e) => !NOISE.test(e.kind))
  .filter((e) => !filter.value || (e.actor + e.kind + (e.subject ?? '')).includes(filter.value)));

const tone = (kind: string) =>
  kind.startsWith('gate.deny') ? 'deny'
  : kind.startsWith('gate.escalate') ? 'wait'
  : kind.startsWith('approval.') || kind === 'role.filled' ? 'good' : '';

const detail = (e: Event) => {
  if (!e.dataJson) return '';
  try {
    const d = JSON.parse(e.dataJson) as Record<string, unknown>;
    return (d.reason ?? d.summary ?? d.text ?? d.activity ?? '') as string;
  } catch { return ''; }
};
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>Feed</h1>
        <p class="muted lede">Live. Newest first. Nothing here is retold to you later.</p>
      </div>
      <input v-model="filter" placeholder="filter…" />
    </header>

    <ol class="feed">
      <li v-for="e in shown" :key="e.id" :class="tone(e.kind)">
        <span class="t faint mono">{{ new Date(e.at).toLocaleTimeString() }}</span>
        <span class="actor">{{ e.actor }}</span>
        <span class="kind mono">{{ e.kind }}</span>
        <span class="detail muted">{{ detail(e) || e.subject || '' }}</span>
      </li>
    </ol>
    <p v-if="!shown.length" class="muted">Quiet. Events appear as they happen.</p>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px; max-width: 1100px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 22px; font-size: 14px; }
input { background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 7px 10px; font: inherit; font-size: 13px; width: 180px; }
.feed { list-style: none; }
.feed li { display: grid; grid-template-columns: 74px 96px 168px 1fr; gap: 12px; align-items: baseline;
  padding: 6px 8px; border-left: 2px solid transparent; }
.feed li:hover { background: #1a1512; }
.feed li.deny { border-left-color: var(--alert); }
.feed li.wait { border-left-color: var(--gold); }
.feed li.good { border-left-color: var(--ok); }
.t { font-size: 11px; }
.actor { color: var(--accent); font-size: 13px; }
.kind { font-size: 11px; color: var(--muted); }
.detail { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
