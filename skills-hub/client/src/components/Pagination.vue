<script setup lang="ts">
const props = defineProps<{
  page: number;
  pageSize: number;
  total: number;
}>();

const emit = defineEmits<{
  "update:page": [value: number];
  "update:pageSize": [value: number];
}>();

const totalPages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));

function prev() {
  if (props.page > 1) emit("update:page", props.page - 1);
}

function next() {
  if (props.page < totalPages.value) emit("update:page", props.page + 1);
}

function changeSize(e: Event) {
  const val = Number((e.target as HTMLSelectElement).value);
  emit("update:pageSize", val);
  emit("update:page", 1);
}

import { computed } from "vue";
</script>

<template>
  <div class="pagination" v-if="total > 0">
    <button class="btn ghost sm" :disabled="page <= 1" @click="prev">上一页</button>
    <span class="page-info">{{ page }} / {{ totalPages }}</span>
    <button class="btn ghost sm" :disabled="page >= totalPages" @click="next">下一页</button>
    <select class="page-size-select" :value="pageSize" @change="changeSize">
      <option :value="10">10 条/页</option>
      <option :value="20">20 条/页</option>
      <option :value="50">50 条/页</option>
    </select>
  </div>
</template>
