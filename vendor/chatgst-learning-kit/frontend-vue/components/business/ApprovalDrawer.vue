<script setup lang="ts">
// 审批详情抽屉：完整展示政策的 19 个业务字段 + 核验操作
// 数据来源：爬虫后端 PUT /api/policies/{id}/verify
import { ref, watch } from 'vue'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseTextarea from '@/components/ui/BaseTextarea.vue'
import StatusBadge from '@/components/business/StatusBadge.vue'
import { verifyPolicy } from '@/api/crawler'
import { VERIFY_LABEL, VERIFY_TO_BACKEND, SOURCE_LABEL } from '@/api/crawler.adapter'
import type { CrawlItem, VerifyStatus } from '@/types/project'

interface Props {
  modelValue: boolean
  item: CrawlItem | null
}
const props = defineProps<Props>()
const emit = defineEmits<{ 'update:modelValue': [v: boolean]; updated: [] }>()

const note = ref('')
const submitting = ref(false)

watch(
  () => props.item,
  (v) => {
    note.value = v?.verifyNote || ''
  },
  { immediate: true }
)

async function decide(status: VerifyStatus) {
  if (!props.item) return
  submitting.value = true
  try {
    const backendStatus = VERIFY_TO_BACKEND[status]
    await verifyPolicy(props.item.id, backendStatus as 'qualified' | 'rejected' | 'uncertain', note.value, props.item.creator || 'admin')
    emit('updated')
    emit('update:modelValue', false)
  } catch (e) {
    console.error('[ApprovalDrawer] 核验失败', e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <BaseDrawer :model-value="modelValue" width="720px" @update:model-value="emit('update:modelValue', $event)">
    <template #title>
      <div class="flex items-center gap-2">
        <span>政策核验</span>
        <StatusBadge v-if="item" :status="VERIFY_LABEL[item.verifyStatus]" />
      </div>
    </template>

    <div v-if="item" class="space-y-5">
      <!-- 政策标题 -->
      <div>
        <div class="text-[11px] font-semibold text-text-tertiary tracking-wider uppercase mb-1.5">政策标题</div>
        <div class="text-[15px] font-semibold text-text-primary">{{ item.fileName || item.subsidyItemName }}</div>
        <div class="text-[12px] text-text-tertiary mt-1">
          {{ item.oneThingName }} · {{ item.publishRegion }}
        </div>
      </div>

      <!-- 基础信息 -->
      <div>
        <div class="text-[11px] font-semibold text-text-tertiary tracking-wider uppercase mb-2">基础信息</div>
        <div class="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">补贴事项</div>
            <div class="text-text-primary">{{ item.subsidyItemName || '—' }}</div>
          </div>
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">补贴类型（推断）</div>
            <div class="text-text-primary">{{ item.subsidyType || '—' }}</div>
          </div>
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">文件类型</div>
            <div class="text-text-primary">{{ item.fileType || '—' }}</div>
          </div>
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">来源</div>
            <div class="text-text-primary">{{ SOURCE_LABEL[item.source] }}</div>
          </div>
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">发布单位</div>
            <div class="text-text-primary">{{ item.publishUnit || '—' }}</div>
          </div>
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">发布日期</div>
            <div class="text-text-primary">{{ item.publishDate || '—' }}</div>
          </div>
        </div>
      </div>

      <!-- 补贴详情 -->
      <div v-if="item.subsidyTarget || item.subsidyStandard || item.applyPeriod || item.applyCondition">
        <div class="text-[11px] font-semibold text-text-tertiary tracking-wider uppercase mb-2">补贴详情</div>
        <div class="space-y-2 text-[13px]">
          <div v-if="item.subsidyTarget">
            <span class="text-text-tertiary text-[12px]">补贴对象：</span>
            <span class="text-text-primary">{{ item.subsidyTarget }}</span>
          </div>
          <div v-if="item.subsidyStandard">
            <span class="text-text-tertiary text-[12px]">补贴标准：</span>
            <span class="text-text-primary">{{ item.subsidyStandard }}</span>
          </div>
          <div v-if="item.applyPeriod">
            <span class="text-text-tertiary text-[12px]">申报期限：</span>
            <span class="text-text-primary">{{ item.applyPeriod }}</span>
          </div>
          <div v-if="item.applyCondition">
            <span class="text-text-tertiary text-[12px]">申报条件：</span>
            <span class="text-text-primary">{{ item.applyCondition }}</span>
          </div>
        </div>
      </div>

      <!-- 办理信息 -->
      <div v-if="item.policyUrl || item.onlineEntry || item.handleChannel || item.applyProcedure">
        <div class="text-[11px] font-semibold text-text-tertiary tracking-wider uppercase mb-2">办理信息</div>
        <div class="space-y-2 text-[13px]">
          <div>
            <div class="text-text-tertiary text-[11px] mb-0.5">政策原文链接</div>
            <a v-if="item.policyUrl" :href="item.policyUrl" target="_blank" class="text-primary hover:underline font-mono text-[12px] break-all">{{ item.policyUrl }}</a>
            <span v-else class="text-text-tertiary">—</span>
          </div>
          <div v-if="item.onlineEntry">
            <div class="text-text-tertiary text-[11px] mb-0.5">线上办理入口</div>
            <div class="text-text-primary">{{ item.onlineEntry }}</div>
          </div>
          <div v-if="item.handleChannel">
            <div class="text-text-tertiary text-[11px] mb-0.5">办理渠道</div>
            <div class="text-text-primary">{{ item.handleChannel }}</div>
          </div>
          <div v-if="item.applyProcedure">
            <div class="text-text-tertiary text-[11px] mb-0.5">申领程序</div>
            <div class="text-text-primary">{{ item.applyProcedure }}</div>
          </div>
        </div>
      </div>

      <!-- 核验备注 -->
      <div>
        <label class="text-[12px] text-text-secondary block mb-1.5">核验备注</label>
        <BaseTextarea v-model="note" placeholder="请填写核验意见 / 驳回原因 / 存疑说明" :rows="4" />
      </div>
    </div>

    <template #footer>
      <div class="text-[11px] text-text-tertiary">操作将记录到核验日志</div>
      <div class="flex items-center gap-2">
        <BaseButton variant="danger" :loading="submitting" :disabled="!item" @click="decide('rejected')">✕ 驳回</BaseButton>
        <BaseButton variant="secondary" :loading="submitting" :disabled="!item" @click="decide('questionable')">存疑</BaseButton>
        <BaseButton variant="primary" :loading="submitting" :disabled="!item" @click="decide('approved')">✓ 通过</BaseButton>
      </div>
    </template>
  </BaseDrawer>
</template>
