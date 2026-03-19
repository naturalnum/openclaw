<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter } from "vue-router";
import { reviewsApi } from "@/api/client";
import StatusChip from "@/components/StatusChip.vue";
import { formatTime } from "@/composables/useTimeFormat";
import type { PendingReviewItem } from "@shared/types/api";

interface ReviewHistoryItem {
  id: number;
  action: string;
  reason: string;
  reviewerName: string;
  checkResults: unknown;
  createdAt: number;
}

const props = defineProps<{ versionId: number }>();
const router = useRouter();

const loading = ref(true);
const version = ref<PendingReviewItem | null>(null);
const reviewHistory = ref<ReviewHistoryItem[]>([]);
const rejectReason = ref("");
const operating = ref(false);
const opError = ref("");

async function loadData() {
  const res = await reviewsApi.detail(props.versionId);
  version.value = res.version;
  reviewHistory.value = (res.reviews ?? []) as ReviewHistoryItem[];
}

onMounted(async () => {
  try {
    await loadData();
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
});

async function runCheck() {
  operating.value = true;
  opError.value = "";
  try {
    await reviewsApi.check(props.versionId);
    await loadData();
  } catch (e: unknown) {
    opError.value = e instanceof Error ? e.message : String(e);
  } finally {
    operating.value = false;
  }
}

async function approve() {
  operating.value = true;
  opError.value = "";
  try {
    await reviewsApi.approve(props.versionId);
    router.push("/admin/reviews");
  } catch (e: unknown) {
    opError.value = e instanceof Error ? e.message : String(e);
  } finally {
    operating.value = false;
  }
}

async function reject() {
  if (!rejectReason.value.trim()) {
    opError.value = "拒绝原因不能为空";
    return;
  }
  operating.value = true;
  opError.value = "";
  try {
    await reviewsApi.reject(props.versionId, rejectReason.value.trim());
    router.push("/admin/reviews");
  } catch (e: unknown) {
    opError.value = e instanceof Error ? e.message : String(e);
  } finally {
    operating.value = false;
  }
}
</script>

<template>
  <section class="detail">
    <button class="btn ghost sm" style="margin-bottom: 12px" @click="router.push('/admin/reviews')">
      &larr; 返回审核列表
    </button>

    <div v-if="loading" class="loading">加载中...</div>
    <template v-else-if="version">
      <h2>{{ version.displayName ?? "未知技能" }}</h2>
      <div class="slug">/{{ version.slug }}</div>

      <div style="margin-top: 12px; display: flex; gap: 8px; align-items: center">
        <strong>版本:</strong>
        <span class="mono">{{ version.version }}</span>
        <StatusChip :status="version.reviewStatus ?? 'pending'" />
      </div>

      <div class="kv" style="margin-top: 8px">
        <strong>文件大小</strong>
        <span>{{ ((version.size ?? 0) / 1024).toFixed(1) }} KB</span>
      </div>
      <div class="kv">
        <strong>指纹</strong>
        <span class="mono">{{ version.fingerprint ?? "-" }}</span>
      </div>
      <div class="kv">
        <strong>上传时间</strong>
        <span>{{ formatTime(version.createdAt) }}</span>
      </div>

      <!-- Actions -->
      <div style="margin-top: 16px; display: flex; gap: 8px; flex-wrap: wrap">
        <button class="btn ghost" :disabled="operating" @click="runCheck">重新检查</button>
        <button class="btn brand" :disabled="operating" @click="approve">通过</button>
      </div>

      <div style="margin-top: 12px">
        <label>拒绝原因</label>
        <div style="display: flex; gap: 8px">
          <input v-model="rejectReason" class="input" placeholder="请输入拒绝原因" />
          <button
            class="btn ghost"
            :disabled="operating || !rejectReason.trim()"
            style="white-space: nowrap; color: #b33a22"
            @click="reject"
          >
            拒绝
          </button>
        </div>
      </div>

      <div v-if="opError" class="errorText show" style="margin-top: 8px">{{ opError }}</div>

      <!-- Review history -->
      <div v-if="reviewHistory.length" style="margin-top: 20px">
        <h3>审核历史</h3>
        <div
          v-for="(r, i) in reviewHistory"
          :key="i"
          class="review-panel"
          style="margin-bottom: 8px"
        >
          <div class="review-summary">
            <strong>{{ r.action }}</strong> by {{ r.reviewerName }}
            <span style="margin-left: 8px; color: var(--muted)">
              {{ formatTime(r.createdAt) }}
            </span>
          </div>
          <div v-if="r.reason" class="review-reason">{{ r.reason }}</div>
          <pre v-if="r.checkResults" class="banner" style="display: block; margin-top: 6px">{{
            JSON.stringify(r.checkResults, null, 2)
          }}</pre>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="empty">版本不存在。</div>
    </template>
  </section>
</template>
