<script setup lang="ts">
// 5 步迷你流水线（dashboard 表格内用）
interface Props {
  steps: string[] // ['done','done','running','pending','pending']
}
defineProps<Props>()

const dotClass: Record<string, string> = {
  done: 'bg-success-soft text-success border-[#B8DEC4]',
  running: 'bg-info-soft text-info border-[#B5CCE9]',
  pending: 'bg-bg-elevated text-text-muted border-border-strong',
  failed: 'bg-danger-soft text-danger border-[#ECB7B0]'
}
</script>

<template>
  <div class="flex items-center justify-between gap-1">
    <template
      v-for="(s, i) in steps"
      :key="i"
    >
      <div class="flex flex-col items-center gap-1">
        <div :class="['w-[22px] h-[22px] rounded-full flex items-center justify-center text-[10px] font-semibold border', dotClass[s]]">
          <span v-if="s === 'done'">✓</span>
          <span v-else-if="s === 'failed'">✕</span>
          <span v-else>{{ i + 1 }}</span>
        </div>
        <div class="text-[10px] text-text-tertiary">
          S{{ i + 1 }}
        </div>
      </div>
      <div
        v-if="i < steps.length - 1"
        class="flex-1 h-px bg-border-strong mb-3.5"
      />
    </template>
  </div>
</template>
