<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(defineProps<{
  value: unknown;
  label?: string;
  open?: boolean;
}>(), { open: false });

const pretty = computed(() => {
  try {
    return JSON.stringify(props.value, null, 2) ?? "null";
  } catch {
    return String(props.value);
  }
});
</script>

<template>
  <details class="json-block" :open="open">
    <summary>{{ label ?? "JSON" }}</summary>
    <pre>{{ pretty }}</pre>
  </details>
</template>
