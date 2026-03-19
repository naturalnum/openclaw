<script setup lang="ts">
import { ref } from "vue";
import TopBar from "@/components/TopBar.vue";
import LoginModal from "@/components/LoginModal.vue";

const showLogin = ref(false);
</script>

<template>
  <TopBar @open-login="showLogin = true" />
  <router-view />
  <LoginModal v-model:visible="showLogin" />
</template>
