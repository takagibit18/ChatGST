<script setup lang="ts">
// 批量导入结果弹窗：成功/重复/错误三类汇总
// 数据来源：爬虫后端 POST /api/policies/import-excel 响应
import { computed } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'

interface Props {
  modelValue: boolean
  // 爬虫后端响应: { message, total_imported, total_skipped, errors: string[] }
  // 适配成 UI 展示结构
  result: {
    total: number
    imported: number
    duplicateSkipped: number
    errors: { row: number; message: string }[]
  } | null
  fileName?: string
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const hasError = computed(() => (props.result?.errors?.length ?? 0) > 0)
const successRate = computed(() => {
  if (!props.result || !props.result.total) return '0%'
  return Math.round((props.result.imported / props.result.total) * 100) + '%'
})
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="批量导入结果"
    subtitle="系统已自动识别并按「一件事」分组导入"
    width="560px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="result">
      <!-- 文件信息 -->
      <div
        v-if="fileName"
        class="mb-4 px-3 py-2 bg-bg-elevated border border-border rounded text-[12px] text-text-secondary"
      >
        <span class="text-text-tertiary">导入文件：</span>
        <span class="font-mono">{{ fileName }}</span>
      </div>

      <!-- 三组数据 -->
      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="rounded-md border border-border p-3 bg-bg-surface">
          <div class="text-[11px] text-text-tertiary mb-1">共导入</div>
          <div class="text-[22px] font-semibold text-text-primary tabular-nums">{{ result.total }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">成功率 {{ successRate }}</div>
        </div>
        <div class="rounded-md border border-[#B8DEC4] bg-[#F4FBF6] p-3">
          <div class="text-[11px] text-success mb-1">成功导入</div>
          <div class="text-[22px] font-semibold text-success tabular-nums">{{ result.imported }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">条</div>
        </div>
        <div class="rounded-md border border-[#ECD2A5] bg-[#FFF8EB] p-3">
          <div class="text-[11px] text-warning mb-1">重复跳过</div>
          <div class="text-[22px] font-semibold text-warning tabular-nums">{{ result.duplicateSkipped }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">已存在</div>
        </div>
      </div>

      <!-- 错误列表 -->
      <div v-if="hasError">
        <div class="text-[12px] font-semibold text-text-primary mb-2">错误信息（{{ result.errors.length }}）</div>
        <div class="border border-[#ECB7B0] bg-[#FDF3F1] rounded-md overflow-hidden">
          <div
            v-for="(e, i) in result.errors"
            :key="i"
            class="flex items-center gap-2 px-3 py-2 text-[12px] border-b border-[#F4D6D0] last:border-0"
          >
            <span class="text-[10px] font-mono text-danger bg-danger-soft px-1.5 py-0.5 rounded">第 {{ e.row }} 行</span>
            <span class="text-text-secondary">{{ e.message }}</span>
          </div>
        </div>
      </div>
      <div
        v-else
        class="flex items-center gap-2 px-3 py-2.5 rounded-md border border-[#B8DEC4] bg-[#F4FBF6] text-[12px] text-success"
      >
        ✓ 全部导入成功，无错误
      </div>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('update:modelValue', false)">关闭</BaseButton>
      <BaseButton variant="primary" @click="emit('update:modelValue', false)">前往已采集列表</BaseButton>
    </template>
  </BaseModal>
</template>
