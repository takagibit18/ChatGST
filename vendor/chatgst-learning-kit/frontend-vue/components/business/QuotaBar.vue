<script setup lang="ts">
interface Props {
  label: string
  percent: number
  value: string
  level?: string
}
withDefaults(defineProps<Props>(), { level: 'normal' })
</script>

<template>
  <div class="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
    <div class="text-[13px] text-text-secondary w-20">{{ label }}</div>
    <div class="flex-1 h-1.5 bg-bg-elevated rounded-sm overflow-hidden">
      <div
        :class="['h-full rounded-sm', level === 'warn' ? 'bg-warning' : level === 'danger' ? 'bg-accent-red' : 'bg-primary']"
        :style="{ width: percent + '%' }"
      ></div>
    </div>
    <div class="text-xs text-text-tertiary tabular-nums min-w-20 text-right">{{ value }}</div>
  </div>
</template>
