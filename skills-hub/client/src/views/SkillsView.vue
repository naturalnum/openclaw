<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { useRouter } from "vue-router";
import { useSkillsStore } from "@/stores/skills";
import Pagination from "@/components/Pagination.vue";
import { relativeTime } from "@/composables/useTimeFormat";

const router = useRouter();
const skillsStore = useSkillsStore();

const query    = ref("");
const sort     = ref<"updated" | "downloads" | "name">("updated");
const view     = ref<"cards" | "table">("cards");
const page     = ref(1);
const pageSize = ref(20);

function load() {
  skillsStore.fetchPage({
    page:     page.value,
    pageSize: pageSize.value,
    sort:     sort.value,
    q:        query.value.trim(),
  });
}

onMounted(load);

// 搜索/排序变化时重置到第一页并重新请求
watch([query, sort], () => {
  page.value = 1;
  load();
});

// 翻页/每页条数变化时直接请求
watch([page, pageSize], load);

function toggleView() {
  view.value = view.value === "cards" ? "table" : "cards";
}

function goDetail(slug: string) {
  router.push(`/skills/${encodeURIComponent(slug)}`);
}
</script>

<template>
  <section class="hero">
    <div class="toolbar">
      <input
        v-model="query"
        class="input"
        placeholder="按名称、slug、简介筛选..."
        @input="page = 1"
      />
      <select v-model="sort" class="select" @change="page = 1">
        <option value="updated">最近更新</option>
        <option value="downloads">下载量</option>
        <option value="name">名称</option>
      </select>
      <button class="btn ghost" @click="toggleView">
        视图：{{ view === "cards" ? "卡片" : "表格" }}
      </button>
    </div>
    <div class="stats">
      <span class="pill">总数: {{ skillsStore.total }}</span>
      <span class="pill">排序: {{ sort === "updated" ? "最近更新" : sort === "downloads" ? "下载量" : "名称" }}</span>
      <span class="pill">视图: {{ view === "cards" ? "卡片" : "表格" }}</span>
    </div>
  </section>

  <main class="main">
    <div v-if="skillsStore.loading" class="loading">加载中...</div>
    <div v-else-if="skillsStore.items.length === 0" class="empty">未找到技能。</div>

    <template v-else>
      <!-- Cards view -->
      <div v-if="view === 'cards'" class="content-scroll">
        <section class="cards">
          <div
            v-for="skill in skillsStore.items"
            :key="skill.slug"
            class="card"
            @click="goDetail(skill.slug)"
            style="cursor: pointer"
          >
            <h3 class="title">{{ skill.displayName }}</h3>
            <div class="slug">/{{ skill.slug }}</div>
            <p class="summary">{{ skill.summary || "-" }}</p>
            <div class="card-meta">
              <span class="meta-item"><strong>版本</strong><span class="mono">{{ skill.latestVersion?.version ?? "-" }}</span></span>
              <span class="meta-item"><strong>下载</strong><span>{{ skill.stats?.downloads ?? 0 }}</span></span>
              <span class="meta-item"><strong>更新</strong><span>{{ relativeTime(skill.updatedAt) }}</span></span>
            </div>
            <div v-if="skill.tags?.length" class="stats">
              <span v-for="tag in skill.tags" :key="tag" class="chip">{{ tag }}</span>
            </div>
          </div>
        </section>
      </div>

      <!-- Table view -->
      <div v-else class="content-scroll">
        <div class="tableWrap">
          <table class="skills-table">
            <colgroup>
              <col class="col-skill" />
              <col class="col-summary" />
              <col class="col-version" />
              <col class="col-downloads" />
              <col class="col-updated" />
              <col class="col-action" />
            </colgroup>
            <thead>
              <tr>
                <th>技能</th>
                <th>简介</th>
                <th>最新版本</th>
                <th>下载量</th>
                <th>更新时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="skill in skillsStore.items" :key="skill.slug" @click="goDetail(skill.slug)" class="skill-row">
                <td>
                  <span class="skill-name">{{ skill.displayName }}</span>
                  <div class="mono slug-cell">/{{ skill.slug }}</div>
                </td>
                <td><div class="summary-cell">{{ skill.summary || "-" }}</div></td>
                <td class="mono center-cell">{{ skill.latestVersion?.version ?? "-" }}</td>
                <td class="center-cell">{{ skill.stats?.downloads ?? 0 }}</td>
                <td class="nowrap-cell">{{ relativeTime(skill.updatedAt) }}</td>
                <td class="action-cell" @click.stop>
                  <a
                    class="btn ghost sm"
                    :href="`/api/v1/download?slug=${encodeURIComponent(skill.slug)}`"
                  >
                    下载
                  </a>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <Pagination
      :page="page"
      :page-size="pageSize"
      :total="skillsStore.total"
      @update:page="page = $event"
      @update:page-size="pageSize = $event"
    />
  </main>
</template>
