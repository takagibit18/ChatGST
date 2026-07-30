<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useUserStore } from '@/stores/user'
import ChangePasswordModal from '@/components/business/ChangePasswordModal.vue'

const route = useRoute()
const router = useRouter()
const user = useUserStore()
const menuOpen = ref(false)
const search = ref('')
const changePwdOpen = ref(false)

const crumbs = computed(() => (route.meta.breadcrumb as string[]) || ['工作台'])

const initials = computed(() => {
  const n = user.currentUser?.name ?? ''
  return n ? n.slice(0, 2) : 'U'
})

/** Role display label */
const roleLabel = computed(() => {
  switch (user.currentUser?.role) {
    case 'admin': return '平台超管'
    case 'developer': return '开发人员'
    case 'reviewer': return '审核人员'
    default: return user.currentUser?.role || '用户'
  }
})

const canManageUsers = computed(() => user.hasPermission('user:manage'))

function toggleMenu() {
  menuOpen.value = !menuOpen.value
}
function closeMenu() {
  menuOpen.value = false
}
async function onLogout() {
  await user.logout()
  menuOpen.value = false
  router.replace('/login')
}
onMounted(() => document.addEventListener('click', closeMenu))
onUnmounted(() => document.removeEventListener('click', closeMenu))
</script>

<template>
  <header class="h-[52px] bg-bg-surface border-b border-border sticky top-0 z-sticky flex items-center px-6 gap-4">
    <!-- 面包屑 -->
    <nav class="flex items-center gap-1.5 text-[13px] text-text-secondary">
      <template
        v-for="(c, i) in crumbs"
        :key="i"
      >
        <span
          v-if="i > 0"
          class="text-text-muted"
        >/</span>
        <span :class="i === crumbs.length - 1 ? 'text-text-primary font-medium' : ''">{{ c }}</span>
      </template>
    </nav>

    <!-- 右侧 -->
    <div class="ml-auto flex items-center gap-2.5">
      <!-- 各页操作按钮 slot -->
      <slot />

      <!-- 搜索框 -->
      <div class="flex items-center gap-1.5 bg-bg-base border border-border-strong rounded-md px-2.5 h-[30px] w-[240px] text-text-tertiary text-xs">
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        ><circle
          cx="7"
          cy="7"
          r="5"
        /><path d="M11 11l3 3" /></svg>
        <input
          v-model="search"
          placeholder="搜索…"
          class="flex-1 bg-transparent outline-none text-text-primary placeholder:text-text-muted"
        >
        <kbd class="font-mono text-[10px] bg-bg-surface border border-border px-1 py-px rounded-sm">⌘ K</kbd>
      </div>

      <!-- 用户菜单 -->
      <div
        class="relative flex items-center gap-2 py-1 pl-1 pr-2.5 rounded-full border border-border bg-bg-surface hover:border-[#B6CCE8] hover:bg-[#F2F7FE] transition-colors ml-1 select-none"
        :class="{ 'border-[#B6CCE8] bg-[#F2F7FE]': menuOpen }"
        @click.stop="toggleMenu"
      >
        <div class="w-7 h-7 rounded-full bg-[#0066CC] text-white flex items-center justify-center text-[11px] font-semibold">
          {{ initials }}
        </div>
        <span class="text-[13px] font-medium text-text-primary whitespace-nowrap">{{ user.currentUser?.name }}</span>
        <svg
          class="text-text-tertiary transition-transform"
          :class="{ 'rotate-180': menuOpen }"
          width="12"
          height="12"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
        ><path d="M4 6l4 4 4-4" /></svg>

        <!-- 下拉 -->
        <Transition name="dd">
          <div
            v-if="menuOpen"
            class="absolute top-[calc(100%+8px)] right-0 min-w-[220px] bg-bg-surface border border-border rounded-md shadow-lg p-1.5 z-dropdown"
            @click.stop
          >
            <div class="px-3 py-2.5 border-b border-border mb-1">
              <div class="text-[13px] font-semibold text-text-primary">
                {{ user.currentUser?.name }}
              </div>
              <div class="text-[11px] text-text-tertiary mt-0.5">
                {{ user.currentUser?.email || '—' }}
              </div>
              <span class="inline-block mt-1.5 text-[10px] px-1.5 py-0.5 rounded bg-primary-soft text-primary font-medium">
                {{ roleLabel }}
              </span>
            </div>
            <RouterLink
              v-if="canManageUsers"
              to="/users"
              class="flex items-center gap-2 px-2.5 py-2 rounded-sm text-[13px] text-text-primary hover:bg-bg-elevated"
            >
              <svg
                class="w-3.5 h-3.5 text-text-tertiary"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              ><circle
                cx="6"
                cy="5"
                r="2.5"
              /><path d="M2 13c0-2.2 1.8-4 4-4s4 1.8 4 4" /><circle
                cx="11.5"
                cy="5"
                r="2"
              /><path d="M11.5 9c2 0 3 1.2 3 2.5" /></svg>
              用户管理
            </RouterLink>
            <a
              class="flex items-center gap-2 px-2.5 py-2 rounded-sm text-[13px] text-text-primary hover:bg-bg-elevated cursor-pointer"
              @click="changePwdOpen = true; menuOpen = false"
            >
              <svg
                class="w-3.5 h-3.5 text-text-tertiary"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              ><rect
                x="3"
                y="7"
                width="10"
                height="7"
                rx="1"
              /><path d="M5 7V5a3 3 0 0 1 6 0v2" /></svg>
              修改密码
            </a>
            <div class="h-px bg-border my-1" />
            <a
              class="flex items-center gap-2 px-2.5 py-2 rounded-sm text-[13px] text-text-primary hover:bg-bg-elevated cursor-pointer"
              @click="onLogout"
            >
              <svg
                class="w-3.5 h-3.5 text-text-tertiary"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              ><path d="M9 2H4v12h5M9 5h3l2 2v7H9" /></svg>
              退出登录
            </a>
            <div class="px-3 py-1.5 border-t border-border mt-1 flex justify-between text-[11px] text-text-tertiary">
              <span>数字政务事业部</span><span>v2.7.0</span>
            </div>
          </div>
        </Transition>
      </div>
    </div>

    <ChangePasswordModal v-model="changePwdOpen" />
  </header>
</template>

<style scoped>
.dd-enter-active,
.dd-leave-active {
  transition: all 160ms;
}
.dd-enter-from,
.dd-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
