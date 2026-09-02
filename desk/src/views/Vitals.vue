<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue';
import { api, type Vitals, type Trend, type State, type Event } from '../api';
import { onEvents } from '../live';

const props = defineProps<{ state: State; events: Event[] }>();

const WINDOWS = ['24.hours', '7.days', '30.days'] as const;
const spec = ref<string>('7.days');
const v = ref<Vitals | null>(null);
const err = ref('');

const load = async () => {
  // Which window this request is for. A slow answer to a window the reader has
  // already moved off must not overwrite the one they are looking at now.
  const want = spec.value;
  try {
    const next = await api.vitals(want);
    if (want !== spec.value) return;
    v.value = next;
    err.value = '';
  } catch (e) {
    err.value = e instanceof Error ? e.message : String(e);
  }
};
onMounted(load);
watch(spec, load);
// A report that goes stale while you read it invites the wrong conclusion, but
// recomputing on every gate allow would recompute constantly. Shift boundaries
// are the beat that actually moves these numbers.
onEvents(() => props.events, /^(agent\.slept|agent\.failed|commons\.|role\.)/, load);

const usd = (n: number): string => `$${n.toFixed(2)}`;
const pct = (n: number): string => `${Math.round(n * 100)}%`;
const hrs = (n: number | null): string => (n == null ? '—' : `${n.toFixed(1)}h`);

/**
 * The same figure a window earlier. Direction is the whole point: a company
 * that landed twelve commits is doing well or badly depending entirely on
 * what it did the week before, and the level alone cannot say which.
 */
type Dir = { text: string; way: 'good' | 'bad' | 'flat' } | null;

/**
 * The arrow says which way the figure moved; the colour says whether that is
 * good news. They are not the same question, and colouring by direction alone
 * painted a week that cost forty dollars more than the last one in the success
 * colour — as it did a week with more barren shifts.
 */
const delta = (key: keyof Trend, now: number, better: 'up' | 'down', unit = ''): Dir => {
  const was = v.value?.previous?.[key];
  if (was == null) return null;
  const d = now - was;
  if (Math.abs(d) < 0.005) return { text: 'level', way: 'flat' };
  const size = unit === '$' ? `$${Math.abs(d).toFixed(2)}` : String(Math.round(Math.abs(d)));
  const rose = d > 0;
  return {
    text: `${rose ? '▲' : '▼'} ${size}`,
    way: rose === (better === 'up') ? 'good' : 'bad',
  };
};

/**
 * What the numbers say, in words, at the top — because a wall of figures is
 * something to scroll past and a sentence is something to act on. Only
 * findings that are actually true of this window appear.
 */
const findings = computed<Array<{ severity: 'warn' | 'note'; text: string }>>(() => {
  const d = v.value;
  if (!d) return [];
  const out: Array<{ severity: 'warn' | 'note'; text: string }> = [];

  if (d.shifts.troubleRate > 0.2) {
    out.push({ severity: 'warn', text:
      `${pct(d.shifts.troubleRate)} of shifts failed or went blind. That is the loop, not the work.` });
  }
  if (d.shifts.barren) {
    out.push({ severity: d.shifts.barren > d.shifts.slept / 3 ? 'warn' : 'note', text:
      `${d.shifts.barren} of ${d.shifts.slept} shifts woke, spent money and left nothing behind.` });
  }
  if (d.commons.added && !d.commons.removed) {
    out.push({ severity: 'warn', text:
      `${d.commons.added} document${d.commons.added > 1 ? 's' : ''} added and none removed — ` +
      `accretion with no selection, ` +
      `which is the failure Rule 6 exists to prevent.` });
  }
  if (d.org.hired && !d.org.retired) {
    out.push({ severity: 'note', text:
      `${d.org.hired} hired and nobody retired. Rule 6 bounds the shelf; nothing bounds the payroll.` });
  }
  if (d.commons.held >= d.commons.ceiling && !d.commons.refused) {
    out.push({ severity: 'note', text:
      'The commons is at its ceiling but has never refused a posting — the pressure is untested, not proven.' });
  }
  if (d.envelope.oldestPendingHours != null && d.envelope.oldestPendingHours > 24) {
    out.push({ severity: 'warn', text:
      `A draft has waited ${hrs(d.envelope.oldestPendingHours)} on the board. ` +
      `The staff cannot route around you.` });
  }
  if (d.shifts.costShareTop > 0.5 && d.people.length > 1) {
    out.push({ severity: 'note', text:
      `${pct(d.shifts.costShareTop)} of the inference bill is one person.` });
  }
  if (d.talk.byStaff && d.talk.perCommit > 8) {
    out.push({ severity: 'warn', text:
      `${d.talk.perCommit.toFixed(1)} messages for every commit that landed.` });
  }
  if (d.org.orphans) {
    out.push({ severity: 'warn', text:
      `${d.org.orphans} reporting line${d.org.orphans > 1 ? 's point' : ' points'} at somebody who does not work here.` });
  }
  return out;
});

const tiles = computed(() => {
  const d = v.value;
  if (!d) return [];
  return [
    { label: 'shifts',  value: String(d.shifts.slept), sub: `${d.shifts.turnsPerShift.toFixed(1)} turns each`, dir: delta('shifts', d.shifts.slept, 'up') },
    { label: 'spent',   value: usd(d.shifts.costUsd),  sub: `${usd(d.shifts.costPerShift)} a shift`, dir: delta('costUsd', d.shifts.costUsd, 'down', '$') },
    { label: 'landed',  value: String(d.talk.byStaff), sub: d.talk.byStaff ? `${usd(d.talk.costPerCommit)} a commit` : 'nothing reached the world', dir: delta('commits', d.talk.byStaff, 'up') },
    { label: 'barren',  value: String(d.shifts.barren), sub: 'woke and left nothing', dir: delta('barren', d.shifts.barren, 'down') },
  ];
});
</script>

<template>
  <div class="wrap">
    <header class="top">
      <div>
        <h1>Vitals</h1>
        <p class="muted lede">
          Whether any of this is working, as numbers. Nothing here is recorded —
          every figure is read back out of the event log, the ledger and the
          world's git history, so the window costs nothing to widen.
        </p>
      </div>
      <div class="windows">
        <button v-for="w in WINDOWS" :key="w" class="win" :class="{ on: spec === w }"
                :aria-pressed="spec === w"
                @click="spec = w">{{ w.replace('.', ' ') }}</button>
      </div>
    </header>

    <!-- A refresh that fails while you are reading is a banner, not a blank
         page: the figures on screen were true when they were read. -->
    <p v-if="err" class="warn">{{ err }}</p>
    <p v-if="!v && !err" class="muted empty">Reading the record…</p>

    <template v-if="v">
      <div class="tiles">
        <div v-for="t in tiles" :key="t.label" class="tile">
          <span class="tlabel">{{ t.label }}</span>
          <span class="tvalue">{{ t.value }}</span>
          <span class="tsub">
            {{ t.sub }}
            <em v-if="t.dir" :class="t.dir.way">{{ t.dir.text }}</em>
          </span>
        </div>
      </div>

      <section v-if="findings.length" class="findings">
        <p v-for="(f, i) in findings" :key="i" class="finding" :class="f.severity">{{ f.text }}</p>
      </section>
      <p v-else-if="v.shifts.slept" class="muted clean">
        Nothing in this window is out of order.
      </p>
      <p v-else class="muted clean">
        Nobody worked a shift in this window. Start the company, or widen it.
      </p>

      <div class="cols">
        <section>
          <h2>Commons — rule 6</h2>
          <dl>
            <dt>held</dt><dd :class="{ hot: v.commons.held >= v.commons.ceiling }">
              {{ v.commons.held }}/{{ v.commons.ceiling }}</dd>
            <dt>added</dt><dd>{{ v.commons.added }}</dd>
            <dt>revised</dt><dd>{{ v.commons.revised }}</dd>
            <dt>removed</dt><dd>{{ v.commons.removed }}</dd>
            <dt>net</dt><dd>{{ v.commons.net > 0 ? '+' : '' }}{{ v.commons.net }}</dd>
            <dt>refused as full</dt><dd>{{ v.commons.refused }}</dd>
          </dl>
        </section>

        <section>
          <h2>The org chart</h2>
          <dl>
            <dt>headcount</dt><dd>{{ v.org.headcount }}</dd>
            <dt>hired · retired</dt><dd>{{ v.org.hired }} · {{ v.org.retired }}</dd>
            <dt>shape</dt><dd>{{ v.org.depth }} deep, {{ v.org.widest }} wide</dd>
            <dt>shifts a head</dt><dd>{{ v.org.shiftsPerHead.toFixed(1) }}</dd>
            <dt v-if="v.org.orphans">broken lines</dt>
            <dd v-if="v.org.orphans" class="hot">{{ v.org.orphans }}</dd>
          </dl>
        </section>

        <section>
          <h2>The envelope — rule 3</h2>
          <dl>
            <dt>filed</dt><dd>{{ v.envelope.filed }}</dd>
            <dt>approved · rejected</dt><dd>{{ v.envelope.approved }} · {{ v.envelope.rejected }}</dd>
            <dt>released outward</dt><dd>{{ v.envelope.released }}</dd>
            <dt>still pending</dt><dd :class="{ hot: (v.envelope.oldestPendingHours ?? 0) > 24 }">
              {{ v.envelope.pending }}</dd>
            <dt>oldest waiting</dt><dd>{{ hrs(v.envelope.oldestPendingHours) }}</dd>
            <dt>median decision</dt><dd>{{ hrs(v.envelope.medianDecisionHours) }}</dd>
          </dl>
        </section>

        <section>
          <h2>Talk against work</h2>
          <dl>
            <dt>commits by staff</dt><dd>{{ v.talk.byStaff }}</dd>
            <dt v-if="v.talk.unattributed">not by anyone here</dt>
            <dd v-if="v.talk.unattributed" class="faint">{{ v.talk.unattributed }}</dd>
            <dt>messages</dt><dd>{{ v.talk.messages }}</dd>
            <dt>per commit</dt><dd>{{ v.talk.byStaff ? v.talk.perCommit.toFixed(1) : '—' }}</dd>
            <dt>delivered</dt><dd>{{ v.talk.deliveries }}</dd>
            <dt>notes</dt><dd>{{ v.talk.notes }}</dd>
            <dt>memory kept</dt><dd>{{ v.talk.memoryConsolidated }}</dd>
          </dl>
        </section>

        <section>
          <h2>Work</h2>
          <dl>
            <dt>opened · claimed</dt><dd>{{ v.work.opened }} · {{ v.work.claimed }}</dd>
            <dt>done · dropped</dt><dd>{{ v.work.done }} · {{ v.work.dropped }}</dd>
            <dt>finished</dt><dd>{{ v.work.done + v.work.dropped ? pct(v.work.completionRate) : '—' }}</dd>
            <dt>open now</dt><dd>{{ v.work.openNow }}</dd>
          </dl>
        </section>

        <section>
          <h2>The gate</h2>
          <dl>
            <dt>allow</dt><dd>{{ v.gate.allow }}</dd>
            <dt>deny</dt><dd>{{ v.gate.deny }}</dd>
            <dt>escalate</dt><dd>{{ v.gate.escalate }}</dd>
            <dt v-if="v.money.cents">spent</dt>
            <dd v-if="v.money.cents">{{ usd(v.money.cents / 100) }}</dd>
            <dt v-if="v.shifts.rotated || v.shifts.compacted">rotated · compacted</dt>
            <dd v-if="v.shifts.rotated || v.shifts.compacted">
              {{ v.shifts.rotated }} · {{ v.shifts.compacted }}</dd>
          </dl>
        </section>
      </div>

      <!-- Which rules actually bite. The constitution claims Rule 6 is the
           load-bearing one; this is the table that can contradict it. -->
      <section v-if="v.gate.rules.length">
        <h2>Where the rules bit</h2>
        <!-- Nine columns of figures do not fit a narrow window, and a table
             that widens the document scrolls the whole page sideways. -->
        <div class="tablewrap">
        <table class="grid">
          <caption class="offscreen">Rules that refused something, most often first</caption>
          <thead><tr><th scope="col">times</th><th scope="col">decision</th>
            <th scope="col">rule</th><th scope="col">capability</th></tr></thead>
          <tbody>
            <tr v-for="r in v.gate.rules.slice(0, 8)"
                :key="r.kind + r.rule + r.capability">
              <td class="n">{{ r.n }}</td>
              <td>{{ r.kind }}</td>
              <td><code>{{ r.rule }}</code></td>
              <td class="faint">{{ r.capability }}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <section v-if="v.people.length">
        <h2>Who did the work</h2>
        <div class="tablewrap">
        <table class="grid">
          <caption class="offscreen">What each member of staff did in this window</caption>
          <thead>
            <tr>
              <th scope="col">who</th><th scope="col" class="n">shifts</th>
              <th scope="col" class="n">commits</th><th scope="col" class="n">posts</th>
              <th scope="col" class="n">mail</th><th scope="col" class="n">drafts</th>
              <th scope="col" class="n">done</th><th scope="col" class="n">denied</th>
              <th scope="col" class="n">cost</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in v.people" :key="p.id">
              <td>{{ p.name }} <span class="faint">{{ p.role }}</span></td>
              <td class="n">{{ p.shifts }}</td>
              <td class="n">{{ p.commits }}</td>
              <td class="n">{{ p.posted }}</td>
              <td class="n">{{ p.messages }}</td>
              <td class="n">{{ p.filed }}</td>
              <td class="n">{{ p.done }}</td>
              <td class="n" :class="{ hot: p.denied > 5 }">{{ p.denied || '' }}</td>
              <td class="n">{{ usd(p.costUsd) }}</td>
            </tr>
          </tbody>
        </table>
        </div>
      </section>

      <p class="muted foot">
        {{ v.window.spec }}, from {{ new Date(v.window.since).toLocaleString() }}.
        <span v-if="v.previous">Arrows compare against the {{ v.window.spec }} before it.</span>
      </p>
    </template>
  </div>
</template>

<style scoped>
.wrap { padding: 34px 44px 60px; max-width: 1080px; }
.top { display: flex; align-items: flex-start; gap: 24px; }
h1 { font-size: 30px; }
h2 { font-size: 13px; font-family: var(--sans); text-transform: uppercase;
  letter-spacing: .1em; color: var(--faint); margin: 30px 0 10px; }
.lede { margin: 6px 0 24px; font-size: 14px; max-width: 62ch; }
.empty, .clean { font-size: 15px; max-width: 58ch; margin: 18px 0; }
.windows { display: flex; gap: 6px; margin-left: auto; flex: none; }
.win { font-family: var(--mono); font-size: 11px; letter-spacing: .05em;
  padding: 6px 11px; border: 1px solid var(--line); border-radius: 4px;
  background: transparent; color: var(--muted); cursor: pointer; }
.win:hover { background: #1a1512; color: var(--ink-2); }
.win.on { background: var(--panel); color: var(--gold); border-color: var(--line-2); }

.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.tile { background: var(--panel); border: 1px solid var(--line); border-radius: 6px;
  padding: 14px 17px; display: flex; flex-direction: column; gap: 3px; }
.tlabel { font-family: var(--mono); font-size: 10px; letter-spacing: .1em;
  text-transform: uppercase; color: var(--faint); }
.tvalue { font-family: var(--mono); font-size: 27px; color: var(--gold); line-height: 1.1; }
.tsub { font-size: 12px; color: var(--muted); }
.tsub em { font-style: normal; font-family: var(--mono); font-size: 11px; margin-left: 7px; }
.tsub em.good { color: var(--ok); }
.tsub em.bad { color: var(--accent); }
.tsub em.flat { color: var(--faint); }

.findings { margin: 22px 0 4px; display: flex; flex-direction: column; gap: 6px; }
.finding { font-size: 14px; padding: 11px 15px; border-radius: 5px;
  border: 1px solid var(--line); background: var(--panel); margin: 0; }
.finding.warn { border-color: #5c3a26; background: #241a11; }
.warn { border: 1px solid #5c3a26; background: #241a11; border-radius: 5px;
  padding: 12px 16px; font-size: 14px; }

.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 0 34px; }
dl { display: grid; grid-template-columns: 1fr auto; gap: 5px 14px; margin: 0;
  font-size: 13px; align-items: baseline; }
dt { color: var(--muted); }
dd { margin: 0; font-family: var(--mono); color: var(--ink); text-align: right; }
dd.hot { color: var(--alert); }

.grid { width: 100%; border-collapse: collapse; font-size: 13px; }
.grid th { text-align: left; font-family: var(--mono); font-size: 10px;
  letter-spacing: .09em; text-transform: uppercase; color: var(--faint);
  font-weight: normal; padding: 0 10px 7px 0; }
.grid td { padding: 6px 10px 6px 0; border-top: 1px solid var(--line); }
.tablewrap { overflow-x: auto; }
.offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; }
.grid .n { text-align: right; font-family: var(--mono); }
.grid td.hot { color: var(--alert); }
.faint { color: var(--faint); font-size: 11px; }
.foot { font-size: 12px; margin-top: 30px; }
</style>
