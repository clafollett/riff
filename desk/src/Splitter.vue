<script setup lang="ts">
import { ref, onUnmounted } from 'vue';

/**
 * A draggable vertical divider.
 *
 * Sits ON the border it moves, absolutely positioned, so adding one costs the
 * surrounding layout nothing. The hit area is deliberately wider than the line
 * it draws — a 1px border is a target nobody can hit — and the grip only shows
 * itself on hover or focus, so the chrome stays quiet until you reach for it.
 */
const props = withDefaults(defineProps<{
  modelValue: number;
  min?: number;
  max?: number;
  /** Remembered per key, so a width you set once stays set. */
  storageKey?: string;
  label?: string;
}>(), { min: 160, max: 560, label: 'Resize panel' });

const emit = defineEmits<{ 'update:modelValue': [n: number] }>();

const dragging = ref(false);
const el = ref<HTMLElement | null>(null);
let startX = 0;
let startValue = 0;

const clamp = (n: number) => Math.min(props.max, Math.max(props.min, Math.round(n)));

const set = (n: number) => {
  const v = clamp(n);
  emit('update:modelValue', v);
  if (props.storageKey) {
    try { localStorage.setItem(props.storageKey, String(v)); } catch { /* no storage */ }
  }
};

const onMove = (e: PointerEvent) => { if (dragging.value) set(startValue + (e.clientX - startX)); };

const onUp = () => {
  dragging.value = false;
  document.body.style.removeProperty('cursor');
  document.body.style.removeProperty('user-select');
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
};

const onDown = (e: PointerEvent) => {
  dragging.value = true;
  startX = e.clientX;
  startValue = props.modelValue;
  // Held on the window, not the handle, so a fast drag that outruns the
  // pointer does not drop the gesture the moment it leaves the 10px strip.
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  e.preventDefault();
};

/** Keyboard resizing, because a drag handle nobody can tab to is not a control. */
const onKey = (e: KeyboardEvent) => {
  const step = e.shiftKey ? 40 : 8;
  if (e.key === 'ArrowLeft') set(props.modelValue - step);
  else if (e.key === 'ArrowRight') set(props.modelValue + step);
  else if (e.key === 'Home') set(props.min);
  else if (e.key === 'End') set(props.max);
  else return;
  e.preventDefault();
};

onUnmounted(onUp);
</script>

<script lang="ts">
/** The width this key was last left at. Parents start from it. */
export const rememberedWidth = (key: string, fallback: number): number => {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  } catch { return fallback; }
};
</script>

<template>
  <div
    ref="el"
    class="splitter"
    :class="{ dragging }"
    role="separator"
    aria-orientation="vertical"
    :aria-label="label"
    :aria-valuenow="modelValue"
    :aria-valuemin="min"
    :aria-valuemax="max"
    tabindex="0"
    :style="{ left: modelValue + 'px' }"
    @pointerdown="onDown"
    @keydown="onKey"
    @dblclick="set(min + (max - min) / 3)"
  >
    <span class="grip" aria-hidden="true"><i /><i /><i /></span>
  </div>
</template>

<style scoped>
.splitter {
  position: absolute; top: 0; bottom: 0; width: 11px;
  transform: translateX(-5px);
  z-index: 12; cursor: col-resize;
  display: flex; align-items: center; justify-content: center;
  background: transparent; border: 0; padding: 0;
  touch-action: none;
}
/* The line the handle rides on, drawn by the splitter so the panel underneath
   does not need a border of its own. */
.splitter::before {
  content: ""; position: absolute; top: 0; bottom: 0; left: 5px; width: 1px;
  background: var(--line);
}
.splitter:hover::before,
.splitter:focus-visible::before,
.splitter.dragging::before { background: var(--accent); }
.splitter:focus-visible { outline: none; }

.grip {
  display: flex; flex-direction: column; gap: 2px;
  padding: 9px 3px; border-radius: 3px;
  background: var(--panel); border: 1px solid var(--line);
  opacity: 0; transition: opacity .12s ease;
}
.grip i { display: block; width: 2px; height: 2px; border-radius: 50%; background: var(--muted); }
.splitter:hover .grip,
.splitter:focus-visible .grip,
.splitter.dragging .grip { opacity: 1; }
.splitter:focus-visible .grip,
.splitter.dragging .grip { border-color: var(--accent); }
.splitter.dragging .grip i { background: var(--accent); }

@media (prefers-reduced-motion: reduce) { .grip { transition: none; } }
</style>
