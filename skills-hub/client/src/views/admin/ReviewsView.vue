<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { reviewsApi } from "@/api/client";
import StatusChip from "@/components/StatusChip.vue";
import { formatTime } from "@/composables/useTimeFormat";
import type { PendingReviewItem } from "@shared/types/api";

const router = useRouter();
const loading = ref(true);
const reviews = ref<PendingReviewItem[]>([]);

onMounted(async () => {
  try {
    const res = await reviewsApi.listPending();
    reviews.value = res.reviews;
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
});

function goDetail(versionId: number) {
  router.push(`/admin/reviews/${versionId}`);
}
</script>

<template>
  <section class="detail">
    <h2>审核管理</h2>
    <p>以下版本需要人工审核：</p>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="reviews.length === 0" class="empty">暂无待审核版本。</div>
    <div v-else class="tableWrap" style="display: block; margin-top: 12px">
      <table>
        <thead>
          <tr>
            <th>技能</th>
            <th>版本</th>
            <th>状态</th>
            <th>大小</th>
            <th>上传时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in reviews" :key="r.id">
            <td>
              <strong>{{ r.displayName }}</strong>
              <div class="mono">/{{ r.slug }}</div>
            </td>
            <td class="mono">{{ r.version }}</td>
            <td>
              <StatusChip :status="r.reviewStatus" />
            </td>
            <td>{{ ((r.size ?? 0) / 1024).toFixed(1) }} KB</td>
            <td>{{ formatTime(r.createdAt) }}</td>
            <td>
              <button class="btn brand sm" @click="goDetail(r.id)">查看详情</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
