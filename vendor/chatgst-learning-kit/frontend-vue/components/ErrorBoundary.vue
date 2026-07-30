<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue'
const err = ref<Error | null>(null)
onErrorCaptured((e: unknown) => {
  err.value = e instanceof Error ? e : new Error(String(e))
  console.error('[ErrorBoundary]', e)
  return false
})
</script>
<template>
  <div
    v-if="err"
    class="p-6 bg-danger/10 border border-danger rounded-md text-danger"
  >
    <h3 class="text-h3">
      页面出错了
    </h3>
    <pre class="mt-2 text-caption whitespace-pre-wrap">{{ err.message }}</pre>
  </div>
  <slot v-else />
</template>
