<script setup lang="ts">
import { computed } from 'vue'
import BaseBadge from '@/components/ui/BaseBadge.vue'
import type { BadgeVariant } from '@/types/common'

interface Props {
  status: string
  dot?: boolean
}
const props = defineProps<Props>()

// 业务状态文案 -> BaseBadge variant
const map: Record<string, BadgeVariant> = {
  已发布: 'success',
  在线: 'success',
  已完成: 'success',
  success: 'success',
  通过: 'success',
  构建中: 'info',
  处理中: 'info',
  运行中: 'info',
  治理中: 'info',
  进行中: 'info',
  草稿: 'warning',
  待激活: 'warning',
  待审: 'warning',
  规划中: 'warning',
  待处理: 'warning',
  pending: 'warning',
  待开始: 'neutral',
  离线: 'neutral',
  未启动: 'neutral',
  已归档: 'neutral',
  已废弃: 'neutral',
  已驳回: 'danger',
  失败: 'danger',
  敏感告警: 'danger',
  异常: 'danger',
  failed: 'danger'
}

const variant = computed(() => map[props.status] || 'neutral')
</script>

<template>
  <BaseBadge
    :variant="variant"
    :dot="dot"
  >
    {{ status }}
  </BaseBadge>
</template>
