<script lang="ts">
/**
 * One filter-and-sort bar, used by every list that has more than a screenful.
 *
 * The Inbox grew a filter, the Feed grew a different one, and the Commons grew
 * sort chips that looked nothing like either. Three lists, three idioms, and
 * only one of them could be sorted at all. A console is easier to trust when
 * the same control does the same thing on every screen.
 *
 * Sorting emits like filtering does, and callers reset the page on both —
 * staying on page three of a list that has just been re-ordered shows you
 * items you were never looking at.
 */
export type SortOption = { key: string; label: string };
</script>

<script setup lang="ts">
defineProps<{
  /** Free-text filter. */
  filter: string;
  /** Available orderings. Omit for a list with only one sensible order. */
  sorts?: SortOption[];
  sort?: string;
  /** e.g. "26 messages, 4 unread" — the caller words it. */
  count?: string;
  /** Placeholder and accessible name for the filter box. */
  label?: string;
  /** How many rows to a page, and what else the reader may choose. */
  perPage?: number;
  sizes?: number[];
}>();
const emit = defineEmits<{
  'update:filter': [v: string];
  'update:sort': [v: string];
  'update:perPage': [v: number];
}>();
</script>

<template>
  <div class="bar">
    <span v-if="count" class="faint mono count">{{ count }}</span>

    <div v-if="sorts?.length" class="sorts">
      <button v-for="o in sorts" :key="o.key" class="chip" :class="{ on: sort === o.key }"
              :aria-pressed="sort === o.key" @click="emit('update:sort', o.key)">
        {{ o.label }}
      </button>
    </div>

    <span class="grow" />

    <slot />

    <label v-if="sizes?.length" class="size">
      <span class="faint mono">per page</span>
      <select :value="perPage"
              @change="emit('update:perPage', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="n in sizes" :key="n" :value="n">{{ n }}</option>
      </select>
    </label>

    <input :value="filter" class="find" type="search"
           :placeholder="label ? 'filter…' : 'filter…'"
           :aria-label="label ?? 'Filter'"
           @input="emit('update:filter', ($event.target as HTMLInputElement).value)" />
  </div>
</template>

<style scoped>
.bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
  padding-bottom: 12px; border-bottom: 1px solid var(--line); margin-bottom: 12px; }
.count { font-size: 11px; white-space: nowrap; }
.grow { flex: 1; }

.sorts { display: flex; flex-wrap: wrap; gap: 4px; }
.chip { font: inherit; font-size: 10px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--faint); background: none; border: 1px solid transparent; border-radius: 4px;
  padding: 3px 7px; cursor: pointer; white-space: nowrap; }
.chip:hover { color: var(--ink); }
.chip.on { color: var(--gold); border-color: var(--line-2); }

.size { display: flex; align-items: center; gap: 5px; }
.size span { font-size: 10px; letter-spacing: .06em; text-transform: uppercase; }
.size select { background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 4px 6px; font: inherit; font-size: 12px; }

.find { background: #15100d; color: var(--ink); border: 1px solid var(--line-2);
  border-radius: 5px; padding: 6px 10px; font: inherit; font-size: 13px; width: 170px; }
.find::-webkit-search-cancel-button { filter: invert(0.6); }

@media (max-width: 720px) {
  .find { width: 100%; }
}
</style>
