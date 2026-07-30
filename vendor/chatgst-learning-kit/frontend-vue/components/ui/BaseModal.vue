<script setup lang="ts">
interface Props {
  modelValue: boolean
  title?: string
  subtitle?: string
  width?: string
}
withDefaults(defineProps<Props>(), { width: '520px' })
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-modal flex items-center justify-center"
        @click.self="emit('update:modelValue', false)"
      >
        <div class="absolute inset-0 bg-[rgba(15,23,42,0.45)]" />
        <div
          class="relative bg-bg-surface rounded-lg shadow-lg z-modal flex flex-col max-h-[90vh]"
          :style="{ width }"
        >
          <div class="flex items-center justify-between px-5 py-4 border-b border-border">
            <div>
              <h3 class="text-[15px] font-semibold text-text-primary">
                {{ title }}
              </h3>
              <p
                v-if="subtitle"
                class="text-xs text-text-tertiary mt-1"
              >
                {{ subtitle }}
              </p>
            </div>
            <button
              class="text-text-tertiary hover:text-text-primary w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover"
              @click="emit('update:modelValue', false)"
            >
              ✕
            </button>
          </div>
          <div class="p-5 overflow-y-auto">
            <slot />
          </div>
          <div
            v-if="$slots.footer"
            class="px-5 py-3 border-t border-border bg-bg-elevated flex justify-end gap-2"
          >
            <slot name="footer" />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.modal-enter-active,
.modal-leave-active {
  transition: opacity 150ms;
}
.modal-enter-active > div:last-child,
.modal-leave-active > div:last-child {
  transition: all 150ms;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from > div:last-child,
.modal-leave-to > div:last-child {
  transform: scale(0.98);
  opacity: 0;
}
</style>
