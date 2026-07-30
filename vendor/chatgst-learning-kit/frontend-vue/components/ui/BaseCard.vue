<script setup lang="ts">
interface Props {
  padding?: boolean
  shadow?: boolean
}
withDefaults(defineProps<Props>(), { padding: true, shadow: true })
</script>

<template>
  <div
    :class="[
      'bg-bg-surface border border-border rounded-lg',
      shadow && 'shadow-xs',
      padding ? 'p-4' : ''
    ]"
  >
    <slot />
  </div>
</template>
