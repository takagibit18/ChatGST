<script setup lang="ts">
import AppSidebar from './AppSidebar.vue'
import AppTopbar from './AppTopbar.vue'
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()
// 各页顶栏右侧按钮（基础交互：占位按钮）
const actions = computed(() => {
  switch (route.meta.nav) {
    case 'dashboard':
      return [{ text: '+ 新建项目', variant: 'secondary' }]
    case 'dataspace':
      // 顶栏不放快捷按钮；新建/删除均在 DataSpacePage 内完成
      return []
    case 'projectspace':
      return [
        { text: '导出', variant: 'ghost' },
        { text: '+ 新建项目', variant: 'primary' }
      ]
    case 'taskboard':
      return [
        { text: '导出', variant: 'ghost' },
        { text: '+ 新建审批', variant: 'primary' }
      ]
    default:
      return []
  }
})
</script>

<template>
  <div class="h-screen w-screen flex bg-bg-base text-text-primary overflow-hidden">
    <AppSidebar />
    <div class="flex-1 flex flex-col min-w-0">
      <div class="gov-strip" />
      <AppTopbar>
        <button
          v-for="a in actions"
          :key="a.text"
          :class="[
            'h-[30px] px-3.5 rounded-md text-[13px] font-medium border transition-colors',
            a.variant === 'primary' && 'bg-primary text-white border-primary hover:bg-primary-hover',
            a.variant === 'secondary' && 'bg-bg-surface text-text-primary border-border-strong hover:bg-bg-hover hover:text-primary',
            a.variant === 'ghost' && 'bg-transparent text-text-secondary border-border-strong hover:bg-bg-hover hover:text-primary'
          ]"
        >
          {{ a.text }}
        </button>
      </AppTopbar>
      <main class="flex-1 overflow-auto">
        <RouterView />
      </main>
    </div>
  </div>
</template>
