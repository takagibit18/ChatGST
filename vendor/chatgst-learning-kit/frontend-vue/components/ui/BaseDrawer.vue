<script setup lang="ts">
interface Props {
  modelValue: boolean
  title?: string
  width?: string
}
withDefaults(defineProps<Props>(), { width: '520px' })
const emit = defineEmits<{ 'update:modelValue': [v: boolean] }>()
</script>

<template>
  <Teleport to="body">
    <Transition name="drawer-mask">
      <div
        v-if="modelValue"
        class="fixed inset-0 z-modal"
        @click.self="emit('update:modelValue', false)"
      >
        <div class="absolute inset-0 bg-[rgba(15,23,42,0.45)]" />
        <Transition name="drawer-panel">
          <div
            v-if="modelValue"
            class="absolute right-0 top-0 h-full bg-bg-surface flex flex-col shadow-lg"
            :style="{ width }"
          >
            <div class="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 class="text-[15px] font-semibold text-text-primary">
                <slot name="title">
                  {{ title }}
                </slot>
              </h3>
              <button
                class="text-text-tertiary hover:text-text-primary w-7 h-7 flex items-center justify-center rounded hover:bg-bg-hover"
                @click="emit('update:modelValue', false)"
              >
                ✕
              </button>
            </div>
            <div class="flex-1 overflow-y-auto p-5">
              <slot />
            </div>
            <div
              v-if="$slots.footer"
              class="px-5 py-3 border-t border-border bg-bg-elevated flex justify-between items-center"
            >
              <slot name="footer" />
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.drawer-mask-enter-active,
.drawer-mask-leave-active {
  transition: opacity 150ms;
}
.drawer-mask-enter-from,
.drawer-mask-leave-to {
  opacity: 0;
}
.drawer-panel-enter-active,
.drawer-panel-leave-active {
  transition: transform 200ms;
}
.drawer-panel-enter-from,
.drawer-panel-leave-to {
  transform: translateX(100%);
}
</style>
