<script setup lang="ts">
interface Props {
  title: string
  desc?: string
}
defineProps<Props>()
</script>

<template>
  <div class="flex items-end justify-between mb-5 pb-4 border-b border-border">
    <div>
      <h1 class="text-page-title text-text-primary flex items-center gap-2.5">
        <span class="inline-block w-[3px] h-[18px] bg-primary rounded-sm" />
        {{ title }}
      </h1>
      <p
        v-if="desc"
        class="text-xs text-text-secondary mt-1 ml-[15px]"
      >
        {{ desc }}
      </p>
      <div
        v-if="$slots.extra"
        class="mt-1 ml-[15px]"
      >
        <slot name="extra" />
      </div>
    </div>
    <div
      v-if="$slots.actions"
      class="flex items-center gap-2"
    >
      <slot name="actions" />
    </div>
  </div>
</template>
