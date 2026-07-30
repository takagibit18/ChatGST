<script setup lang="ts">
// Step 1 操作区：3 张平等独立的可选动作卡
// 设计原则：
//   - 3 卡独立可选，可全部跳过
//   - accordion 模式（同时只展开 1 张）
//   - 每张卡显示实时摘要（"已录入 N 条"等）
//   - 展开后才进入对应子面板
//   - "下一步"按钮在容器外（PipelinePage 控制），不受子步骤状态影响
import { ref, computed, markRaw } from 'vue'
import StatusBadge from '@/components/business/StatusBadge.vue'
import CrawlPanel from '@/components/business/CrawlPanel.vue'
import ApprovalPanel from '@/components/business/ApprovalPanel.vue'
import DataSpacePanel from '@/components/business/DataSpacePanel.vue'

// 子面板 ref（用于调用 getSummary）
const crawlRef = ref()
const approvalRef = ref()
const dataspaceRef = ref()

interface Action {
  key: 'crawl' | 'approval' | 'dataspace'
  title: string
  description: string
  icon: string
}

	interface Props {
	  projectId: string
	  /** 只读模式：审核人仅查看，不能操作采集/审批/固化 */
	  readonly?: boolean
	}
	const props = withDefaults(defineProps<Props>(), { readonly: false })

const emit = defineEmits<{
  advanced: []
}>()

// 固定的 3 张动作卡定义
const actions = computed<Action[]>(() => [
  { key: 'crawl',     title: '采集', description: '录入政策到爬虫系统（Excel/手动/自动）',     icon: '📥' },
  { key: 'approval',  title: '审批', description: '人工核验已采集政策',                                icon: '✅' },
  { key: 'dataspace', title: '固化', description: '把已通过政策写入数据空间 data/ 目录',         icon: '💾' }
])

// accordion 模式：同时只展开 1 张卡（'none' = 全部折叠）
const expanded = ref<'crawl' | 'approval' | 'dataspace' | 'none'>('none')
function toggle(key: 'crawl' | 'approval' | 'dataspace') {
  expanded.value = expanded.value === key ? 'none' : key
}

// 实时摘要：调用对应子面板的 getSummary() 拿到最新数据
// 子面板 mount 时自动拉一次数据；这里用定时器每 3 秒轮询一次（轻量）
const summary = ref<{
  crawl: { text: string; variant: 'success' | 'warning' | 'neutral' }
  approval: { text: string; variant: 'success' | 'warning' | 'neutral' }
  dataspace: { text: string; variant: 'success' | 'warning' | 'neutral' }
}>({
  crawl:     { text: '加载中...', variant: 'neutral' },
  approval:  { text: '加载中...', variant: 'neutral' },
  dataspace: { text: '加载中...', variant: 'neutral' }
})

async function loadSummary(key: 'crawl' | 'approval' | 'dataspace') {
  try {
    if (key === 'crawl') {
      // 调爬虫 /api/policies/stats
      const r = await fetch('/api/crawler/api/policies/stats')
      const j = await r.json()
      const total = j?.total ?? 0
      summary.value.crawl = {
        text: total > 0 ? `已录入 ${total} 条` : '尚未录入',
        variant: total > 0 ? 'success' : 'neutral'
      }
    } else if (key === 'approval') {
      // 调爬虫 /api/policies/stats
      const r = await fetch('/api/crawler/api/policies/stats')
      const j = await r.json()
      const pending = j?.pending ?? 0
      const approved = j?.qualified ?? 0
      summary.value.approval = {
        text: `待核验 ${pending} · 已通过 ${approved}`,
        variant: approved > 0 ? 'success' : pending > 0 ? 'warning' : 'neutral'
      }
    } else if (key === 'dataspace') {
      // 调我们后端 /api/v1/data/spaces/:id
      const r = await fetch(`/api/v1/data/spaces/${encodeURIComponent(props.projectId)}`)
      const j = await r.json()
      const count = j?.data?.fileCount ?? 0
      summary.value.dataspace = {
        text: count > 0 ? `data/ 目录有 ${count} 个文件` : 'data/ 目录暂无内容',
        variant: count > 0 ? 'success' : 'neutral'
      }
    }
  } catch (e) {
    // 静默失败
  }
}

function loadAllSummaries() {
  loadSummary('crawl')
  loadSummary('approval')
  loadSummary('dataspace')
}

// mount 时拉一次 + 之后每 5 秒轮询
loadAllSummaries()
const pollTimer = setInterval(loadAllSummaries, 5000)

// 子面板 emit 之后刷新摘要
function onActionUpdated() {
  loadAllSummaries()
  // DataSpacePanel 可能有自己维护的 fileCount（固化到 ds-xxx 时 proj-xxx 查不到）
  const ds = dataspaceRef.value as any
  if (ds?.getSummary) {
    const s = ds.getSummary()
    if (s.fileCount > 0) {
      summary.value.dataspace = {
        text: `data/ 目录有 ${s.fileCount} 个文件`,
        variant: 'success'
      }
    }
  }
}

// CrawlPanel 请求查看审批列表 → 切换到审批面板
function onViewApproval() {
  expanded.value = 'approval'
  loadSummary('approval')
}

// DataSpacePanel 固化完成 → 透传给 PipelinePage 推进流水线
function onAdvanced() {
  emit('advanced')
}
import { onBeforeUnmount } from 'vue'
onBeforeUnmount(() => clearInterval(pollTimer))

// 用 markRaw 防止 Vue 把组件实例包成 reactive proxy
const crawlComp = markRaw(CrawlPanel)
const approvalComp = markRaw(ApprovalPanel)
const dataspaceComp = markRaw(DataSpacePanel)
</script>

<template>
  <div class="space-y-3">
    <!-- 顶部说明 -->
    <div class="flex items-center gap-2 text-[12px] text-text-tertiary">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v4M8 11h.01" />
      </svg>
      <span>以下 3 个操作相互独立，可勾选要执行的操作，也可全部跳过</span>
    </div>

    <!-- 3 张动作卡 -->
    <div
      v-for="act in actions"
      :key="act.key"
      class="bg-bg-surface border border-border rounded-lg overflow-hidden transition-colors"
      :class="expanded === act.key ? 'border-l-4 border-l-primary' : ''"
    >
      <!-- 卡片头部（始终可点击） -->
      <button
        type="button"
        class="w-full flex items-center gap-3 px-4 py-3 hover:bg-bg-hover transition-colors text-left"
        @click="toggle(act.key)"
      >
        <span class="text-[18px] shrink-0">{{ act.icon }}</span>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-[14px] font-semibold text-text-primary">{{ act.title }}</span>
            <StatusBadge :status="summary[act.key].text" :variant="summary[act.key].variant as any" :dot="false" />
          </div>
          <div class="text-[12px] text-text-tertiary mt-0.5 truncate">{{ act.description }}</div>
        </div>
        <span
          class="text-text-tertiary text-[14px] shrink-0 transition-transform"
          :class="expanded === act.key ? 'rotate-180' : ''"
        >▾</span>
      </button>

      <!-- 卡片内容（展开时渲染） -->
      <div v-if="expanded === act.key" class="border-t border-border bg-bg-elevated">
	        <CrawlPanel
	          v-if="act.key === 'crawl'"
	          ref="crawlRef"
	          :readonly="readonly"
	          @refresh="onActionUpdated"
	          @view-approval="onViewApproval"
	        />
	        <ApprovalPanel
	          v-else-if="act.key === 'approval'"
	          ref="approvalRef"
	          :readonly="readonly"
	          @refresh="onActionUpdated"
	        />
	        <DataSpacePanel
	          v-else-if="act.key === 'dataspace'"
	          ref="dataspaceRef"
	          :current-space-id="props.projectId"
	          :readonly="readonly"
	          @imported="onActionUpdated"
	          @advanced="onAdvanced"
	        />
      </div>
    </div>
  </div>
</template>
