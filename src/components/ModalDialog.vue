<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  open: boolean
  labelledBy: string
  describedBy?: string
}>()

const emit = defineEmits<{
  cancel: []
}>()

const dialog = ref<HTMLDialogElement | null>(null)

watch(
  () => props.open,
  (open) => {
    const element = dialog.value
    if (element === null) {
      return
    }
    if (open && !element.open) {
      element.showModal()
    } else if (!open && element.open) {
      element.close()
    }
  },
  { flush: 'post' },
)

function onCancel(event: Event): void {
  event.preventDefault()
  emit('cancel')
}
</script>

<template>
  <dialog ref="dialog" class="panel m-auto text-ink backdrop:bg-ink/55" :aria-labelledby="labelledBy" :aria-describedby="describedBy" @cancel="onCancel">
    <slot />
  </dialog>
</template>
