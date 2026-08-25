<script setup lang="ts">
import { ref, onMounted, watch } from 'vue';
import { api, type Approval, type State } from '../api';
import { render } from '../markdown';

const props = defineProps<{ state: State }>();
const emit = defineEmits<{ changed: [] }>();

const items = ref<Approval[]>([]);
const elsewhere = ref<Approval[]>([]);
const drafts = ref<Record<string, string>>({});
const reason = ref('');
const busy = ref('');

const load = async () => {
  const all = await api.approvals();
  items.value = all.filter((a) => a.tier === 'board');
  elsewhere.value = all.filter((a) => a.tier !== 'board');
  // Pull each draft's full text. A review gate whose contents you have to go
  // hunting for gets rubber-stamped, which is worse than no gate.
  for (const a of items.value) {
    const path = a.payloadJson ? (JSON.parse(a.payloadJson).draftPath as string | undefined) : undefined;
    if (!path || drafts.value[a.id]) continue;
    try { drafts.value[a.id] = (await api.doc(path)).body; }
    catch { drafts.value[a.id] = '(the draft file is missing — the approval points at nothing)'; }
  }
};

const decide = async (a: Approval, approved: boolean) => {
  busy.value = a.id;
  await api.decide(a.id, approved, reason.value.trim());
  reason.value = '';
  busy.value = '';
  await load();
  emit('changed');
};

onMounted(load);
watch(() => props.state.pendingBoard, load);
</script>

<template>
  <div class="wrap">
    <h1>The Envelope</h1>
    <p class="muted lede">
      Nothing reaches the world without this page. Read it before you answer —
      a reason is what reaches the author on their next waking.
    </p>

    <div v-if="!items.length" class="empty">
      <p class="muted">Nothing is waiting on you.</p>
    </div>

    <article v-for="a in items" :key="a.id" class="item">
      <header>
        <span class="who">{{ a.requestedBy }}</span>
        <span class="faint mono cap">{{ a.capability }}</span>
        <span class="grow" />
        <span class="faint mono">{{ new Date(a.requestedAt).toLocaleString() }}</span>
      </header>

      <p class="summary">{{ a.summary }}</p>

      <div v-if="drafts[a.id]" class="draft body" v-html="render(drafts[a.id]!)" />

      <textarea v-model="reason" rows="3"
        placeholder="Why. This is the part that reaches them — a decision without a reason teaches nothing." />

      <div class="actions">
        <button class="go" :disabled="busy === a.id" @click="decide(a, true)">Approve</button>
        <button class="no" :disabled="busy === a.id" @click="decide(a, false)">Send back</button>
        <span class="grow" />
        <span class="faint mono">{{ a.id }}</span>
      </div>
    </article>

    <!-- Not the board's to decide, but the board should be able to see what it
         is not being asked about. Reading it is not the same as signing it. -->
    <section v-if="elsewhere.length" class="elsewhere">
      <h2>Waiting on the CEO</h2>
      <p class="muted note">Yours to watch, not to sign.</p>
      <div v-for="a in elsewhere" :key="a.id" class="row">
        <span class="who">{{ a.requestedBy }}</span>
        <span class="faint mono cap">{{ a.capability }}</span>
        <span class="summary-line">{{ a.summary }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px; max-width: 940px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 28px; font-size: 14px; max-width: 62ch; }
.empty { padding: 30px 0; }
.item { border: 1px solid var(--line); border-radius: 7px; background: var(--panel); padding: 18px 20px; margin-bottom: 20px; }
header { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.who { color: var(--accent); font-weight: 600; }
.cap { font-size: 11px; letter-spacing: .08em; }
.grow { flex: 1; }
.summary { font-family: var(--serif); font-size: 17px; line-height: 1.55; margin: 0 0 16px; }
.draft {
  font-size: 15px; color: var(--ink-2); background: #191411; border: 1px solid var(--line);
  border-radius: 6px; padding: 20px 24px; max-height: 460px; overflow-y: auto; margin-bottom: 16px;
}
textarea {
  width: 100%; font: inherit; font-size: 13px; line-height: 1.6; background: #15100d;
  color: var(--ink); border: 1px solid var(--line-2); border-radius: 5px; padding: 10px; resize: vertical;
}
.actions { display: flex; align-items: center; gap: 9px; margin-top: 12px; }
.elsewhere { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 22px; }
.elsewhere h2 { font-size: 13px; font-family: var(--sans); text-transform: uppercase;
  letter-spacing: .1em; color: var(--faint); margin: 0; }
.elsewhere .note { font-size: 13px; margin: 4px 0 14px; }
.elsewhere .row { display: flex; align-items: baseline; gap: 12px; padding: 9px 0;
  border-bottom: 1px solid var(--line); }
.summary-line { font-size: 14px; color: var(--muted); overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
</style>
