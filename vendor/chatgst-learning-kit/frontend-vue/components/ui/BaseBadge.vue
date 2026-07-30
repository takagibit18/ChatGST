<script setup lang="ts">
// 政务风 badge：带 ::before 圆点
interface Props {
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'
  dot?: boolean
}
withDefaults(defineProps<Props>(), { variant: 'neutral', dot: true })
</script>

<template>
  <span
    :class="[
      'inline-flex items-center gap-1 h-5 px-2 rounded-sm text-[11px] font-medium tracking-wide border',
      variant === 'primary' && 'bg-primary-soft text-primary border-[#B5CCE9]',
      variant === 'success' && 'bg-success-soft text-success border-[#B8DEC4]',
      variant === 'warning' && 'bg-warning-soft text-warning border-[#ECD2A5]',
      variant === 'danger' && 'bg-danger-soft text-danger border-[#ECB7B0]',
      variant === 'info' && 'bg-info-soft text-info border-[#B5CCE9]',
      variant === 'neutral' && 'bg-bg-hover text-text-secondary border-border'
    ]"
  >
    <span
      v-if="dot"
      class="w-[5px] h-[5px] rounded-full bg-current shrink-0"
    />
    <slot />
  </span>
</template>
