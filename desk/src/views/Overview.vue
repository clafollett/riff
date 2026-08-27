<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { api, type Event, type State } from '../api';
import { render } from '../markdown';

const props = defineProps<{ state: State; events: Event[] }>();
const emit = defineEmits<{ changed: [] }>();

/**
 * The company's front page: who it is, what it was founded to do, and how
 * much of it exists.
 *
 * The brief lived in one place — a line under the company name in the rail —
 * back when it was three words. It is a paragraph now, and a paragraph does
 * not belong in a navigation rail. It belongs here, whole and legible, where
 * it can also be changed.
 */
const editing = ref(false);
const draft = ref('');
const busy = ref(false);
const err = ref('');

const business = computed(() => props.state.company.business.trim());
const ceo = computed(() => props.state.ceo.name);

const start = () => { draft.value = props.state.company.business; err.value = ''; editing.value = true; };
const cancel = () => { editing.value = false; err.value = ''; };

// Switching companies while the editor is open would silently retarget the
// save at whichever company you just switched to.
watch(() => props.state.slug, cancel);

const save = async () => {
  busy.value = true;
  err.value = '';
  try {
    await api.renameCompany(props.state.slug, { business: draft.value });
    editing.value = false;
    emit('changed');
  } catch (e) {
    // Keeping the editor open keeps the text the founder just wrote.
    err.value = e instanceof Error ? e.message : 'Could not save the brief.';
  } finally {
    busy.value = false;
  }
};

const facts = computed(() => [
  { label: 'staff', value: String(props.state.headcount) },
  { label: 'commons', value: `${props.state.commons.held}/${props.state.commons.ceiling}` },
  { label: 'open work', value: String(props.state.tasks) },
  { label: 'notes', value: String(props.state.notes) },
  { label: 'waiting on you', value: String(props.state.pendingBoard) },
]);

const working = computed(() => props.state.awake.length);
</script>

<template>
  <div class="wrap">
    <header class="head">
      <h1>{{ state.company.name }}</h1>
      <p class="faint mono line">
        {{ state.slug }} · {{ ceo }}, CEO ·
        {{ working ? `${working} working now` : (state.running ? 'idle' : 'paused') }}
      </p>
    </header>

    <section class="brief">
      <div class="bar">
        <h2>The brief</h2>
        <span class="grow" />
        <button v-if="!editing" class="ghost" @click="start">Edit</button>
      </div>

      <template v-if="!editing">
        <div v-if="business" class="body" v-html="render(business)" />
        <p v-else class="muted none">
          Nothing was written down when this company was founded, so its CEO
          decided what it was for on their own.
        </p>
      </template>

      <template v-else>
        <textarea v-model="draft" rows="10"
          placeholder="What this company is for, who it is for, and what it should not become." />
        <p class="muted warn">
          Saving sends {{ ceo }} the new brief as a message. It does not rewrite the
          constitution or {{ ceo }}'s founding papers — those were written at founding
          and are the company's to amend, not yours.
        </p>
        <p v-if="err" class="err">{{ err }}</p>
        <div class="row">
          <button class="go" :disabled="busy" @click="save">{{ busy ? 'Saving…' : 'Save' }}</button>
          <button class="ghost" :disabled="busy" @click="cancel">Cancel</button>
        </div>
      </template>
    </section>

    <section class="facts">
      <div v-for="f in facts" :key="f.label" class="fact">
        <span class="n mono">{{ f.value }}</span>
        <span class="l faint">{{ f.label }}</span>
      </div>
    </section>

    <section class="who">
      <h2>Who answers for it</h2>
      <p v-for="b in state.board" :key="b.id" class="seat">
        <span class="nm">{{ b.name }}</span> <span class="faint">{{ b.role }}</span>
      </p>
      <p class="seat"><span class="nm">{{ ceo }}</span> <span class="faint">CEO</span></p>
    </section>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 820px; }
h1 { font-size: 30px; }
h2 { font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); }
.line { font-size: 12px; margin-top: 6px; }
.head { margin-bottom: 26px; }

.brief { border: 1px solid var(--line); border-radius: 8px; background: var(--panel);
  padding: 16px 18px 18px; margin-bottom: 22px; }
.bar { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.grow { flex: 1; }
.none { font-size: 14px; }
.warn { font-size: 12px; line-height: 1.55; margin-top: 8px; }
.err { color: var(--alert); font-size: 13px; margin-top: 6px; }
.row { display: flex; gap: 8px; margin-top: 12px; }
textarea { width: 100%; font: inherit; font-size: 14px; line-height: 1.55; background: #15100d;
  color: var(--ink); border: 1px solid var(--line-2); border-radius: 6px; padding: 10px 12px;
  resize: vertical; }
textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; }

.facts { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 26px; }
.fact { display: flex; flex-direction: column; gap: 3px; border: 1px solid var(--line);
  border-radius: 6px; padding: 10px 14px; min-width: 96px; }
.fact .n { font-size: 19px; color: var(--ink); }
.fact .l { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }

.seat { font-size: 14px; margin-top: 7px; }
.seat .nm { color: var(--ink); }
</style>
