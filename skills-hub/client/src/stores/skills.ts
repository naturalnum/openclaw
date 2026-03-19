import type { AdminSkillItem } from "@shared/types/api";
import { defineStore } from "pinia";
import { ref } from "vue";
import { skillsApi } from "@/api/client";

export const useSkillsStore = defineStore("skills", () => {
  const items = ref<AdminSkillItem[]>([]);
  const total = ref(0);
  const loading = ref(false);

  async function fetchPage(params: { page: number; pageSize: number; sort: string; q: string }) {
    loading.value = true;
    try {
      const res = await skillsApi.list(params);
      items.value = res.items;
      total.value = res.total;
    } catch {
      items.value = [];
      total.value = 0;
    } finally {
      loading.value = false;
    }
  }

  return { items, total, loading, fetchPage };
});
