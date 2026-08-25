<script setup lang="ts">
import { ref, onMounted, watch, computed } from 'vue';
import { api, type Approval, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';

const props = defineProps<{ state: State; events: Event[] }>();
const emit = defineEmits<{ changed: [] }>();

const who = computed(() => namer(props.state));
const items = ref<Approval[]>([]);
const elsewhere = ref<Approval[]>([]);
const drafts = ref<Record<string, string>>({});
const reason = ref('');
const busy = ref('');
/** What the board already settled. The queue empties; the record should not. */
const settled = ref<Approval[]>([]);
const openRecord = ref(new Set<string>());

const load = async () => {
  settled.value = (await api.decided()).approvals;
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

/** Pull a settled draft only when someone opens it — there can be forty. */
const recall = async (a: Approval) => {
  const next = new Set(openRecord.value);
  if (next.has(a.id)) next.delete(a.id); else next.add(a.id);
  openRecord.value = next;
  if (!next.has(a.id) || drafts.value[a.id]) return;
  const path = a.payloadJson ? (JSON.parse(a.payloadJson).draftPath as string | undefined) : undefined;
  if (!path) return;
  try { drafts.value[a.id] = (await api.doc(path)).body; }
  catch { drafts.value[a.id] = '(the draft file is no longer there)'; }
};

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

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
onEvents(() => props.events, /^(gate\.escalate|approval\.)/, load);
</script>

<template>
  <div class="wrap">
    <h1>The Envelope</h1>
    <p class="muted lede">
      Nothing reaches the world without this page. Read it before you answer —
      a reason is what reaches the author on their next waking.
    </p>

    <div v-if="!items.length" class="empty">
      <p class="muted">
        <template v-if="settled.length">
          Nothing is waiting on you. Everything proposed so far is below.
        </template>
        <template v-else>
          Nothing is waiting on you, and nothing has ever been proposed — this
          company has not tried to reach outside itself yet.
        </template>
      </p>
    </div>

    <article v-for="a in items" :key="a.id" class="item">
      <header>
        <span class="who">{{ who(a.requestedBy) }}</span>
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

    <!-- The queue empties as the board works, which left a company that had
         published twice and refused twice showing an empty page. What went out
         — and what was turned down, and why — is the part worth keeping. -->
    <section v-if="settled.length" class="settled">
      <h2>Already decided</h2>
      <p class="muted note">
        What has left this company, and what was sent back. The reason is the
        precedent — it is what the author read, and what the next one will.
      </p>
      <article v-for="a in settled" :key="a.id" class="past" :class="a.state">
        <button class="row open" :aria-expanded="openRecord.has(a.id)" @click="recall(a)">
          <span class="verdict mono">{{ a.state === 'approved' ? 'sent' : 'sent back' }}</span>
          <span class="who">{{ who(a.requestedBy) }}</span>
          <span class="summary-line">{{ a.summary }}</span>
          <span class="grow" />
          <span class="faint mono">{{ when(a.decidedAt) }}</span>
        </button>
        <template v-if="openRecord.has(a.id)">
          <p v-if="a.decisionReason" class="because">
            <span class="faint mono lbl">{{ who(a.decidedBy) }} said</span>
            {{ a.decisionReason }}
          </p>
          <p v-else class="because faint">Decided without a reason on record.</p>
          <div v-if="drafts[a.id]" class="draft body" v-html="render(drafts[a.id]!)" />
        </template>
      </article>
    </section>

    <!-- Not the board's to decide, but the board should be able to see what it
         is not being asked about. Reading it is not the same as signing it. -->
    <section v-if="elsewhere.length" class="elsewhere">
      <h2>Waiting on the CEO</h2>
      <p class="muted note">Yours to watch, not to sign.</p>
      <div v-for="a in elsewhere" :key="a.id" class="row">
        <span class="who">{{ who(a.requestedBy) }}</span>
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

.settled { margin-top: 40px; padding-top: 8px; border-top: 1px solid var(--line); }
.settled h2 { font-size: 17px; margin-top: 20px; }
.settled .note { font-size: 13px; margin: 6px 0 16px; max-width: 62ch; }
.past { border: 1px solid var(--line); border-left: 3px solid var(--line);
  border-radius: 6px; background: var(--panel); margin-bottom: 6px; overflow: hidden; }
.past.approved { border-left-color: var(--ok); }
.past.rejected { border-left-color: var(--alert); }
.row.open { display: flex; align-items: baseline; gap: 12px; width: 100%; text-align: left;
  background: none; border: 0; padding: 10px 14px; cursor: pointer; font: inherit; color: inherit; }
.row.open:hover { background: #1a1512; }
.verdict { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; flex: none;
  width: 8ch; color: var(--muted); }
.past.approved .verdict { color: var(--ok); }
.past.rejected .verdict { color: var(--alert); }
.because { margin: 0 14px 12px; padding: 10px 12px; border-radius: 5px; background: #15100d;
  font-size: 14px; line-height: 1.6; }
.because .lbl { display: block; font-size: 10px; letter-spacing: .06em;
  text-transform: uppercase; margin-bottom: 4px; }
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
