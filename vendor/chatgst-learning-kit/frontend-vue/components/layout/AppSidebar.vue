<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useUserStore } from '@/stores/user'
import { useReviewCountStore } from '@/stores/reviewCount'

const route = useRoute()
const userStore = useUserStore()
const reviewCountStore = useReviewCountStore()

onMounted(() => {
  reviewCountStore.refresh()
})

// 路由变化时刷新 badge 计数（从其他页面回来时）
watch(() => route.path, () => {
  reviewCountStore.refresh()
})

type NavItem = {
  page: string
  label: string
  to: string
  icon: string
  permission?: import('@/types/auth').Permission
  count?: number | null
}

const navItems = computed<NavItem[]>(() => {
  const items: NavItem[] = [
    {
      page: 'taskboard',
      label: '待办事项',
      to: '/tasks',
      permission: 'task:view',
      count: reviewCountStore.assignedMeCount,
      icon: 'M2 2h4v12H2zM7 2h4v8H7zM12 2h2v6h-2z',
    },
    {
      page: 'projectspace',
      label: '项目空间',
      to: '/projects',
      permission: 'pipeline:view',
      icon: 'M2 4h12v8H2zM5 4V2h6v2M5 8h6',
    },
    {
      page: 'dataspace',
      label: '数据空间',
      to: '/data/spaces',
      permission: 'dataspace:view',
      icon: 'M2 4h12M2 8h12M2 12h12',
    },
    {
      page: 'users',
      label: '用户管理',
      to: '/users',
      permission: 'user:manage',
      icon: 'M6 5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM2 13c0-2.2 1.8-4 4-4s4 1.8 4 4M11 5a2 0 0 110 4M11 9c2 0 3 1.2 3 2.5',
    },
  ]
  return items.filter((item) => !item.permission || userStore.hasPermission(item.permission))
})

const activeNav = computed(() => (route.meta.nav as string) || '')
</script>

<template>
  <aside class="sidebar w-[220px] bg-bg-surface border-r border-border h-screen sticky top-0 flex flex-col overflow-y-auto shrink-0">
    <!-- logo -->
    <div
      class="px-4 py-3.5 border-b border-border"
      style="background: linear-gradient(180deg, #FAFBFD 0%, #FFFFFF 100%)"
    >
      <div class="flex items-center gap-2.5">
        <div class="relative w-7 h-7 bg-primary text-white flex items-center justify-center text-sm font-bold rounded-sm">
          智
          <span class="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 bg-accent-red" />
        </div>
        <div class="leading-tight">
          <div class="text-sm font-semibold text-text-primary tracking-wide">
            智能体平台
          </div>
          <div class="text-[10px] text-text-tertiary tracking-widest uppercase">
            AGENT PLATFORM
          </div>
        </div>
      </div>
    </div>

    <!-- 导航 -->
    <nav class="flex-1 py-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.page"
        :to="item.to"
        :class="[
          'flex items-center gap-2.5 h-[34px] mx-2 px-4 rounded-md text-[13px] transition-colors border-l-[3px]',
          activeNav === item.page
            ? 'bg-primary-soft text-primary font-medium border-l-primary'
            : 'text-text-secondary border-l-transparent hover:bg-bg-hover hover:text-primary'
        ]"
      >
        <svg
          class="w-4 h-4 shrink-0"
          :class="activeNav === item.page ? 'opacity-100' : 'opacity-70'"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        >
          <path :d="item.icon" />
        </svg>
        <span>{{ item.label }}</span>
        <span
          v-if="item.count != null"
          :class="[
            'ml-auto text-[10px] font-semibold px-1.5 py-px rounded-lg min-w-[18px] text-center border',
            activeNav === item.page
              ? 'bg-primary text-white border-primary'
              : 'bg-accent-red-soft text-accent-red border-[#F5C6C0]'
          ]"
        >{{ item.count }}</span>
      </RouterLink>
    </nav>

    <!-- footer -->
    <div class="mt-auto px-4 py-3 border-t border-border text-[11px] text-text-tertiary">
      国家数据集团 * v1.0.0
    </div>
  </aside>
</template>
