<script setup lang="ts">
import { ref, onMounted } from "vue";
import { usersApi } from "@/api/client";
import { formatTime } from "@/composables/useTimeFormat";
import type { UserListItem } from "@shared/types/api";

const loading = ref(true);
const users = ref<UserListItem[]>([]);
const operating = ref<number | null>(null);

onMounted(async () => {
  await fetchUsers();
});

async function fetchUsers() {
  loading.value = true;
  try {
    const res = await usersApi.list();
    users.value = res.users;
  } catch {
    // ignore
  } finally {
    loading.value = false;
  }
}

async function toggleStatus(user: UserListItem) {
  operating.value = user.id;
  try {
    if (user.status === "active") {
      await usersApi.disable(user.id);
    } else {
      await usersApi.enable(user.id);
    }
    await fetchUsers();
  } catch {
    // ignore
  } finally {
    operating.value = null;
  }
}

async function removeUser(user: UserListItem) {
  if (!confirm(`确定要删除用户 "${user.username}" 吗？此操作不可撤销。`)) return;
  operating.value = user.id;
  try {
    await usersApi.remove(user.id);
    await fetchUsers();
  } catch {
    // ignore
  } finally {
    operating.value = null;
  }
}
</script>

<template>
  <section class="detail">
    <h2>用户管理</h2>

    <div v-if="loading" class="loading">加载中...</div>
    <div v-else-if="users.length === 0" class="empty">暂无用户。</div>
    <div v-else class="tableWrap" style="display: block; margin-top: 12px">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>用户名</th>
            <th>角色</th>
            <th>状态</th>
            <th>注册时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="u in users" :key="u.id">
            <td>{{ u.id }}</td>
            <td>
              <strong>{{ u.username }}</strong>
            </td>
            <td>
              <span class="chip">{{ u.role }}</span>
            </td>
            <td>
              <span
                class="chip"
                :class="u.status === 'active' ? 'chip-approved' : 'chip-rejected'"
                style="font-size: 11px"
              >
                {{ u.status === "active" ? "正常" : "已禁用" }}
              </span>
            </td>
            <td>{{ formatTime(u.createdAt) }}</td>
            <td style="display: flex; gap: 4px">
              <button
                class="btn ghost sm"
                :disabled="operating === u.id"
                @click="toggleStatus(u)"
              >
                {{ u.status === "active" ? "禁用" : "启用" }}
              </button>
              <button
                class="btn ghost sm"
                :disabled="operating === u.id"
                style="color: #b33a22"
                @click="removeUser(u)"
              >
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
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
</style>
