<script setup lang="ts">
import { ref, computed } from 'vue';
import { api, type CompanyRef } from '../api';

const props = defineProps<{ list: CompanyRef[]; active: string }>();
const emit = defineEmits<{ switch: [slug: string]; changed: [] }>();

type Mode = null | { kind: 'found' } | { kind: 'rename'; c: CompanyRef } | { kind: 'archive'; c: CompanyRef };
const mode = ref<Mode>(null);
const busy = ref(false);
const err = ref('');

const draft = ref({ name: '', business: '', ceo: '', chair: '' });
const rename = ref({ name: '', business: '', slug: '' });
const confirmName = ref('');

const openFound = () => {
  draft.value = { name: '', business: '', ceo: '', chair: props.list[0]?.slug ? '' : '' };
  err.value = '';
  mode.value = { kind: 'found' };
};
const openRename = (c: CompanyRef) => {
  rename.value = { name: c.name, business: c.business, slug: c.slug };
  err.value = '';
  mode.value = { kind: 'rename', c };
};
const openArchive = (c: CompanyRef) => {
  confirmName.value = '';
  err.value = '';
  mode.value = { kind: 'archive', c };
};
const close = () => { mode.value = null; err.value = ''; };

/**
 * Run a change, then tell the parent the list moved BEFORE telling it to
 * switch. Switching unmounts this component, and an emit from an unmounted
 * component goes nowhere — which is how a newly founded company managed to
 * become the active one without ever appearing in the switcher.
 */
const run = async (fn: () => Promise<string | null>) => {
  busy.value = true; err.value = '';
  try {
    const next = await fn();
    close();
    emit('changed');
    if (next !== null) emit('switch', next);
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e);
  } finally { busy.value = false; }
};

const found = () => run(async () => (await api.foundCompany(draft.value)).slug);

const save = (c: CompanyRef) => run(async () => {
  const r = await api.renameCompany(c.slug, rename.value);
  return props.active === c.slug ? r.slug : null;
});

const archive = (c: CompanyRef) => run(async () => {
  await api.archiveCompany(c.slug);
  return props.active === c.slug ? '' : null;
});

// Archiving is reversible but not casual. Typing the name is the same friction
// every tool that moves a repository asks for, and for the same reason.
const armed = computed(() =>
  mode.value?.kind === 'archive' && confirmName.value.trim() === mode.value.c.name);
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>Companies</h1>
        <p class="muted lede">
          Each one is a world of its own — its own staff, its own ledger, its own
          git history. Nothing about one reaches into another.
        </p>
      </div>
      <button class="go" @click="openFound">Found a company</button>
    </header>

    <div v-for="c in list" :key="c.slug" class="card" :class="{ on: c.slug === active }">
      <button class="pick" @click="emit('switch', c.slug)">
        <span class="dot" />
        <span class="names">
          <span class="name">{{ c.name }}</span>
          <span class="biz muted">{{ c.business || 'no line of business recorded' }}</span>
        </span>
        <span class="grow" />
        <span class="meta faint mono">{{ c.ceo }} · {{ c.slug }}</span>
      </button>
      <div class="tools">
        <button class="ghost" @click="openRename(c)">Rename</button>
        <button class="ghost danger" @click="openArchive(c)">Archive</button>
      </div>
    </div>

    <p v-if="!list.length" class="muted empty">
      No companies yet. Found one and its CEO will build the rest.
    </p>

    <!-- ------------------------------------------------------ dialogs -->
    <div v-if="mode" class="scrim" @click.self="close">
      <div class="dialog">
        <template v-if="mode.kind === 'found'">
          <h2>Found a company</h2>
          <p class="muted note">
            You name the company, the line of business, and the CEO. Nothing else
            is decided here — no roster, no plan, no product. The CEO builds all
            of that, and you approve what leaves.
          </p>
          <label>Company name<input v-model="draft.name" placeholder="Tidewater Instruments" /></label>
          <label>Line of business<input v-model="draft.business" placeholder="marine sensing" /></label>
          <label>CEO's name<input v-model="draft.ceo" placeholder="Rook" /></label>
          <label>Chairman<input v-model="draft.chair" placeholder="you" /></label>
          <p v-if="err" class="err">{{ err }}</p>
          <div class="row">
            <button class="go" :disabled="busy || !draft.name.trim()" @click="found">Found it</button>
            <button class="ghost" @click="close">Cancel</button>
          </div>
        </template>

        <template v-else-if="mode.kind === 'rename'">
          <h2>Rename {{ mode.c.name }}</h2>
          <p class="muted note">
            The name is a label and the slug is the folder. They move
            independently, so fixing a title does not have to move a repository.
            Who the CEO and chairman <em>are</em> is not editable here — their
            ids are on every approval and commit already made.
          </p>
          <label>Company name<input v-model="rename.name" /></label>
          <label>Line of business<input v-model="rename.business" /></label>
          <label>Folder<input v-model="rename.slug" class="mono" /></label>
          <p v-if="err" class="err">{{ err }}</p>
          <div class="row">
            <button class="go" :disabled="busy" @click="save(mode.c)">Save</button>
            <button class="ghost" @click="close">Cancel</button>
          </div>
        </template>

        <template v-else-if="mode.kind === 'archive'">
          <h2>Archive {{ mode.c.name }}</h2>
          <p class="muted note">
            This does not delete anything. The whole directory moves to
            <code>~/.helmsted/archive/</code>, git history and all, and you can
            move it back or throw it away yourself once you are sure.
          </p>
          <label>Type <b>{{ mode.c.name }}</b> to confirm<input v-model="confirmName" /></label>
          <p v-if="err" class="err">{{ err }}</p>
          <div class="row">
            <button class="no" :disabled="busy || !armed" @click="archive(mode.c)">Archive it</button>
            <button class="ghost" @click="close">Cancel</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 940px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 26px; font-size: 14px; max-width: 58ch; }
.empty { font-size: 15px; margin-top: 20px; }
.card { display: flex; align-items: stretch; border: 1px solid var(--line);
  border-radius: 6px; background: var(--panel); margin-bottom: 8px; overflow: hidden; }
.card.on { border-color: var(--accent); }
.pick { flex: 1; display: flex; align-items: center; gap: 12px; text-align: left;
  background: none; border: 0; border-radius: 0; padding: 13px 16px; }
.pick:hover { background: #1a1512; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--line-2); flex: none; }
.card.on .dot { background: var(--ok); }
.names { display: flex; flex-direction: column; gap: 2px; }
.name { font-family: var(--serif); font-size: 17px; color: var(--ink); }
.biz { font-size: 12px; }
.grow { flex: 1; }
.meta { font-size: 11px; }
.tools { display: flex; align-items: center; gap: 6px; padding: 0 12px;
  border-left: 1px solid var(--line); }
.ghost.danger:hover { border-color: var(--alert); color: var(--alert); }

.scrim { position: fixed; inset: 0; background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center; padding: 24px; z-index: 20; }
.dialog { background: var(--panel); border: 1px solid var(--line-2); border-radius: 8px;
  padding: 26px 28px; width: min(520px, 100%); max-height: 90vh; overflow-y: auto; }
.dialog h2 { font-size: 21px; margin-bottom: 8px; }
.note { font-size: 13.5px; line-height: 1.6; margin-bottom: 18px; }
label { display: flex; flex-direction: column; gap: 5px; margin-bottom: 13px;
  font-size: 12px; color: var(--muted); }
input { font: inherit; font-size: 14px; background: #15100d; color: var(--ink);
  border: 1px solid var(--line-2); border-radius: 5px; padding: 8px 10px; }
input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
.row { display: flex; gap: 8px; margin-top: 18px; }
.err { color: var(--alert); font-size: 13px; margin-top: 4px; }
</style>
