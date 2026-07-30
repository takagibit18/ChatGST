<script setup lang="ts">
interface Props {
  modelValue: string
  placeholder?: string
  disabled?: boolean
  type?: string
  mono?: boolean
}
withDefaults(defineProps<Props>(), { type: 'text' })
defineEmits<{ 'update:modelValue': [v: string] }>()
</script>

<template>
  <input
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :class="[
      'w-full h-8 px-2.5 rounded-sm bg-bg-surface border border-border-strong text-[13px] text-text-primary placeholder:text-text-muted',
      'focus:outline-none focus:border-primary focus:shadow-focus disabled:opacity-50',
      mono && 'font-mono'
    ]"
    @input="$emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  >
</template>
