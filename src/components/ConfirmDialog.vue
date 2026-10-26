<script setup lang="ts">
import ModalDialog from './ModalDialog.vue'

defineProps<{
  open: boolean
  title: string
  message: string
  confirmLabel: string
}>()

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()
</script>

<template>
  <ModalDialog
    :open="open"
    labelled-by="confirm-dialog-title"
    described-by="confirm-dialog-message"
    class="w-[min(36rem,calc(100vw-2rem))] p-8"
    @cancel="emit('cancel')"
  >
    <h2 id="confirm-dialog-title" class="font-display text-3xl leading-tight font-extrabold">{{ title }}</h2>
    <p id="confirm-dialog-message" class="mt-3 text-xl">{{ message }}</p>
    <div class="mt-8 flex flex-wrap justify-end gap-3">
      <button type="button" class="btn" autofocus @click="emit('cancel')">Cancel</button>
      <button type="button" class="btn btn-primary" @click="emit('confirm')">{{ confirmLabel }}</button>
    </div>
  </ModalDialog>
</template>
