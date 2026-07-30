<script setup lang="ts">
// 自动采集结果弹窗：发现 / 新增 / 重复 + 临时结果表
// 数据来源：爬虫后端 POST /api/policies/auto-collect 响应
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTable from '@/components/ui/BaseTable.vue'

interface ResultItem {
  title: string
  region: string
  url: string
  applyUrl?: string
  status: string
  skipReason: string
}

interface Props {
  modelValue: boolean
  // 爬虫后端响应: { message, total_found, saved, skipped, results: any[] }
  result: {
    found: number
    added: number
    duplicateSkipped: number
    items: ResultItem[]
  } | null
  query?: { subsidyType: string; region: string; keyword: string }
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; 'viewList': [] }>()

const columns = [
  { key: 'title', label: '政策标题', width: '36%' },
  { key: 'region', label: '地区', width: '12%' },
  { key: 'status', label: '状态', width: '10%' },
  { key: 'url', label: '原文链接', width: '24%' },
  { key: 'applyUrl', label: '办理入口', width: '18%' },
]
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    title="自动采集结果"
    subtitle="已按补贴类型 / 地区 / 关键词检索政府网站并完成入库"
    width="860px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div v-if="result">
      <div
        v-if="query"
        class="mb-4 px-3 py-2 bg-bg-elevated border border-border rounded text-[12px] text-text-secondary flex flex-wrap gap-3"
      >
        <span><span class="text-text-tertiary">类型：</span>{{ query.subsidyType || '全部' }}</span>
        <span><span class="text-text-tertiary">地区：</span>{{ query.region || '不限' }}</span>
        <span><span class="text-text-tertiary">关键词：</span>{{ query.keyword || '—' }}</span>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4">
        <div class="rounded-md border border-border bg-bg-surface p-3">
          <div class="text-[11px] text-text-tertiary mb-1">发现</div>
          <div class="text-[22px] font-semibold text-text-primary tabular-nums">{{ result.found }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">条候选</div>
        </div>
        <div class="rounded-md border border-[#B8DEC4] bg-[#F4FBF6] p-3">
          <div class="text-[11px] text-success mb-1">新增入库</div>
          <div class="text-[22px] font-semibold text-success tabular-nums">{{ result.added }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">条新政策</div>
        </div>
        <div class="rounded-md border border-[#ECD2A5] bg-[#FFF8EB] p-3">
          <div class="text-[11px] text-warning mb-1">重复跳过</div>
          <div class="text-[22px] font-semibold text-warning tabular-nums">{{ result.duplicateSkipped }}</div>
          <div class="text-[10px] text-text-tertiary mt-1">已存在</div>
        </div>
      </div>

      <div class="text-[12px] font-semibold text-text-primary mb-2">本次采集明细（最多展示前 10 条）</div>
      <BaseTable :columns="columns" :data="result.items" empty-text="本次未发现新政策">
        <template #cell-title="{ row }">
          <span class="text-[12px] text-text-primary truncate inline-block max-w-[260px]" :title="row.title">{{ row.title }}</span>
        </template>
        <template #cell-status="{ row }">
          <span v-if="row.status === 'saved'" class="text-[11px] text-success font-semibold">新增</span>
          <span v-else-if="row.status === 'skipped'" class="text-[11px] text-warning" :title="row.skipReason">重复</span>
          <span v-else class="text-[11px] text-text-tertiary">—</span>
        </template>
        <template #cell-url="{ row }">
          <a
            v-if="row.url"
            :href="row.url"
            target="_blank"
            class="text-primary hover:underline text-[12px] truncate inline-block max-w-[180px]"
            :title="row.url"
          >查看原文</a>
          <span v-else class="text-text-tertiary">—</span>
        </template>
        <template #cell-applyUrl="{ row }">
          <a
            v-if="row.applyUrl"
            :href="row.applyUrl"
            target="_blank"
            class="text-primary hover:underline text-[12px] truncate inline-block max-w-[120px]"
            :title="row.applyUrl"
          >办理入口</a>
          <span v-else class="text-text-tertiary">—</span>
        </template>
      </BaseTable>
    </div>

    <template #footer>
      <BaseButton variant="secondary" @click="emit('update:modelValue', false)">关闭</BaseButton>
      <BaseButton variant="primary" @click="emit('viewList')">查看已采集列表</BaseButton>
    </template>
  </BaseModal>
</template>
