<script setup lang="ts">
defineProps<{ status: string }>();

function statusClass(s: string): string {
  switch (s) {
    case "approved":
      return "chip-approved";
    case "rejected":
      return "chip-rejected";
    case "pending":
    case "needs_review":
      return "chip-pending";
    default:
      return "";
  }
}

function statusLabel(s: string): string {
  switch (s) {
    case "approved":
      return "已通过";
    case "rejected":
      return "已拒绝";
    case "pending":
      return "待审核";
    case "needs_review":
      return "需审核";
    default:
      return s;
  }
}
</script>

<template>
  <span class="chip" :class="statusClass(status)">{{ statusLabel(status) }}</span>
</template>

<style scoped>
.chip-approved {
  background: rgba(47, 157, 102, 0.12);
  color: #1a7a4a;
  border-color: rgba(47, 157, 102, 0.3);
}
.chip-rejected {
  background: rgba(220, 90, 60, 0.12);
  color: #b33a22;
  border-color: rgba(220, 90, 60, 0.3);
}
.chip-pending {
  background: rgba(234, 179, 8, 0.12);
  color: #92400e;
  border-color: rgba(234, 179, 8, 0.3);
}
</style>
