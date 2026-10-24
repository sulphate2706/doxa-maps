<script setup>
// Fixture for check:poster-wall-host-seams arm L: a component that renders a CHILD .vue by relative import, the
// shape PosterWall takes the day it renders its sections through a child component. The gate must load and render it.
import GateChild from './GateChild.vue'
defineProps({ label: { type: String, default: 'gate-child-label' } })
</script>

<template>
  <div class="gate-parent"><GateChild :label="label" /></div>
</template>
