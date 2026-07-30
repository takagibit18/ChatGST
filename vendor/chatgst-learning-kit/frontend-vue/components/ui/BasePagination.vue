<script setup lang="ts">
import { computed } from 'vue'

interface Props {
  total: number
  current: number
  pageSize?: number
}
const props = withDefaults(defineProps<Props>(), { pageSize: 10 })
const emit = defineEmits<{ 'update:current': [v: number] }>()

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)))
const pages = computed(() => {
  const arr: (number | string)[] = []
  const tp = totalPages.value
  const cur = props.current
  if (tp <= 7) {
    for (let i = 1; i <= tp; i++) arr.push(i)
  } else {
    arr.push(1)
    if (cur > 3) arr.push('…')
    for (let i = Math.max(2, cur - 1); i <= Math.min(tp - 1, cur + 1); i++) arr.push(i)
    if (cur < tp - 2) arr.push('…')
    arr.push(tp)
  }
  return arr
})
function go(p: number) {
  if (p < 1 || p > totalPages.value || p === props.current) return
  emit('update:current', p)
}
</script>

<template>
  <div class="flex items-center justify-between text-[13px] text-text-tertiary">
    <span>共 <span class="font-semibold text-text-primary">{{ total }}</span> 条 · 当前显示 {{ (current - 1) * pageSize + 1 }}-{{ Math.min(current * pageSize, total) }}</span>
    <div class="flex items-center gap-1">
      <button
        :disabled="current <= 1"
        class="w-7 h-7 rounded border border-border bg-bg-surface text-text-secondary hover:bg-bg-hover disabled:opacity-40"
        @click="go(current - 1)"
      >
        ‹
      </button>
      <button
        v-for="(p, i) in pages"
        :key="i"
        :disabled="p === '…'"
        :class="[
          'min-w-7 h-7 px-1.5 rounded border text-[13px]',
          p === current ? 'bg-primary text-white border-primary' : 'bg-bg-surface text-text-secondary border-border hover:bg-bg-hover',
          p === '…' && 'border-transparent cursor-default'
        ]"
        @click="typeof p === 'number' && go(p)"
      >
        {{ p }}
      </button>
      <button
        :disabled="current >= totalPages"
        class="w-7 h-7 rounded border border-border bg-bg-surface text-text-secondary hover:bg-bg-hover disabled:opacity-40"
        @click="go(current + 1)"
      >
        ›
      </button>
    </div>
  </div>
</template>
