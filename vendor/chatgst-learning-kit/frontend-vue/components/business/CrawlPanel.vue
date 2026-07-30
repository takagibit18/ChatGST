<script setup lang="ts">
// 采集面板：3 个 Tab（批量导入 / 手动录入 / 自动采集）
// 数据源：爬虫后端 API（统一通过 src/api/crawler.ts + adapter.ts）
import { ref, reactive, computed, onMounted } from 'vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import StatusBadge from '@/components/business/StatusBadge.vue'
import ImportResultModal from '@/components/business/ImportResultModal.vue'
import AutoCollectResultModal from '@/components/business/AutoCollectResultModal.vue'
import {
  getPolicyStats,
  importExcel,
  createPolicy,
  autoCollect as apiAutoCollect
} from '@/api/crawler'
import { mapStats } from '@/api/crawler.adapter'
import { SUBSIDY_ITEMS, type SubsidyType } from '@/types/project'

	interface Props {
	  // 保留 props 兼容（pipeline.json 的子面板初始数据），失败时回退
	  fallback?: {
	    tabs: { key: 'batch' | 'manual' | 'auto' | 'list'; label: string; badge?: number }[]
	    batchImportHint: string
	    manualEntryHint: string
	    autoCollectHint: string
	  }
	  /** 只读模式：审核人仅查看，不能创建/导入/采集政策 */
	  readonly?: boolean
	}
	const props = withDefaults(defineProps<Props>(), { readonly: false })
const emit = defineEmits<{ refresh: []; viewApproval: [] }>()

type TabKey = 'batch' | 'manual' | 'auto'
const activeTab = ref<TabKey>('batch')

// 加载状态
const loading = ref(false)
const errorMsg = ref<string>('')

async function loadFromAPI() {
  loading.value = true
  errorMsg.value = ''
  try {
    const statsR = await getPolicyStats()
    cachedStats.value = mapStats(statsR)
  } catch (e: any) {
    errorMsg.value = e?.message || '加载失败'
    console.error('[CrawlPanel] load error', e)
  } finally {
    loading.value = false
  }
}
onMounted(loadFromAPI)

// 统计（默认从 API 拿，fallback 0）
const cachedStats = ref({ total: 0, pending: 0, approved: 0, rejected: 0, questionable: 0 })
const stats = computed(() => cachedStats.value)

// 暴露给 StepActionsPanel 调：当前统计
defineExpose({
  getSummary: () => ({
    total: cachedStats.value.total,
    pending: cachedStats.value.pending,
    approved: cachedStats.value.approved
  })
})

// ============ 批量导入 ============
const fileInput = ref<HTMLInputElement | null>(null)
const selectedFile = ref<{ fileName: string; size: number } | null>(null)
const showImportResult = ref(false)
const importResult = ref<{ total: number; imported: number; duplicateSkipped: number; errors: { row: number; message: string }[] } | null>(null)
const importing = ref(false)

function pickFile() {
  fileInput.value?.click()
}
function onFileChange(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (!f) return
  selectedFile.value = { fileName: f.name, size: f.size }
}
async function submitBatchImport() {
  if (!selectedFile.value) return
  importing.value = true
  try {
    const r = await importExcel((fileInput.value as HTMLInputElement).files![0])
    // 后端 errors 是 string[]，转成 {row, message}
    const errors = (r.errors || []).map((msg, i) => ({ row: i + 1, message: msg }))
    importResult.value = {
      total: r.total_imported + r.total_skipped,
      imported: r.total_imported,
      duplicateSkipped: r.total_skipped,
      errors
    }
    showImportResult.value = true
    selectedFile.value = null
    if (fileInput.value) fileInput.value.value = ''
    await loadFromAPI()
    emit('refresh')
  } catch (e: any) {
    alert(`导入失败：${e?.message || '未知错误'}`)
  } finally {
    importing.value = false
  }
}

// ============ 手动录入 ============
const form = reactive({
  oneThingName: '',
  subsidyItemName: '',
  publishRegion: '',
  fileType: '政策',
  fileName: '',
  publishUnit: '',
  publishDate: '',
  subsidyTarget: '',
  subsidyStandard: '',
  applyPeriod: '',
  onlineEntry: '',
  policyUrl: ''
})
const manualSubmitting = ref(false)
const manualSuccess = ref(false)
async function submitManual() {
  if (!form.oneThingName || !form.subsidyItemName || !form.publishRegion) {
    alert('一件事名称、补贴事项、发布地区为必填')
    return
  }
  manualSubmitting.value = true
  try {
    // 后端字段是 snake_case
    await createPolicy({
      one_thing_name: form.oneThingName,
      subsidy_item_name: form.subsidyItemName,
      publish_region: form.publishRegion,
      file_type: form.fileType,
      file_name: form.fileName || form.subsidyItemName,
      publish_unit: form.publishUnit,
      publish_date: form.publishDate,
      subsidy_target: form.subsidyTarget,
      subsidy_standard: form.subsidyStandard,
      apply_period: form.applyPeriod,
      online_entry: form.onlineEntry,
      policy_url: form.policyUrl
    })
    manualSuccess.value = true
    setTimeout(() => (manualSuccess.value = false), 2500)
    // 重置表单
    Object.assign(form, {
      oneThingName: '', subsidyItemName: '', publishRegion: '', fileType: '政策',
      fileName: '', publishUnit: '', publishDate: '',
      subsidyTarget: '', subsidyStandard: '', applyPeriod: '', onlineEntry: '', policyUrl: ''
    })
    await loadFromAPI()
    emit('refresh')
  } catch (e: any) {
    alert(`录入失败：${e?.message || '未知错误'}`)
  } finally {
    manualSubmitting.value = false
  }
}

// ============ 自动采集 ============
const auto = reactive({
  subsidyType: '育儿补贴申领资格审核' as SubsidyType,
  region: '北京市',
  keyword: '',
  keywordRelation: 'and' as 'and' | 'or',
  pages: 5,
  useGovSearch: true,
})
const autoRunning = ref(false)
const autoResult = ref<{ found: number; added: number; duplicateSkipped: number; items: { title: string; region: string; url: string; applyUrl?: string; status: string; skipReason: string }[] } | null>(null)
const showAutoResult = ref(false)

const keywordRelationOptions = [
  { value: 'and', label: '包含关系（同时匹配全部）' },
  { value: 'or', label: '并列关系（匹配任意一个）' },
]

async function submitAuto() {
  autoRunning.value = true
  try {
    const r = await apiAutoCollect({
      subsidy_type: auto.subsidyType,
      region: auto.region,
      keyword: auto.keyword || undefined,
      keyword_relation: auto.keywordRelation,
      pages: auto.pages,
      use_gov_search_scraper: auto.useGovSearch,
    })
    // 后端 results 是原始搜索结果（多字段），提取前 10 条转成 UI 格式
    const items = (r.results || []).slice(0, 10).map((it: any) => ({
      title: it.file_name || it.title || '—',
      region: it.publish_region || it.region || auto.region,
      url: it.policy_url || it.url || '',
      applyUrl: it.online_entry || '',
      status: it.status || '',
      skipReason: it.skip_reason || '',
    }))
    autoResult.value = {
      found: r.total_found,
      added: r.saved,
      duplicateSkipped: r.skipped,
      items
    }
    showAutoResult.value = true
    await loadFromAPI()
    emit('refresh')
  } catch (e: any) {
    alert(`自动采集失败：${e?.message || '未知错误'}`)
  } finally {
    autoRunning.value = false
  }
}

function onViewApproval() {
  showAutoResult.value = false
  emit('viewApproval')
}

const subsidyTypeOptions = SUBSIDY_ITEMS.map((s) => ({ value: s, label: s }))
const fileTypeOptions = [
  { value: '政策', label: '政策' },
  { value: '政策解读', label: '政策解读' },
  { value: '通知', label: '通知' },
  { value: '办法', label: '办法' },
  { value: '细则', label: '细则' },
  { value: '实施方案', label: '实施方案' }
]

</script>

<template>
  <div>
    <!-- 顶部统计条 + 错误提示 -->
    <div class="flex items-center gap-3 mb-3 text-[12px] text-text-tertiary">
      <span>共 <b class="text-text-primary tabular-nums">{{ stats.total }}</b> 条</span>
      <span class="text-border-strong">·</span>
      <span>待核验 <b class="text-warning tabular-nums">{{ stats.pending }}</b></span>
      <span class="text-border-strong">·</span>
      <span>已通过 <b class="text-success tabular-nums">{{ stats.approved }}</b></span>
      <span class="text-border-strong">·</span>
      <span>已驳回 <b class="text-danger tabular-nums">{{ stats.rejected }}</b></span>
      <span class="text-border-strong">·</span>
      <span>存疑 <b class="text-text-secondary tabular-nums">{{ stats.questionable }}</b></span>
      <span v-if="errorMsg" class="ml-auto text-danger">⚠ {{ errorMsg }}</span>
      <span v-else-if="loading" class="ml-auto text-primary">⟳ 加载中…</span>
      <button v-else class="ml-auto text-primary hover:underline" @click="loadFromAPI">↻ 刷新</button>
    </div>

    <!-- Tabs -->
    <div class="flex items-center gap-1 border-b border-border mb-5">
      <button
        v-for="t in [
          { key: 'batch' as TabKey, label: 'Excel 批量导入' },
          { key: 'manual' as TabKey, label: '手动录入' },
          { key: 'auto' as TabKey, label: '自动采集' }
        ]"
        :key="t.key"
        :class="[
          'h-9 px-3.5 text-[13px] -mb-px border-b-2 transition-colors',
          activeTab === t.key ? 'text-primary border-primary font-semibold' : 'text-text-secondary border-transparent hover:text-text-primary'
        ]"
        @click="activeTab = t.key"
      >
        <span class="inline-flex items-center gap-1.5">
          <span>{{ t.label }}</span>
        </span>
      </button>
    </div>

    <!-- Tab: 批量导入 -->
    <div v-if="activeTab === 'batch'">
      <div class="border border-[#B5CCE9] bg-primary-soft text-primary rounded-md px-3.5 py-2.5 text-[12px] mb-4">
        ⚡ 上传 Excel 文件，系统将自动识别并导入。<br>
        <span class="text-text-secondary">文件名规范：<code class="font-mono bg-bg-surface px-1.5 py-0.5 rounded">XX申请一件事.xlsx</code>（扩展名去掉后作为「一件事名称」）</span>
      </div>
      <div class="bg-bg-elevated border border-dashed border-border-strong rounded-lg p-8 text-center">
        <input ref="fileInput" type="file" accept=".xlsx" class="hidden" @change="onFileChange">
        <div class="text-[13px] text-text-tertiary mb-3">支持 .xlsx 格式 · 单文件 ≤ 20MB</div>
        <div
          v-if="selectedFile"
          class="inline-flex items-center gap-2 mb-3 px-3 py-1.5 bg-bg-surface border border-border rounded text-[12px] text-text-primary"
        >
          📄 <span class="font-mono">{{ selectedFile.fileName }}</span>
          <span class="text-text-tertiary">({{ (selectedFile.size / 1024).toFixed(1) }} KB)</span>
          <button class="text-text-tertiary hover:text-danger" @click="selectedFile = null; if (fileInput) fileInput.value = ''">✕</button>
        </div>
        <div class="flex items-center justify-center gap-2">
          <BaseButton variant="secondary" @click="pickFile">{{ selectedFile ? '重新选择文件' : '选择 Excel 文件' }}</BaseButton>
          <BaseButton v-if="selectedFile" variant="primary" :loading="importing" :disabled="readonly" @click="submitBatchImport">⬆ 上传导入</BaseButton>
        </div>
      </div>
    </div>

    <!-- Tab: 手动录入 -->
    <div v-if="activeTab === 'manual'">
      <div class="text-[12px] text-text-tertiary mb-3">逐条手动录入政策信息。后端所有字段都是可选，但「一件事名称 / 补贴事项 / 发布地区」建议必填。</div>
      <div class="grid grid-cols-2 gap-3 max-w-[920px]">
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">一件事名称 <span class="text-danger">*</span></label>
          <BaseInput v-model="form.oneThingName" placeholder="如：育儿补贴申请一件事" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">补贴事项名称 <span class="text-danger">*</span></label>
          <BaseInput v-model="form.subsidyItemName" placeholder="如：育儿补贴申领" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">发布地区 <span class="text-danger">*</span></label>
          <BaseInput v-model="form.publishRegion" placeholder="如：北京市" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">文件类型</label>
          <BaseSelect v-model="form.fileType" :options="fileTypeOptions" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">政策标题（file_name）</label>
          <BaseInput v-model="form.fileName" placeholder="如：陕西省养老服务消费补贴政策解读" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">发布单位</label>
          <BaseInput v-model="form.publishUnit" placeholder="如：陕西省民政厅" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">发布日期</label>
          <BaseInput v-model="form.publishDate" type="date" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">申报期限</label>
          <BaseInput v-model="form.applyPeriod" placeholder="如：2026年度按月发放" />
        </div>
        <div class="col-span-2">
          <label class="text-[12px] text-text-secondary block mb-1">补贴对象</label>
          <BaseInput v-model="form.subsidyTarget" placeholder="如：长期在陕居住、60周岁及以上中度以上失能老年人" />
        </div>
        <div class="col-span-2">
          <label class="text-[12px] text-text-secondary block mb-1">补贴标准</label>
          <BaseInput v-model="form.subsidyStandard" placeholder="如：机构服务抵扣40%；每月最高800元" />
        </div>
        <div class="col-span-2">
          <label class="text-[12px] text-text-secondary block mb-1">线上办理入口</label>
          <BaseInput v-model="form.onlineEntry" placeholder="如：民政通申请入口" />
        </div>
        <div class="col-span-2">
          <label class="text-[12px] text-text-secondary block mb-1">政策原文链接</label>
          <BaseInput v-model="form.policyUrl" placeholder="https://" type="url" />
        </div>
      </div>
      <div class="mt-4 flex items-center gap-2">
        <BaseButton variant="primary" :loading="manualSubmitting" :disabled="readonly" @click="submitManual">+ 新增政策</BaseButton>
        <BaseButton variant="ghost" @click="Object.assign(form, { oneThingName:'', subsidyItemName:'', publishRegion:'', fileType:'政策', fileName:'', publishUnit:'', publishDate:'', subsidyTarget:'', subsidyStandard:'', applyPeriod:'', onlineEntry:'', policyUrl:'' })">清空</BaseButton>
        <Transition name="fade">
          <span v-if="manualSuccess" class="text-[12px] text-success flex items-center gap-1">✓ 添加成功</span>
        </Transition>
      </div>
    </div>

    <!-- Tab: 自动采集 -->
    <div v-if="activeTab === 'auto'">
      <div class="text-[12px] text-text-tertiary mb-3">根据补贴类型 / 地区 / 关键词，自动搜索政府网站最新政策并入库（调用爬虫后端真实采集）。</div>
      <div class="grid grid-cols-[200px_1fr_1fr_auto] gap-3 items-end max-w-[960px] mb-3">
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">补贴类型</label>
          <BaseSelect v-model="auto.subsidyType" :options="subsidyTypeOptions" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">地区</label>
          <BaseInput v-model="auto.region" placeholder="默认示例：北京市/四川省" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">关键词</label>
          <BaseInput v-model="auto.keyword" placeholder="自定义搜索词（可空，多词用空格/逗号分隔）" />
        </div>
        <BaseButton variant="primary" :loading="autoRunning" :disabled="readonly" @click="submitAuto">▶ 开始采集</BaseButton>
      </div>
      <div class="grid grid-cols-[1fr_120px_1fr] gap-3 items-end max-w-[960px]">
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">多关键词关系</label>
          <BaseSelect v-model="auto.keywordRelation" :options="keywordRelationOptions" />
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">爬取页数</label>
          <input
            v-model.number="auto.pages"
            type="number"
            :min="1"
            :max="30"
            placeholder="5"
            class="w-full h-8 px-2.5 rounded-sm bg-bg-surface border border-border-strong text-[13px] text-text-primary placeholder:text-text-muted focus:outline-none focus:border-primary focus:shadow-focus"
          >
        </div>
        <div>
          <label class="text-[12px] text-text-secondary block mb-1">爬虫模式</label>
          <div class="flex items-center gap-2 h-[34px]">
            <button
              :class="[
                'h-[34px] px-3 text-[13px] rounded-sm border transition-colors',
                auto.useGovSearch
                  ? 'border-primary text-primary font-semibold bg-primary-soft'
                  : 'border-border text-text-tertiary hover:text-text-secondary'
              ]"
              @click="auto.useGovSearch = true"
            >政府网站搜索</button>
            <button
              :class="[
                'h-[34px] px-3 text-[13px] rounded-sm border transition-colors',
                !auto.useGovSearch
                  ? 'border-primary text-primary font-semibold bg-primary-soft'
                  : 'border-border text-text-tertiary hover:text-text-secondary'
              ]"
              @click="auto.useGovSearch = false"
            >快速模式</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab: 已采集列表（已移至数据空间菜单独立展示） -->

    <ImportResultModal v-model="showImportResult" :result="importResult" :file-name="selectedFile?.fileName" />
    <AutoCollectResultModal v-model="showAutoResult" :result="autoResult" :query="{ subsidyType: auto.subsidyType, region: auto.region, keyword: auto.keyword }" @view-list="onViewApproval" />
  </div>
</template>

<style scoped>
.fade-enter-active, .fade-leave-active { transition: opacity 200ms; }
.fade-enter-from, .fade-leave-to { opacity: 0; }
</style>
