<script setup lang="ts">
import type { Person } from '@/types/common'

interface Props {
  person: Person
  size?: number
}
withDefaults(defineProps<Props>(), { size: 28 })
</script>

<template>
  <div
    class="rounded-full text-white flex items-center justify-center font-semibold shrink-0"
    :style="{ width: size + 'px', height: size + 'px', background: person.color, fontSize: Math.max(9, size * 0.4) + 'px' }"
  >
    {{ person.initials }}
  </div>
</template>
