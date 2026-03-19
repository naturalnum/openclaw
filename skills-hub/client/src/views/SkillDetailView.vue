<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRoute, useRouter } from "vue-router";
import { skillsApi } from "@/api/client";
import { useAuthStore } from "@/stores/auth";
import StatusChip from "@/components/StatusChip.vue";
import { formatTime } from "@/composables/useTimeFormat";
import type { SkillDetailResponse, VersionListItem } from "@shared/types/api";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const slug = route.params.slug as string;
const loading = ref(true);
const detail = ref<SkillDetailResponse | null>(null);
const versions = ref<VersionListItem[]>([]);

onMounted(async () => {
  try {
    const [d, v] = await Promise.all([skillsApi.detail(slug), skillsApi.versions(slug)]);
    detail.value = d;
    versions.value = v.items;
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
});

function downloadUrl(version?: string): string {
  const params = new URLSearchParams({ slug });
  if (version) params.set("version", version);
  return `/api/v1/download?${params}`;
}
</script>

<template>
  <section class="detail">
    <div v-if="loading" class="loading">加载中...</div>
    <template v-else-if="detail?.skill">
      <button class="btn ghost sm" style="margin-bottom: 12px" @click="router.push('/')">
        &larr; 返回列表
      </button>
      <h2>{{ detail.skill.displayName }}</h2>
      <div class="slug">/{{ detail.skill.slug }}</div>
      <p>{{ detail.skill.summary || "无简介" }}</p>

      <div class="stats" v-if="detail.skill.tags?.length">
        <span v-for="tag in detail.skill.tags" :key="tag" class="chip">{{ tag }}</span>
      </div>

      <div class="kv" style="margin-top: 12px">
        <strong>下载量</strong>
        <span>{{ detail.skill.stats?.downloads ?? 0 }}</span>
      </div>
      <div class="kv">
        <strong>创建时间</strong>
        <span>{{ formatTime(detail.skill.createdAt) }}</span>
      </div>
      <div class="kv">
        <strong>更新时间</strong>
        <span>{{ formatTime(detail.skill.updatedAt) }}</span>
      </div>

      <div v-if="detail.latestVersion" style="margin-top: 16px">
        <h3>最新版本: {{ detail.latestVersion.version }}</h3>
        <p v-if="detail.latestVersion.changelog">{{ detail.latestVersion.changelog }}</p>
        <a class="btn brand sm" :href="downloadUrl(detail.latestVersion.version)">下载最新版本</a>
      </div>

      <div v-if="versions.length" style="margin-top: 20px">
        <h3>版本历史</h3>
        <div class="tableWrap" style="display: block">
          <table>
            <thead>
              <tr>
                <th>版本</th>
                <th>发布时间</th>
                <th>变更说明</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in versions" :key="v.version">
                <td class="mono">{{ v.version }}</td>
                <td>{{ formatTime(v.createdAt) }}</td>
                <td>{{ v.changelog || "-" }}</td>
                <td>
                  <a class="btn ghost sm" :href="downloadUrl(v.version)">下载</a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    <template v-else>
      <div class="empty">
        技能 "{{ slug }}" 不存在或未发布。
        <br />
        <button class="btn ghost sm" style="margin-top: 10px" @click="router.push('/')">
          返回列表
        </button>
      </div>
    </template>
  </section>
</template>
