<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { api, type Inbox, type Message, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';

const props = defineProps<{ state: State; events: Event[] }>();
const emit = defineEmits<{ changed: [] }>();

const PER_PAGE = 15;

const box = ref<Inbox | null>(null);
const open = ref(new Set<string>());
const replyTo = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);
const page = ref(0);
const filter = ref('');

const load = async () => { box.value = await api.inbox(); };
onMounted(load);
onEvents(() => props.events, /^message\.sent$/, load);

const nameOf = computed(() => namer(props.state));
const roleOf = (id: string) => props.state.agents.find((a) => a.id === id)?.role ?? '';

const all = computed(() => box.value?.messages ?? []);
const unread = computed(() => all.value.filter((m) => !m.readAt));

const matching = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return all.value;
  return all.value.filter((m) =>
    (nameOf.value(m.from) + ' ' + m.body).toLowerCase().includes(q));
});

const pages = computed(() => Math.max(1, Math.ceil(matching.value.length / PER_PAGE)));
const shown = computed(() =>
  matching.value.slice(page.value * PER_PAGE, page.value * PER_PAGE + PER_PAGE));

// New mail arriving must not slide the page out from under you, but a filter
// that shortens the list past where you are should.
watch(pages, (n) => { if (page.value >= n) page.value = n - 1; });
watch(filter, () => { page.value = 0; });

/**
 * The first line worth showing, for a message nobody has opened yet.
 *
 * Bodies here run to three or four thousand characters. Rendered in full and
 * all at once, twenty-six of them is ninety thousand characters of scroll —
 * so the list shows one line each and opens on request.
 */
const preview = (body: string): string => {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').replace(/[*_`>]/g, '').trim();
    if (line) return line;
  }
  return '(empty)';
};

const isOpen = (m: Message) => open.value.has(m.id);

/** Expanding does not mark anything read — that stays an explicit act. */
const toggle = (m: Message) => {
  const next = new Set(open.value);
  if (next.has(m.id)) { next.delete(m.id); if (replyTo.value === m.id) replyTo.value = null; }
  else next.add(m.id);
  open.value = next;
};

const openAll = () => { open.value = new Set(shown.value.map((m) => m.id)); };
const closeAll = () => { open.value = new Set(); replyTo.value = null; };

const setRead = async (m: Message, read: boolean) => {
  await api.markRead([m.id], read);
  await load();
  emit('changed');
};

const readAll = async () => { await api.markRead(); await load(); emit('changed'); };

const startReply = (m: Message) => {
  replyTo.value = replyTo.value === m.id ? null : m.id;
  draft.value = '';
  if (!isOpen(m)) toggle(m);
};

const send = async (m: Message) => {
  if (!draft.value.trim()) return;
  sending.value = true;
  await api.say(m.from, draft.value.trim());
  draft.value = '';
  replyTo.value = null;
  sending.value = false;
  emit('changed');
};

const when = (iso: string) => {
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString();
};
</script>

<template>
  <div class="wrap">
    <header class="head">
      <div>
        <h1>Inbox</h1>
        <p class="muted lede">
          What the staff have written to you. Unread ones are marked
          <span class="new inline">New</span>, and you can put one back to
          unread to keep it in front of you.
        </p>
      </div>
      <input v-model="filter" placeholder="filter…" aria-label="Filter messages" />
    </header>

    <div v-if="all.length" class="bar">
      <span class="faint mono count">
        {{ matching.length }} message{{ matching.length === 1 ? '' : 's' }}<template v-if="unread.length">, {{ unread.length }} unread</template>
      </span>
      <span class="grow" />
      <button class="ghost" @click="openAll">Expand page</button>
      <button class="ghost" @click="closeAll">Collapse all</button>
      <button v-if="unread.length" class="ghost" @click="readAll">Mark all read</button>
    </div>

    <p v-if="box && !all.length" class="muted empty">
      Nothing yet. Anything a staff member addresses to you arrives here.
    </p>
    <p v-else-if="box && !matching.length" class="muted empty">
      No message matches “{{ filter }}”.
    </p>

    <article v-for="m in shown" :key="m.id" class="msg"
             :class="{ unread: !m.readAt, open: isOpen(m) }">
      <button class="row" :aria-expanded="isOpen(m)" @click="toggle(m)">
        <span class="chev" :class="{ down: isOpen(m) }">▸</span>
        <span class="who">{{ nameOf(m.from) }}</span>
        <span class="role faint">{{ roleOf(m.from) }}</span>
        <span v-if="m.broadcast" class="to-all"
              title="Sent to the whole company, not only to you.">to everyone</span>
        <span v-if="!isOpen(m)" class="preview muted">{{ preview(m.body) }}</span>
        <span class="grow" />
        <span v-if="!m.readAt" class="new">New</span>
        <span class="when faint mono">{{ when(m.sentAt) }}</span>
      </button>

      <template v-if="isOpen(m)">
        <div class="body" v-html="render(m.body)" />
        <div v-if="replyTo === m.id" class="reply">
          <textarea v-model="draft" rows="3"
            :placeholder="`Reply to ${nameOf(m.from)} — they read it on their next waking.`" />
          <div class="actions">
            <button class="go" :disabled="sending || !draft.trim()" @click="send(m)">Send</button>
            <button class="ghost" @click="replyTo = null">Cancel</button>
          </div>
        </div>
        <div v-else class="actions">
          <button class="ghost" @click="startReply(m)">Reply</button>
          <button class="ghost" @click="setRead(m, !m.readAt)">
            {{ m.readAt ? 'Mark unread' : 'Mark read' }}
          </button>
        </div>
      </template>
    </article>

    <nav v-if="pages > 1" class="pager">
      <button class="ghost" :disabled="page === 0" @click="page--; closeAll()">Newer</button>
      <span class="faint mono">page {{ page + 1 }} of {{ pages }}</span>
      <button class="ghost" :disabled="page >= pages - 1" @click="page++; closeAll()">Older</button>
    </nav>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 940px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 20px; font-size: 14px; max-width: 58ch; }
.empty { font-size: 15px; margin-top: 20px; }
input { background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 7px 10px; font: inherit; font-size: 13px; width: 180px; }

.bar { display: flex; align-items: center; gap: 8px; padding-bottom: 14px;
  border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.count { font-size: 11px; }
.grow { flex: 1; }

.msg { border: 1px solid var(--line); border-left: 3px solid var(--line);
  border-radius: 6px; background: var(--panel); margin-bottom: 6px; overflow: hidden; }
.msg.unread { border-left-color: var(--accent); }
.msg.open { margin-bottom: 14px; }

.row { display: flex; align-items: baseline; gap: 10px; width: 100%; text-align: left;
  background: none; border: 0; border-radius: 0; padding: 11px 16px; }
.row:hover { background: #1a1512; }
.chev { color: var(--faint); font-size: 10px; align-self: center; flex: none;
  transition: transform .12s ease; }
.chev.down { transform: rotate(90deg); }
.who { font-family: var(--serif); font-size: 16px; color: var(--ink); white-space: nowrap; }
.msg.unread .who { font-weight: 500; }
.role { font-size: 12px; white-space: nowrap; }
/* A label, not a control. It carries no border precisely so it stops looking
   like something to press. */
.to-all { font-size: 12px; font-style: italic; color: var(--faint); cursor: help; white-space: nowrap; }
.preview { font-size: 13.5px; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; min-width: 0; flex: 1 1 auto; }
.new { font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 9px; padding: 1px 8px; font-family: var(--sans); flex: none; }
.new.inline { display: inline-block; vertical-align: baseline; }
.when { font-size: 11px; white-space: nowrap; flex: none; }

.body { font-size: 15px; padding: 4px 18px 0; }
.reply { padding: 14px 18px 4px; }
.reply textarea { width: 100%; font: inherit; font-size: 13px; line-height: 1.6;
  background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 10px; resize: vertical; }
.actions { display: flex; gap: 8px; padding: 12px 18px 16px; }

.pager { display: flex; align-items: center; justify-content: center; gap: 14px;
  margin-top: 22px; font-size: 11px; }

@media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style>
