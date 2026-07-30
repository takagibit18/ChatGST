<script setup lang="ts">
interface Props {
  text?: string
}
withDefaults(defineProps<Props>(), { text: '暂无数据' })
</script>

<template>
  <div class="flex flex-col items-center justify-center py-12 text-text-tertiary">
    <svg
      width="40"
      height="40"
      viewBox="0 0 40 40"
      fill="none"
      stroke="currentColor"
      stroke-width="1.2"
      class="opacity-40 mb-2"
    >
      <rect
        x="6"
        y="10"
        width="28"
        height="22"
        rx="2"
      />
      <path d="M6 16h28M14 6h12v4H14z" />
    </svg>
    <p class="text-[13px]">
      {{ text }}
    </p>
  </div>
</template>
