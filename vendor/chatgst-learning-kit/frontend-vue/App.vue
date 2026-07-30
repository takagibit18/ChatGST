<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import AppLayout from '@/components/layout/AppLayout.vue'
import ErrorBoundary from '@/components/ErrorBoundary.vue'

const route = useRoute()
// 公开路由（如 /login）不套侧边栏/顶栏
const useChrome = computed(() => !route.meta.public)
</script>

<template>
  <ErrorBoundary>
    <template v-if="useChrome">
      <AppLayout />
    </template>
    <template v-else>
      <RouterView />
    </template>
  </ErrorBoundary>
</template>