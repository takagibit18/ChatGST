<script setup lang="ts">
// 审批面板：5 统计卡 + 筛选条 + 列表（含通过/驳回/详情）
// 数据源：爬虫后端 /api/policies + /api/policies/stats
import { ref, computed, onMounted } from 'vue'
import BaseCard from '@/components/ui/BaseCard.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTable from '@/components/ui/BaseTable.vue'
import StatusBadge from '@/components/business/StatusBadge.vue'
import ApprovalDrawer from '@/components/business/ApprovalDrawer.vue'
import { listPolicies, getPolicyStats, verifyPolicy } from '@/api/crawler'
import {
  fromCrawlerList,
  mapStats,
  VERIFY_LABEL,
  VERIFY_TO_BACKEND,
  SOURCE_LABEL,
  formatCrawlerTime
} from '@/api/crawler.adapter'
	import type { CrawlItem, VerifyStatus, CrawlSource } from '@/types/project'
	
	interface Props {
	  /** 只读模式：审核人仅查看，不能通过/驳回政策 */
	  readonly?: boolean
	}
	const props = withDefaults(defineProps<Props>(), { readonly: false })
	
	const list = ref<CrawlItem[]>([])
const stats = ref({ total: 0, pending: 0, approved: 0, rejected: 0, questionable: 0 })

// 暴露给 StepActionsPanel 调：当前统计
defineExpose({
  getSummary: () => ({
    total: stats.value.total,
    pending: stats.value.pending,
    approved: stats.value.approved
  })
})
const loading = ref(false)
const errorMsg = ref('')

const filterState = ref<VerifyStatus | 'all'>('all')
const filterSource = ref<CrawlSource | 'all'>('all')
const keyword = ref('')

const stateOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待核验' },
  { value: 'approved', label: '已通过' },
  { value: 'rejected', label: '已驳回' },
  { value: 'questionable', label: '存疑' }
]
const sourceOptions = [
  { value: 'all', label: '全部来源' },
  { value: 'manual', label: '手动录入' },
  { value: 'auto', label: '自动采集' },
  { value: 'batch', label: '批量导入' }
]

const filteredList = computed(() => {
  return list.value.filter((i) => {
    if (filterState.value !== 'all' && i.verifyStatus !== filterState.value) return false
    if (filterSource.value !== 'all' && i.source !== filterSource.value) return false
    if (keyword.value) {
      const k = keyword.value.toLowerCase()
      return [i.oneThingName, i.subsidyItemName, i.publishRegion, i.fileName, i.subsidyType].some((v) => v?.toLowerCase().includes(k))
    }
    return true
  })
})

const columns = [
  { key: 'id', label: 'ID', width: '60px' },
  { key: 'oneThingName', label: '一件事' },
  { key: 'subsidyItemName', label: '补贴事项' },
  { key: 'region', label: '地区', width: '90px' },
  { key: 'subsidyType', label: '类型', width: '90px' },
  { key: 'verifyStatus', label: '状态', width: '90px' },
  { key: 'source', label: '来源', width: '90px' },
  { key: 'createdAt', label: '采集时间', width: '110px' },
  { key: 'policyUrl', label: '原文链接' },
  { key: 'actions', label: '操作', width: '210px' }
]

async function load() {
  loading.value = true
  errorMsg.value = ''
  try {
    const [listR, statsR] = await Promise.all([
      listPolicies({ page: 1, page_size: 200 }),
      getPolicyStats()
    ])
    list.value = fromCrawlerList(listR.items)
    stats.value = mapStats(statsR)
  } catch (e: any) {
    errorMsg.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ===== 操作 =====
const drawerOpen = ref(false)
const drawerItem = ref<CrawlItem | null>(null)
function openDetail(item: CrawlItem) {
  drawerItem.value = item
  drawerOpen.value = true
}
async function quickAction(item: CrawlItem, status: VerifyStatus) {
  try {
    await verifyPolicy(item.id, VERIFY_TO_BACKEND[status] as any, '', item.creator || 'admin')
    // 本地更新
    const i = list.value.findIndex((x) => x.id === item.id)
    if (i >= 0) list.value[i] = { ...list.value[i], verifyStatus: status }
    // 重新拉 stats
    const statsR = await getPolicyStats()
    stats.value = mapStats(statsR)
  } catch (e: any) {
    alert(`操作失败：${e?.message || '未知错误'}`)
  }
}

const statStyle = [
  { label: '全部采集', color: 'text-text-primary' },
  { label: '待核验', color: 'text-warning' },
  { label: '已通过', color: 'text-success' },
  { label: '已驳回', color: 'text-danger' },
  { label: '存疑', color: 'text-text-secondary' }
]
</script>

<template>
  <div>
    <!-- 5 个统计卡 -->
    <div class="grid grid-cols-5 gap-3 mb-4">
      <BaseCard v-for="(s, i) in statStyle" :key="i" padding :shadow="false">
        <div class="text-[12px] text-text-tertiary mb-2">{{ s.label }}</div>
        <div class="text-[28px] font-semibold tabular-nums leading-none" :class="s.color">
          {{ [stats.total, stats.pending, stats.approved, stats.rejected, stats.questionable][i] }}
        </div>
      </BaseCard>
    </div>

    <!-- 筛选条 -->
    <div class="flex flex-wrap items-center gap-2 mb-3">
      <span class="text-[12px] text-text-tertiary">核验状态：</span>
      <BaseSelect v-model="filterState" :options="stateOptions" class="!w-[120px]" />
      <span class="text-[12px] text-text-tertiary ml-2">来源：</span>
      <BaseSelect v-model="filterSource" :options="sourceOptions" class="!w-[120px]" />
      <BaseInput v-model="keyword" placeholder="关键词搜索" class="!w-[200px]" />
      <BaseButton variant="primary">搜索</BaseButton>
      <BaseButton variant="secondary" @click="load">↻ 刷新</BaseButton>
      <span v-if="errorMsg" class="ml-auto text-[12px] text-danger">⚠ {{ errorMsg }}</span>
      <span v-else-if="loading" class="ml-auto text-[12px] text-primary">⟳ 加载中…</span>
    </div>

    <BaseTable :columns="columns" :data="filteredList" :row-key="'id'">
      <template #cell-subsidyType="{ row }">
        <span class="text-[12px] text-text-secondary">{{ row.subsidyType || '—' }}</span>
      </template>
      <template #cell-verifyStatus="{ row }">
        <StatusBadge :status="VERIFY_LABEL[row.verifyStatus as VerifyStatus]" />
      </template>
      <template #cell-source="{ row }">
        <span class="text-text-secondary text-[12px]">{{ SOURCE_LABEL[row.source as CrawlSource] || row.source }}</span>
      </template>
      <template #cell-createdAt="{ row }">
        <span class="text-text-tertiary text-[12px]">{{ formatCrawlerTime(row.createdAt) }}</span>
      </template>
      <template #cell-policyUrl="{ row }">
        <a v-if="row.policyUrl" :href="row.policyUrl" target="_blank" class="text-primary hover:underline text-[12px] truncate inline-block max-w-[180px]">{{ row.policyUrl }}</a>
        <span v-else class="text-text-tertiary">—</span>
      </template>
      <template #cell-actions="{ row }">
        <div class="flex items-center gap-1.5">
          <BaseButton size="sm" variant="ghost" @click="openDetail(row)">核验</BaseButton>
          <BaseButton size="sm" variant="primary" :disabled="row.verifyStatus === 'approved' || readonly" @click="quickAction(row, 'approved')">✓ 通过</BaseButton>
          <BaseButton size="sm" variant="danger" :disabled="row.verifyStatus === 'rejected' || readonly" @click="quickAction(row, 'rejected')">✕ 驳回</BaseButton>
        </div>
      </template>
    </BaseTable>

    <ApprovalDrawer v-model="drawerOpen" :item="drawerItem" @updated="load" />
  </div>
</template>
