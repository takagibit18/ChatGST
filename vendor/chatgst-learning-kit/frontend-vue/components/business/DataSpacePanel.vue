<script setup lang="ts">
// 数据空间固化面板：Step 1 第 3 步
// 单一统一面板：
//   1. 当前空间状态（顶部摘要）
//   2. 路径模板配置（爬虫路径模板后端 config.py）
//   3. 范围（仅已通过 / 全部有链接）
//   4. 候选列表（爬虫已通过且有 policyUrl 的政策，可勾选）
//   5. 执行按钮 → 弹窗选择目标空间（可多选 + 内联新建）→ 调 import-from-crawler 写入多空间
import { ref, onMounted, computed, watch } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseTable from '@/components/ui/BaseTable.vue'
import StatusBadge from '@/components/business/StatusBadge.vue'
import {
  importCrawlerToMultipleSpaces,
  getDataSpaces,
  createDataSpace,
  type MultiSpaceImportResult,
  type ImportFromCrawlerOptions
} from '@/api/data'
import { listPolicies } from '@/api/crawler'
import { fromCrawlerList, formatCrawlerTime, VERIFY_LABEL } from '@/api/crawler.adapter'
import type { CrawlItem } from '@/types/project'
import type { DataSpace } from '@/types/data'

	interface Props {
	  /** 当前流水线所属空间 ID（默认勾选；与项目 ID 同步） */
	  currentSpaceId: string
	  /** 只读模式：审核人仅查看，不能导入/固化数据 */
	  readonly?: boolean
	}
	const props = withDefaults(defineProps<Props>(), { readonly: false })
const emit = defineEmits<{
  imported: [result: MultiSpaceImportResult]
  advanced: []
}>()

// 暴露给 StepActionsPanel 调：当前数据空间状态
defineExpose({
  getSummary: () => ({
    fileCount: dataFileCount.value,
    hasData: hasData.value
  })
})

// ===== 当前数据空间状态 =====
const dataFileCount = ref(0)
const dataDirPath = ref('data/')
async function loadDataInfo() {
  try {
    const r = await fetch(`/api/v1/data/spaces/${encodeURIComponent(props.currentSpaceId)}`)
    const j = await r.json()
    if (j?.data) {
      dataFileCount.value = j.data.fileCount || 0
      dataDirPath.value = j.data.dataDir || 'data/'
    }
  } catch (e) {
    console.warn('[DataSpacePanel] load info failed', e)
  }
}

// ===== 路径模板 + 范围 =====
const showPathConfig = ref(false)
const pathTemplate = ref('{policy_keyword}/{region}/{region}_{policy_keyword}_{id}.md')
const scope = ref<'approved' | 'all-with-url'>('approved')

// ===== 候选政策列表（不变）=====
const candidates = ref<{ id: number; item: CrawlItem; selected: boolean }[]>([])
const loadingList = ref(false)
const errorMsg = ref('')

async function loadCandidates() {
  loadingList.value = true
  errorMsg.value = ''
  try {
    const verifyStatus = scope.value === 'approved' ? 'qualified' : undefined
    const r = await listPolicies({ page: 1, page_size: 500, ...(verifyStatus ? { verify_status: verifyStatus } : {}) })
    const items = fromCrawlerList(r.items).filter((i) => !!i.policyUrl)
    // 默认全选
    candidates.value = items.map((item) => ({ id: item.id, item, selected: true }))
  } catch (e: any) {
    errorMsg.value = e?.message || '加载失败'
  } finally {
    loadingList.value = false
  }
}

watch(scope, () => loadCandidates())
onMounted(() => {
  loadDataInfo()
  loadCandidates()
})

const selectedCount = computed(() => candidates.value.filter((x) => x.selected).length)
const totalCount = computed(() => candidates.value.length)
const allSelected = computed({
  get: () => selectedCount.value === totalCount.value && totalCount.value > 0,
  set: (v: boolean) => candidates.value.forEach((x) => (x.selected = v))
})

const tableSelectAll = computed({
  get: () => selectedCount.value === totalCount.value && totalCount.value > 0,
  set: (v: boolean) => candidates.value.forEach((x) => (x.selected = v))
})
const tableSelectIndeterminate = computed(
  () => selectedCount.value > 0 && selectedCount.value < totalCount.value
)
function onTableRowSelect(row: { id: number; selected: boolean }, v: boolean) {
  const i = candidates.value.findIndex((x) => x.id === row.id)
  if (i >= 0) candidates.value[i].selected = v
}
function invert() {
  candidates.value.forEach((x) => (x.selected = !x.selected))
}

const policyColumns = [
  { key: 'oneThingName', label: '一件事', width: '20%' },
  { key: 'subsidyItemName', label: '补贴事项' },
  { key: 'region', label: '地区', width: '100px' },
  { key: 'subsidyType', label: '类型', width: '90px' },
  { key: 'verifyStatus', label: '核验状态', width: '90px' },
  { key: 'mdStatus', label: 'MD', width: '90px' },
  { key: 'createdAt', label: '采集时间', width: '110px' },
  { key: 'policyUrl', label: '原文链接' }
]
const scopeOptions = [
  { value: 'approved', label: '仅已通过', desc: '只固化核验通过的政策' },
  { value: 'all-with-url', label: '全部有链接', desc: '包含待核验但已有链接的' }
]

// ===== 目标空间选择弹窗（V1+ 新功能）=====
const showTargetModal = ref(false)
const loadingSpaces = ref(false)
const availableSpaces = ref<DataSpace[]>([])
const selectedSpaceIds = ref<Set<string>>(new Set())
const overwriteMap = ref<Record<string, boolean>>({})

// 内联新建
const newSpaceName = ref('')
const creatingSpace = ref(false)
const newSpaceError = ref('')

async function openTargetModal() {
  // 1. 校验政策选择
  if (selectedCount.value === 0) {
    alert('请至少勾选 1 条政策')
    return
  }
  // 2. 拉取空间列表
  loadingSpaces.value = true
  try {
    const r = await getDataSpaces()
    availableSpaces.value = r.list
    // 3. 默认不勾选任何空间（包括当前空间）—— 用户主动勾选才参与固化
    selectedSpaceIds.value = new Set()
    overwriteMap.value = {}
    if (!availableSpaces.value.find((s) => s.id === props.currentSpaceId)) {
      // 当前空间不在列表里（可能项目空间不是 ds-），加占位以便用户看到/勾选
      availableSpaces.value.unshift({
        id: props.currentSpaceId,
        key: props.currentSpaceId,
        title: '当前项目空间',
        desc: '本流水线默认空间',
        color: 'primary',
        status: '运行中',
        statusVariant: 'success' as any,
        meta: [],
        owner: { id: '', name: '—', avatar: '' } as any,
        updated: ''
      } as DataSpace)
    }
    // 注: 不再自动勾选当前空间；用户必须显式勾选
    showTargetModal.value = true
  } catch (e: any) {
    alert(`加载空间列表失败：${e?.message || '未知错误'}`)
  } finally {
    loadingSpaces.value = false
  }
}

function toggleSpace(id: string) {
  if (selectedSpaceIds.value.has(id)) selectedSpaceIds.value.delete(id)
  else selectedSpaceIds.value.add(id)
  // 触发响应式
  selectedSpaceIds.value = new Set(selectedSpaceIds.value)
}
function toggleSpaceAll(v: boolean) {
  if (v) {
    selectedSpaceIds.value = new Set(availableSpaces.value.map((s) => s.id))
  } else {
    selectedSpaceIds.value = new Set()
  }
}
const allSpaceSelected = computed(
  () => availableSpaces.value.length > 0 && selectedSpaceIds.value.size === availableSpaces.value.length
)
const allSpaceIndeterminate = computed(
  () => selectedSpaceIds.value.size > 0 && selectedSpaceIds.value.size < availableSpaces.value.length
)

const spaceTableSelectAll = computed({
  get: () => allSpaceSelected.value,
  set: (v: boolean) => toggleSpaceAll(v)
})

function onSpaceRowSelect(row: { id: string }, v: boolean) {
  if (v) selectedSpaceIds.value.add(row.id)
  else selectedSpaceIds.value.delete(row.id)
  // 触发响应式
  selectedSpaceIds.value = new Set(selectedSpaceIds.value)
}

function toggleOverwrite(id: string) {
  overwriteMap.value[id] = !overwriteMap.value[id]
  overwriteMap.value = { ...overwriteMap.value }
}

async function createSpaceInline() {
  const name = newSpaceName.value.trim()
  if (!name) {
    newSpaceError.value = '请填写空间名称'
    return
  }
  creatingSpace.value = true
  newSpaceError.value = ''
  try {
    const space = await createDataSpace({ name, description: '数据空间数据集' })
    // 注入到列表
    const inserted: DataSpace = {
      id: space.id,
      key: space.id,
      title: space.name,
      desc: space.description || '数据空间数据集',
      color: 'primary',
      status: '草稿',
      statusVariant: 'neutral' as any,
      meta: [],
      owner: { id: '', name: '—', avatar: '' } as any,
      updated: space.updatedAt
    }
    availableSpaces.value.push(inserted)
    // 自动勾选 + 标记为"新空间" → 跳过判断无意义, 默认覆盖 (force import)
    selectedSpaceIds.value.add(space.id)
    overwriteMap.value[space.id] = true
    selectedSpaceIds.value = new Set(selectedSpaceIds.value)
    overwriteMap.value = { ...overwriteMap.value }
    newSpaceName.value = ''
  } catch (e: any) {
    newSpaceError.value = e?.message || '创建失败'
  } finally {
    creatingSpace.value = false
  }
}

const spaceColumns = [
  { key: 'title', label: '空间名', width: '32%' },
  { key: 'key', label: 'ID', width: 'auto' },
  { key: 'owner', label: '负责人', width: '100px' },
  { key: 'updated', label: '更新时间', width: '110px' },
  { key: 'overwrite', label: '覆盖', width: '70px', align: 'center' as const }
]

// ===== 执行固化（直接固化到当前项目空间）=====
const executing = ref(false)
const multiResult = ref<MultiSpaceImportResult | null>(null)
const showResult = ref(false)

async function doMaterialize() {
  if (selectedCount.value === 0) {
    alert('请至少勾选 1 条政策')
    return
  }

  // 政策 ID 范围
  const policyIds = candidates.value.filter((x) => x.selected).map((x) => x.id)
  const isAllSelected = policyIds.length === totalCount.value

  const payload: ImportFromCrawlerOptions = {
    space_ids: [props.currentSpaceId],
    include_unexported: true,
    ...(isAllSelected
      ? { verify_status: scope.value === 'approved' ? 'qualified' : 'all' }
      : { policy_ids: policyIds }
    )
  }

  executing.value = true
  multiResult.value = null
  try {
    const r = await importCrawlerToMultipleSpaces(payload)
    multiResult.value = r
    showResult.value = true
    // 立即刷新数据空间状态
    await loadDataInfo()
    if (r.total.imported > 0 && dataFileCount.value === 0) {
      dataFileCount.value = r.total.imported
    }
    if (r.total.imported > 0 || r.total.skipped > 0) {
      emit('imported', r)
    }
  } catch (e: any) {
    alert(`固化失败：${e?.message || '未知错误'}`)
  } finally {
    executing.value = false
  }
}

const hasData = computed(() => dataFileCount.value > 0)

// 固化结果弹窗：完成按钮 → emit advanced 让父组件推进流水线
function onResultDone() {
  showResult.value = false
  emit('advanced')
}
</script>

<template>
  <div class="space-y-4">
    <!-- 当前数据空间状态 -->
    <div class="bg-bg-surface border border-border rounded-lg p-4 flex items-center gap-4">
      <div class="w-12 h-12 rounded-lg bg-primary-soft text-primary flex items-center justify-center shrink-0">
        <svg width="24" height="24" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M2 4h12v8H2zM5 4V2h6v2M5 8h6" />
        </svg>
      </div>
      <div class="flex-1">
        <div class="text-[13px] font-semibold text-text-primary">当前数据空间</div>
        <div class="text-[12px] text-text-tertiary mt-0.5">
          本数据空间 <code class="font-mono">{{ dataDirPath }}</code> 目录下有
          <b class="text-text-primary tabular-nums">{{ dataFileCount }}</b> 个文件
        </div>
      </div>
      <StatusBadge v-if="hasData" status="已就绪" />
      <StatusBadge v-else status="待初始化" />
    </div>

    <!-- 路径模板配置（默认折叠，点击展开） -->
    <div class="bg-bg-surface border border-border rounded-lg p-4">
      <button
        type="button"
        class="w-full flex items-center justify-between text-left"
        @click="showPathConfig = !showPathConfig"
      >
        <div class="flex items-center gap-2">
          <span class="text-[13px] font-semibold text-text-primary">导出路径格式配置</span>
          <span class="text-[11px] text-text-tertiary">默认已配置，如需修改请展开</span>
        </div>
        <span
          class="text-text-tertiary text-[14px] shrink-0 transition-transform"
          :class="showPathConfig ? 'rotate-180' : ''"
        >▾</span>
      </button>
      <div v-if="showPathConfig" class="mt-3">
        <div class="text-[12px] text-text-tertiary mb-3">
          已核验通过的政策 → 写入数据空间 <code class="font-mono">data/</code>，文件按此模板组织。
        </div>
        <div class="flex items-center gap-2">
          <BaseInput v-model="pathTemplate" mono class="flex-1" />
          <BaseButton variant="primary">保存</BaseButton>
        </div>
        <div class="mt-2 flex items-start gap-1.5 text-[11px] text-warning bg-warning-soft border border-[#ECD2A5] rounded px-2.5 py-1.5">
          <span>⚠</span>
          <span>模板为前端预览，实际生效由爬虫后端 <code class="font-mono">config.py</code> 控制；改完需重启爬虫服务。支持变量：{'{policy_keyword}'} {'{region}'} {'{id}'} {'{file_type}'}</span>
        </div>
      </div>
    </div>

    <!-- 范围 + 候选列表 + 执行 -->
    <div class="bg-bg-surface border border-border rounded-lg p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-4">
          <span class="text-[13px] font-semibold text-text-primary">候选政策</span>
          <label
            v-for="o in scopeOptions"
            :key="o.value"
            class="flex items-center gap-1.5 text-[13px] cursor-pointer"
          >
            <input
              v-model="scope"
              type="radio"
              :value="o.value"
              class="accent-primary"
            >
            <span class="text-text-primary">{{ o.label }}</span>
            <span class="text-text-tertiary text-[11px]">· {{ o.desc }}</span>
          </label>
        </div>
        <div class="text-[12px] text-text-tertiary">
          共 <b class="text-text-primary tabular-nums">{{ totalCount }}</b> 条 · 已选
          <b class="text-primary tabular-nums">{{ selectedCount }}</b>
          <span v-if="errorMsg" class="ml-2 text-danger">⚠ {{ errorMsg }}</span>
          <span v-else-if="loadingList" class="ml-2 text-primary">⟳ 加载中…</span>
        </div>
      </div>

      <div class="flex items-center gap-2 mb-2 text-[12px] text-text-tertiary">
        <span>勾选要固化的政策；不勾选将按范围全量导入</span>
        <div class="ml-auto flex items-center gap-1.5">
          <button class="text-primary hover:underline" @click="allSelected = true">全选</button>
          <span class="text-border-strong">·</span>
          <button class="text-primary hover:underline" @click="invert">反选</button>
          <span class="text-border-strong">·</span>
          <button class="text-primary hover:underline" @click="allSelected = false">取消全选</button>
        </div>
      </div>

      <BaseTable
        :columns="policyColumns"
        :data="candidates"
        :row-key="'id'"
        selectable
        :select-all="tableSelectAll"
        :select-indeterminate="tableSelectIndeterminate"
        @update:select-all="tableSelectAll = $event"
        @row-select="onTableRowSelect"
      >
        <template #cell-oneThingName="{ row }">
          <span class="text-text-primary text-[13px]">{{ row.item.oneThingName || '—' }}</span>
        </template>
        <template #cell-subsidyItemName="{ row }">
          <span class="text-text-primary text-[13px]">{{ row.item.subsidyItemName || '—' }}</span>
        </template>
        <template #cell-region="{ row }">
          <span class="text-text-secondary text-[13px]">{{ row.item.region || row.item.publishRegion || '—' }}</span>
        </template>
        <template #cell-subsidyType="{ row }">
          <span class="text-[12px] text-text-secondary">{{ row.item.subsidyType || '—' }}</span>
        </template>
        <template #cell-verifyStatus="{ row }">
          <StatusBadge :status="VERIFY_LABEL[row.item.verifyStatus] || row.item.verifyStatus || '—'" />
        </template>
        <template #cell-mdStatus="{ row }">
          <span
            v-if="row.item.mdStatus === 'success'"
            class="inline-flex items-center gap-1 px-2 h-5 rounded-sm bg-success-soft text-success border border-[#B8DEC4] text-[11px] font-medium"
          >
            ✓ 已导
          </span>
          <span
            v-else-if="row.item.mdStatus === 'failed'"
            class="inline-flex items-center gap-1 px-2 h-5 rounded-sm bg-danger-soft text-danger border border-[#ECB7B0] text-[11px] font-medium"
          >
            ✕ 失败
          </span>
          <span
            v-else
            class="inline-flex items-center gap-1 px-2 h-5 rounded-sm bg-bg-hover text-text-tertiary border border-border text-[11px]"
          >
            未导
          </span>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="text-text-tertiary text-[12px]">{{ formatCrawlerTime(row.item.createdAt) }}</span>
        </template>
        <template #cell-policyUrl="{ row }">
          <a
            v-if="row.item.policyUrl"
            :href="row.item.policyUrl"
            target="_blank"
            class="text-primary hover:underline text-[12px] truncate inline-block max-w-[220px]"
          >{{ row.item.policyUrl }}</a>
          <span v-else class="text-text-tertiary">—</span>
        </template>
      </BaseTable>

      <div class="mt-3 flex items-center justify-end gap-2">
        <BaseButton
          variant="primary"
          :loading="executing"
	          :disabled="selectedCount === 0 || readonly"
          @click="doMaterialize"
        >
          固化到项目空间（已选 {{ selectedCount }} 条政策）→
        </BaseButton>
      </div>
    </div>

    <!-- 已有数据：提示条 -->
    <div v-if="hasData" class="bg-bg-elevated border border-border rounded-lg p-3 flex items-center gap-3">
      <div class="flex-1">
        <div class="text-[12px] text-text-secondary">
          ✓ 本数据空间已有 <b class="text-success tabular-nums">{{ dataFileCount }}</b> 个文件
        </div>
        <div class="text-[11px] text-text-tertiary mt-0.5">
          如需更新可重新勾选政策并固化；不需要更新可点容器外的"下一步"直接跳过
        </div>
      </div>
    </div>

    <!-- 固化结果弹窗 -->
    <BaseModal
      :model-value="showResult"
      title="固化结果"
      subtitle="已把选中政策写入目标数据空间 data/ 目录"
      width="640px"
      @update:model-value="showResult = $event"
    >
      <div v-if="multiResult" class="space-y-3">
        <!-- 整体状态徽标 -->
        <div class="flex items-center gap-2">
          <span
            v-if="multiResult.success"
            class="inline-flex items-center gap-1 px-2 h-6 rounded bg-success-soft text-success border border-[#B8DEC4] text-[12px] font-medium"
          >
            ✓ 全部成功
          </span>
          <span
            v-else
            class="inline-flex items-center gap-1 px-2 h-6 rounded bg-warning-soft text-warning border border-[#ECD2A5] text-[12px] font-medium"
          >
            ⚠ 部分失败
          </span>
          <span class="text-[11px] text-text-tertiary">
            总耗时 {{ multiResult.total.duration_ms }}ms
          </span>
        </div>

        <!-- 总计 3-col 卡片 -->
        <div class="grid grid-cols-3 gap-3">
          <div class="rounded-md border border-border p-3 text-center">
            <div class="text-[11px] text-text-tertiary mb-1">已导入</div>
            <div class="text-[22px] font-semibold text-success tabular-nums">{{ multiResult.total.imported }}</div>
          </div>
          <div class="rounded-md border border-border p-3 text-center">
            <div class="text-[11px] text-text-tertiary mb-1">跳过</div>
            <div class="text-[22px] font-semibold text-warning tabular-nums">{{ multiResult.total.skipped }}</div>
          </div>
          <div class="rounded-md border border-border p-3 text-center">
            <div class="text-[11px] text-text-tertiary mb-1">失败</div>
            <div class="text-[22px] font-semibold text-danger tabular-nums">{{ multiResult.total.failed }}</div>
          </div>
        </div>

        <!-- 分空间明细 -->
        <div>
          <div class="text-[12px] font-semibold text-text-secondary mb-1.5">按空间明细</div>
          <div class="border border-border rounded-md divide-y divide-border max-h-[260px] overflow-y-auto">
            <div
              v-for="(r, sid) in multiResult.per_space"
              :key="sid"
              class="px-3 py-2 flex items-center gap-3"
            >
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <code class="font-mono text-[11px] text-text-primary truncate">{{ sid }}</code>
                  <span
                    v-if="r.error"
                    class="text-[10px] px-1.5 h-4 inline-flex items-center rounded bg-danger-soft text-danger border border-[#ECB7B0]"
                  >整空间失败</span>
                </div>
                <div
                  v-if="r.error"
                  class="text-[11px] text-danger mt-0.5 truncate"
                >{{ r.error }}</div>
              </div>
              <div class="flex items-center gap-3 text-[12px] shrink-0">
                <span class="text-success tabular-nums">导入 {{ r.imported }}</span>
                <span class="text-warning tabular-nums">跳过 {{ r.skipped }}</span>
                <span class="text-danger tabular-nums">失败 {{ r.failed }}</span>
                <span class="text-text-tertiary tabular-nums text-[11px]">{{ r.duration_ms }}ms</span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <BaseButton variant="secondary" @click="showResult = false">关闭</BaseButton>
        <BaseButton variant="primary" @click="onResultDone">完成，进入下一步</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
