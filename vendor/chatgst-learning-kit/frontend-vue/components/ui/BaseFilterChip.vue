<script setup lang="ts">
interface Props {
  label: string
  count?: number
  active?: boolean
}
defineProps<Props>()
defineEmits<{ click: [] }>()
</script>

<template>
  <button
    :class="[
      'inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[13px] border transition-colors',
      active
        ? 'bg-primary-soft text-primary border-primary'
        : 'bg-bg-surface text-text-secondary border-border hover:bg-bg-hover hover:text-primary'
    ]"
    @click="$emit('click')"
  >
    {{ label }}
    <span
      v-if="count !== undefined"
      class="font-mono text-xs"
    >{{ count }}</span>
  </button>
</template>
