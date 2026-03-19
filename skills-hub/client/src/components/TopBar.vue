<script setup lang="ts">
import { useRouter, useRoute } from "vue-router";
import { useAuthStore } from "@/stores/auth";

defineEmits<{ "open-login": [] }>();

const router = useRouter();
const route = useRoute();
const auth = useAuthStore();

function isActive(name: string): boolean {
  return route.name === name;
}

async function handleLogout() {
  await auth.logout();
  router.push("/");
}
</script>

<template>
  <header class="topbar">
    <div class="topbar-left">
      <router-link to="/" class="brand">
        <span class="logo">C</span>
        <span>ClawHub</span>
      </router-link>
      <nav class="nav">
        <router-link to="/" :class="{ active: isActive('skills') }">技能</router-link>
        <router-link v-if="auth.isAuthenticated" to="/upload" :class="{ active: isActive('upload') }">
          上传
        </router-link>
        <router-link
          v-if="auth.isAdmin"
          to="/admin/reviews"
          :class="{ active: isActive('reviews') || isActive('review-detail') }"
        >
          审核
        </router-link>
        <router-link v-if="auth.isAdmin" to="/admin/users" :class="{ active: isActive('users') }">
          用户
        </router-link>
      </nav>
    </div>
    <div class="authBox">
      <template v-if="auth.isAuthenticated">
        <span class="authName">{{ auth.user?.username }}</span>
        <button class="btn ghost sm" @click="handleLogout">退出</button>
      </template>
      <template v-else>
        <button class="btn brand sm" @click="$emit('open-login')">登录</button>
      </template>
    </div>
  </header>
</template>
