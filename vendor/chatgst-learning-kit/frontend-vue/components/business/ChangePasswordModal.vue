<script setup lang="ts">
import { ref, computed } from 'vue'
import BaseModal from '@/components/ui/BaseModal.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import { changePassword } from '@/api/auth'
import { encryptPassword } from '@/utils/crypto'
import { validatePassword } from '@/utils/password'

interface Props {
  modelValue: boolean
}
const props = withDefaults(defineProps<Props>(), { modelValue: false })
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()

const oldPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const errorMsg = ref('')
const loading = ref(false)
const successMsg = ref('')

const strength = computed(() => validatePassword(newPassword.value))
const passwordMismatch = computed(() =>
  newPassword.value && confirmPassword.value && newPassword.value !== confirmPassword.value,
)
const canSubmit = computed(() =>
  oldPassword.value &&
  newPassword.value &&
  confirmPassword.value &&
  newPassword.value === confirmPassword.value &&
  strength.value.valid &&
  !loading.value,
)

function close() {
  emit('update:modelValue', false)
}

function onClosed() {
  oldPassword.value = ''
  newPassword.value = ''
  confirmPassword.value = ''
  errorMsg.value = ''
  successMsg.value = ''
  loading.value = false
}

async function onSubmit() {
  if (!canSubmit.value) return
  loading.value = true
  errorMsg.value = ''
  successMsg.value = ''
  try {
    const oldEnc = await encryptPassword(oldPassword.value)
    const newEnc = await encryptPassword(newPassword.value)
    await changePassword(oldEnc, newEnc)
    successMsg.value = '密码修改成功'
    setTimeout(() => close(), 1200)
  } catch (e) {
    const msg = e instanceof Error ? e.message : '密码修改失败'
    const resp = e as { response?: { data?: { message?: string } } }
    errorMsg.value = resp.response?.data?.message || msg
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <BaseModal
    :model-value="props.modelValue"
    title="修改密码"
    subtitle="密码将通过 RSA 加密传输"
    width="440px"
    @update:model-value="(v: boolean) => { if (!v) onClosed(); emit('update:modelValue', v) }"
  >
    <div class="space-y-4">
      <div>
        <label class="block text-xs font-medium text-text-secondary mb-1.5">旧密码</label>
        <BaseInput
          v-model="oldPassword"
          type="password"
          placeholder="请输入当前密码"
        />
      </div>
      <div>
        <label class="block text-xs font-medium text-text-secondary mb-1.5">新密码</label>
        <BaseInput
          v-model="newPassword"
          type="password"
          placeholder="至少8位，含大小写字母+数字+特殊字符"
        />
        <!-- 强度提示 -->
        <div
          v-if="newPassword && !strength.valid"
          class="mt-1.5 space-y-0.5"
        >
          <div
            v-for="err in strength.errors"
            :key="err"
            class="text-[11px] text-danger flex items-center gap-1"
          >
            <span>✕</span> {{ err }}
          </div>
        </div>
        <div
          v-else-if="newPassword && strength.valid"
          class="mt-1.5 text-[11px] text-success flex items-center gap-1"
        >
          <span>✓</span> 密码强度合格
        </div>
      </div>
      <div>
        <label class="block text-xs font-medium text-text-secondary mb-1.5">确认新密码</label>
        <BaseInput
          v-model="confirmPassword"
          type="password"
          placeholder="再次输入新密码"
        />
        <div
          v-if="passwordMismatch"
          class="text-[11px] text-danger mt-1"
        >
          两次输入的密码不一致
        </div>
      </div>
      <div
        v-if="errorMsg"
        class="text-xs text-danger bg-danger-soft rounded-md px-3 py-2"
      >
        {{ errorMsg }}
      </div>
      <div
        v-if="successMsg"
        class="text-xs text-success bg-success-soft rounded-md px-3 py-2"
      >
        {{ successMsg }}
      </div>
    </div>

    <template #footer>
      <BaseButton
        variant="secondary"
        @click="close"
      >
        取消
      </BaseButton>
      <BaseButton
        variant="primary"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        {{ loading ? '提交中…' : '确认修改' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
