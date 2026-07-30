<script setup lang="ts">
interface Props {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md'
  disabled?: boolean
  loading?: boolean
}
withDefaults(defineProps<Props>(), { variant: 'secondary', size: 'md' })
defineEmits<{ click: [e: MouseEvent] }>()
</script>

<template>
  <button
    :disabled="disabled || loading"
    :class="[
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors border',
      size === 'md' ? 'h-[30px] px-3.5 text-[13px]' : 'h-7 px-2.5 text-xs',
      variant === 'primary' && 'bg-primary text-white border-primary hover:bg-primary-hover hover:border-primary-hover',
      variant === 'secondary' && 'bg-bg-surface text-text-primary border-border-strong hover:bg-bg-hover hover:text-primary hover:border-primary',
      variant === 'ghost' && 'bg-transparent text-text-secondary border-transparent hover:bg-bg-hover hover:text-primary',
      variant === 'danger' && 'bg-accent-red text-white border-accent-red hover:bg-[#A62719] hover:border-[#A62719]',
      'disabled:opacity-50 disabled:cursor-not-allowed'
    ]"
    @click="$emit('click', $event)"
  >
    <span
      v-if="loading"
      class="inline-block animate-spin"
    >⟳</span>
    <slot />
  </button>
</template>
