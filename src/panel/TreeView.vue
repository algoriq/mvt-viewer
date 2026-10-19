<template>
  <div ref="host" class="tree-host"></div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { JsonTree } from './tree';

const props = defineProps<{
  data: unknown;
  label?: string;
  filter: string;
}>();

const host = ref<HTMLDivElement | null>(null);
let tree: JsonTree | null = null;

onMounted(() => {
  if (host.value) {
    tree = new JsonTree(host.value);
    tree.setData(props.data, props.label ?? 'document');
  }
});

watch(
  () => props.data,
  (data) => tree?.setData(data, props.label ?? 'document'),
);

watch(
  () => props.filter,
  (filter) => tree?.setFilter(filter),
);

onBeforeUnmount(() => {
  tree?.destroy();
  tree = null;
});

defineExpose({
  expandAll: () => tree?.expandAll(),
  collapseAll: () => tree?.collapseAll(),
});
</script>
