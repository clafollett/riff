<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { api, type Inbox, type Message, type Event, type State } from '../api';
import { render } from '../markdown';
import { onEvents } from '../live';
import { namer } from '../names';

const props = defineProps<{ state: State; events: Event[] }>();
const emit = defineEmits<{ changed: [] }>();

const box = ref<Inbox | null>(null);
const replyTo = ref<string | null>(null);
const draft = ref('');
const sending = ref(false);

const load = async () => { box.value = await api.inbox(); };
onMounted(load);
onEvents(() => props.events, /^message\.sent$/, load);

const messages = computed(() => box.value?.messages ?? []);
const unread = computed(() => messages.value.filter((m) => !m.readAt));

const nameOf = computed(() => namer(props.state));
const roleOf = (id: string) => props.state.agents.find((a) => a.id === id)?.role ?? '';

const readAll = async () => {
  await api.markRead();
  await load();
  emit('changed');
};

/**
 * Marking read is an explicit act.
 *
 * The whole header used to be a silent click target for this, so clicking the
 * broadcast label — which looks like a button and is not one — made the unread
 * bar vanish with no explanation and no way back. An effect nobody asked for,
 * from a control that does not exist.
 */
const markSeen = async (m: Message, read = true) => {
  await api.markRead([m.id], read);
  await load();
  emit('changed');
};

const openReply = async (m: Message) => {
  replyTo.value = replyTo.value === m.id ? null : m.id;
  draft.value = '';
  // Replying is engaging with it. But if you deliberately put it back to
  // unread, that decision stands until you act on it.
  if (!m.readAt) await markSeen(m);
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
          What the staff have written to you. They write here when something is
          yours to decide, or when they want to be checked. Unread ones are
          marked <span class="new inline">New</span>, and you can put one back
          to unread to keep it in front of you.
        </p>
      </div>
      <button v-if="unread.length" class="ghost" @click="readAll">
        Mark all read ({{ unread.length }})
      </button>
    </header>

    <p v-if="box && !messages.length" class="muted empty">
      Nothing yet. Anything a staff member addresses to you arrives here.
    </p>

    <article v-for="m in messages" :key="m.id" class="msg" :class="{ unread: !m.readAt }">
      <header>
        <span class="who">{{ nameOf(m.from) }}</span>
        <span class="role faint">{{ roleOf(m.from) }}</span>
        <span v-if="m.broadcast" class="to-all"
              title="Sent to the whole company, not only to you.">to everyone</span>
        <span class="grow" />
        <span v-if="!m.readAt" class="new">New</span>
        <span class="when faint mono">{{ when(m.sentAt) }}</span>
      </header>
      <div class="body" v-html="render(m.body)" />
      <div v-if="replyTo === m.id" class="reply">
        <textarea v-model="draft" rows="3"
          :placeholder="`Reply to ${nameOf(m.from)} — they read it on their next waking.`" />
        <div class="row">
          <button class="go" :disabled="sending || !draft.trim()" @click="send(m)">Send</button>
          <button class="ghost" @click="replyTo = null">Cancel</button>
        </div>
      </div>
      <div v-else class="actions">
        <button class="ghost" @click="openReply(m)">Reply</button>
        <!-- The state we WANT, not the state it is in. These were the wrong
             way round, so the button labelled "Mark read" sent read:false. -->
        <button class="ghost" @click="markSeen(m, !m.readAt)">
          {{ m.readAt ? 'Mark unread' : 'Mark read' }}
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 900px; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
h1 { font-size: 30px; }
.lede { margin: 6px 0 26px; font-size: 14px; max-width: 58ch; }
.empty { font-size: 15px; }
.msg { border: 1px solid var(--line); border-left: 3px solid var(--line);
  border-radius: 6px; background: var(--panel); padding: 16px 20px; margin-bottom: 12px; }
.msg.unread { border-left-color: var(--accent); }
.msg > header { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
.who { font-family: var(--serif); font-size: 16px; color: var(--ink); }
.msg.unread .who { font-weight: 500; }
.role { font-size: 12px; }
/* A label, not a control. It carries no border precisely so it stops looking
   like something to press. */
.to-all { font-size: 12px; font-style: italic; color: var(--faint); cursor: help; }
.new { font-size: 10px; letter-spacing: .07em; text-transform: uppercase;
  color: var(--accent); border: 1px solid color-mix(in srgb, var(--accent) 45%, transparent);
  border-radius: 9px; padding: 1px 8px; font-family: var(--sans); }
.new.inline { display: inline-block; vertical-align: baseline; }
.grow { flex: 1; }
.when { font-size: 11px; }
.body { font-size: 15px; }
.reply { margin-top: 14px; }
.reply textarea { width: 100%; font: inherit; font-size: 13px; line-height: 1.6;
  background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 10px; resize: vertical; }
.row { display: flex; gap: 8px; margin-top: 10px; }
.actions { display: flex; gap: 8px; margin-top: 12px; }
</style>
