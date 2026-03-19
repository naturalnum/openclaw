import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { authApi } from "@/api/client";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<{ id: number; username: string; role: string } | null>(null);
  const loading = ref(false);

  const isAuthenticated = computed(() => user.value !== null);
  const isAdmin = computed(() => user.value?.role === "admin");

  async function fetchSession() {
    loading.value = true;
    try {
      const payload = await authApi.session();
      user.value = payload.user;
    } catch {
      user.value = null;
    } finally {
      loading.value = false;
    }
  }

  async function login(username: string, password: string) {
    const res = await authApi.login({ username, password });
    user.value = res.auth.user;
  }

  async function register(username: string, password: string) {
    const res = await authApi.register({ username, password });
    user.value = res.auth.user;
  }

  async function logout() {
    await authApi.logout();
    user.value = null;
  }

  return { user, loading, isAuthenticated, isAdmin, fetchSession, login, register, logout };
});
