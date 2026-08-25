<script setup lang="ts">
/**
 * One pager, used everywhere anything is paged.
 *
 * The Inbox grew one first and the Feed would have grown a second, slightly
 * different one — same idea, different wording, different disabled rules. A
 * console is easier to trust when the same control does the same thing on
 * every screen, so there is only the one.
 *
 * How many fit on a page is the caller's business: the Inbox shows fifteen
 * because a message is a wall of prose, and the Feed shows forty because an
 * event is a line.
 */
defineProps<{ page: number; pages: number; noun?: string }>();
const emit = defineEmits<{ 'update:page': [n: number] }>();
</script>

<template>
  <nav v-if="pages > 1" class="pager">
    <button class="ghost" :disabled="page === 0" @click="emit('update:page', page - 1)">Newer</button>
    <span class="faint mono">page {{ page + 1 }} of {{ pages }}</span>
    <button class="ghost" :disabled="page >= pages - 1" @click="emit('update:page', page + 1)">
      Older
    </button>
  </nav>
</template>

<style scoped>
.pager { display: flex; align-items: center; justify-content: center; gap: 14px;
  margin-top: 22px; font-size: 11px; }
</style>
