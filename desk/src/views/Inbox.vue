<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { api, type Inbox, type Message, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';
import Pager from '../Pager.vue';
import Toolbar, { type SortOption } from '../Toolbar.vue';

const props = defineProps<{ state: State; events: Event[] }>();
const emit = defineEmits<{ changed: [] }>();

/** Page sizes worth offering. A message is a wall of prose, so the default is
 *  small; the larger ones exist for scanning rather than reading. */
const SIZES = [10, 15, 25, 50];
const perPage = ref(Number(localStorage.getItem('riff.inboxPerPage')) || 15);
watch(perPage, (n) => { try { localStorage.setItem('riff.inboxPerPage', String(n)); } catch { /* no storage */ } });

/** Whose mail: what reached you, or everything the company said. */
const scope = ref<'mine' | 'all'>(
  (localStorage.getItem('riff.inboxScope') as 'mine' | 'all' | null) ?? 'mine');
watch(scope, async (v) => { try { localStorage.setItem('riff.inboxScope', v); } catch { /* no storage */ } await load(); });

const box = ref<Inbox | null>(null);
const open = ref(new Set<string>());
const replyTo = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);
const page = ref(0);
const filter = ref('');

const load = async () => { box.value = await api.inbox(scope.value); };
onMounted(load);
onEvents(() => props.events, /^message\.sent$/, load);

const nameOf = computed(() => namer(props.state));
const roleOf = (id: string) => props.state.agents.find((a) => a.id === id)?.role ?? '';

const all = computed(() => box.value?.messages ?? []);
/**
 * Unread is a fact about your own mail. A colleague's message to another
 * colleague has no read state that means anything to you, so browsing the
 * whole company must not paint 175 rows orange and claim they need you.
 */
const mine = computed(() => scope.value === 'mine');
const unread = computed(() => (mine.value ? all.value.filter((m) => !m.readAt) : []));

const matching = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return all.value;
  return all.value.filter((m) =>
    (nameOf.value(m.from) + ' ' + m.body).toLowerCase().includes(q));
});

/**
 * Orderings worth having on mail. "Unread first" is the one that earns its
 * place: a fortnight away leaves the things that need you buried under the
 * things that do not.
 */
const SORTS: SortOption[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'unread', label: 'Unread first' },
  { key: 'sender', label: 'Sender' },
];
const sort = ref<string>(localStorage.getItem('riff.inboxSort') ?? 'newest');
watch(sort, (v) => { try { localStorage.setItem('riff.inboxSort', v); } catch { /* no storage */ } });

const ordered = computed(() => {
  const list = [...matching.value];
  const newest = (a: Message, b: Message) => b.sentAt.localeCompare(a.sentAt) || b.id.localeCompare(a.id);
  if (sort.value === 'oldest') list.sort((a, b) => -newest(a, b));
  else if (sort.value === 'sender') {
    list.sort((a, b) => nameOf.value(a.from).localeCompare(nameOf.value(b.from)) || newest(a, b));
  } else if (sort.value === 'unread') {
    list.sort((a, b) => Number(Boolean(a.readAt)) - Number(Boolean(b.readAt)) || newest(a, b));
  } else list.sort(newest);
  return list;
});

const pages = computed(() => Math.max(1, Math.ceil(ordered.value.length / perPage.value)));
const shown = computed(() =>
  ordered.value.slice(page.value * perPage.value, page.value * perPage.value + perPage.value));

// New mail arriving must not slide the page out from under you, but a filter
// that shortens the list past where you are should.
watch(pages, (n) => { if (page.value >= n) page.value = n - 1; });
// Re-ordering resets the page for the same reason filtering does: page three
// of a list that has just been re-sorted shows you items you never asked for.
watch([filter, sort, perPage, scope], () => { page.value = 0; closeAll(); });

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

/** Everyone a message was addressed to, worded for whoever is reading. */
const recipients = (m: Message) => [m.to, ...(m.alsoTo ?? [])].filter(Boolean);
const toLabel = (m: Message) =>
  recipients(m).map((id) => (id === box.value?.me ? 'you' : nameOf.value(id))).join(', ');
const toMe = (m: Message) => !m.broadcast && recipients(m).includes(box.value?.me ?? '');

/**
 * Everyone a reply has to reach.
 *
 * Replying to mail between two colleagues used to go to the sender alone, and
 * each agent's inbox is only its own rows — so the other half of the
 * conversation could never learn the founder had weighed in. Answering a
 * broadcast stays a reply to the sender: the company does not need to hear it.
 */
const replyAudience = (m: Message): string[] => {
  const me = box.value?.me;
  const both = m.broadcast || m.to === me ? [m.from] : [m.from, m.to];
  // Reading your own sent mail back in the whole-company view still offers a
  // reply; without this it would be addressed to you.
  return both.filter((id) => id && id !== me);
};

const audienceLabel = (m: Message) =>
  replyAudience(m).map((id) => nameOf.value(id)).join(' and ');

const startReply = (m: Message) => {
  replyTo.value = replyTo.value === m.id ? null : m.id;
  draft.value = '';
  if (!isOpen(m)) toggle(m);
};

const send = async (m: Message) => {
  if (!draft.value.trim()) return;
  sending.value = true;
  await api.say(replyAudience(m), draft.value.trim());
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
    </header>

    <Toolbar v-if="all.length" v-model:filter="filter" v-model:sort="sort"
             v-model:per-page="perPage" :sizes="SIZES"
             :sorts="SORTS" label="Filter messages"
             :count="`${matching.length} message${matching.length === 1 ? '' : 's'}`
                     + (unread.length ? `, ${unread.length} unread` : '')">
      <button class="ghost scope" :class="{ on: scope === 'mine' }"
              @click="scope = 'mine'">To you</button>
      <button class="ghost scope" :class="{ on: scope === 'all' }"
              title="Every message anyone here sent, not only what reached you."
              @click="scope = 'all'">Everyone's</button>
      <button class="ghost" @click="openAll">Expand page</button>
      <button class="ghost" @click="closeAll">Collapse all</button>
      <button v-if="mine && unread.length" class="ghost" @click="readAll">Mark all read</button>
    </Toolbar>

    <p v-if="box && !all.length" class="muted empty">
      Nothing yet. Anything a staff member addresses to you arrives here.
    </p>
    <p v-else-if="box && !matching.length" class="muted empty">
      No message matches “{{ filter }}”.
    </p>

    <article v-for="m in shown" :key="m.id" class="msg"
             :class="{ unread: mine && !m.readAt, open: isOpen(m) }">
      <button class="row" :aria-expanded="isOpen(m)" @click="toggle(m)">
        <span class="chev" :class="{ down: isOpen(m) }">▸</span>
        <span class="who">{{ nameOf(m.from) }}</span>
        <span class="role faint">{{ roleOf(m.from) }}</span>
        <span v-if="m.broadcast" class="addressed all"
              title="Sent to the whole company.">→ everyone</span>
        <span v-else-if="toMe(m)" class="addressed you"
              title="Written to you specifically.">→ {{ toLabel(m) }}</span>
        <span v-else class="addressed other"
              title="Between colleagues. You are reading over their shoulder.">
          → {{ toLabel(m) }}
        </span>
        <span v-if="!isOpen(m)" class="preview muted">{{ preview(m.body) }}</span>
        <span class="grow" />
        <span v-if="mine && !m.readAt" class="new">New</span>
        <span class="when faint mono">{{ when(m.sentAt) }}</span>
      </button>

      <template v-if="isOpen(m)">
        <p class="envelope faint mono">
          {{ nameOf(m.from) }}<template v-if="roleOf(m.from)"> ({{ roleOf(m.from) }})</template>
          →
          <template v-if="m.broadcast">everyone at {{ state.company.name }}</template>
          <template v-else>{{ toLabel(m) }}</template>
          · {{ new Date(m.sentAt).toLocaleString() }}
        </p>
        <div class="body" v-html="render(m.body)" />
        <div v-if="replyTo === m.id" class="reply">
          <textarea v-model="draft" rows="3"
            :placeholder="`Reply to ${audienceLabel(m)} — they read it on their next waking.`" />
          <div class="actions">
            <button class="go" :disabled="sending || !draft.trim()" @click="send(m)">Send</button>
            <button class="ghost" @click="replyTo = null">Cancel</button>
          </div>
        </div>
        <div v-else class="actions">
          <button class="ghost" @click="startReply(m)">Reply</button>
          <button v-if="scope === 'mine'" class="ghost" @click="setRead(m, !m.readAt)">
            {{ m.readAt ? 'Mark unread' : 'Mark read' }}
          </button>
        </div>
      </template>
    </article>

    <Pager :page="page" :pages="pages" @update:page="page = $event; closeAll()" />
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
/* Who it was addressed to, on every row — not only on broadcasts. Without a
   marker on direct mail there was no positive signal that something was
   actually written to you. */
.addressed { font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  padding: 1px 6px; border-radius: 999px; white-space: nowrap; cursor: help; flex: none; }
.addressed.you { color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 40%, transparent); }
.addressed.all { color: var(--faint); border: 1px solid var(--line-2); }
.addressed.other { color: var(--muted); border: 1px solid var(--line); }
.scope { font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  border: 1px solid transparent; border-radius: 4px; padding: 3px 7px; }
.scope.on { color: var(--gold); border-color: var(--line-2); }
.envelope { font-size: 11px; padding: 0 14px 10px; }
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

@media (prefers-reduced-motion: reduce) { .chev { transition: none; } }
</style>
