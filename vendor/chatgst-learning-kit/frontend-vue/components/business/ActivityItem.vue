<script setup lang="ts">
// 活动流条目（dashboard 最近活动 + 团队 Top 复用）
interface Props {
  icon: string // published/approved/failed/created
  actor?: string
  verb?: string
  object: string
  meta: string
}
defineProps<Props>()

const iconMap: Record<string, { bg: string; color: string; svg: string }> = {
  published: { bg: '#E6F4EB', color: '#1B8F4B', svg: 'M3 8l3 3 7-7' },
  approved: { bg: '#E6EEFB', color: '#1B5BD9', svg: 'M3 8l3 3 7-7' },
  failed: { bg: '#FBEAE7', color: '#C8311E', svg: 'M4 4l8 8M12 4l-8 8' },
  created: { bg: '#E6EEFB', color: '#1B5BD9', svg: 'M8 3v10M3 8h10' }
}
</script>

<template>
  <div class="flex gap-2.5 py-2.5 border-b border-border last:border-0">
    <div
      class="w-[26px] h-[26px] rounded flex items-center justify-center shrink-0"
      :style="{ background: iconMap[icon]?.bg, color: iconMap[icon]?.color, border: `1px solid ${iconMap[icon]?.color}33` }"
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      ><path :d="iconMap[icon]?.svg" /></svg>
    </div>
    <div class="flex-1 min-w-0">
      <div class="text-[13px] text-text-primary">
        <span
          v-if="actor"
          class="text-text-secondary"
        >{{ actor }} </span>{{ verb }} <span class="font-medium">{{ object }}</span>
      </div>
      <div class="text-[11px] text-text-tertiary mt-0.5">
        {{ meta }}
      </div>
    </div>
  </div>
</template>
