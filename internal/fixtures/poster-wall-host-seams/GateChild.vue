<script setup>
defineProps({ label: { type: String, required: true } })
</script>

<template>
  <span class="gate-child">{{ label }}</span>
</template>
