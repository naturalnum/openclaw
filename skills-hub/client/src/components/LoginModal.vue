<script setup lang="ts">
import { ref, watch } from "vue";
import { useAuthStore } from "@/stores/auth";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ "update:visible": [value: boolean] }>();

const auth = useAuthStore();

const mode = ref<"login" | "register">("login");
const username = ref("");
const password = ref("");
const passwordConfirm = ref("");
const error = ref("");
const submitting = ref(false);

watch(
  () => props.visible,
  (v) => {
    if (v) {
      mode.value = "login";
      username.value = "";
      password.value = "";
      passwordConfirm.value = "";
      error.value = "";
    }
  },
);

function close() {
  emit("update:visible", false);
}

async function handleSubmit() {
  error.value = "";
  const u = username.value.trim();
  const p = password.value;

  if (!u || !p) {
    error.value = "请输入用户名和密码";
    return;
  }

  if (mode.value === "register" && p !== passwordConfirm.value) {
    error.value = "两次输入的密码不一致";
    return;
  }

  submitting.value = true;
  try {
    if (mode.value === "login") {
      await auth.login(u, p);
    } else {
      await auth.register(u, p);
    }
    close();
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="modal" :class="{ open: visible }" @click.self="close">
    <div class="modal-card">
      <div class="modal-head">
        <h3>{{ mode === "login" ? "登录" : "注册" }}</h3>
        <button class="btn ghost sm" @click="close">取消</button>
      </div>

      <form @submit.prevent="handleSubmit">
        <div>
          <label>用户名</label>
          <input v-model="username" class="input" placeholder="请输入用户名" />
        </div>
        <div style="margin-top: 12px">
          <label>密码</label>
          <input v-model="password" class="input" type="password" placeholder="请输入密码" />
        </div>
        <div v-if="mode === 'register'" style="margin-top: 12px">
          <label>确认密码</label>
          <input v-model="passwordConfirm" class="input" type="password" placeholder="再次输入密码" />
        </div>
        <div v-if="error" class="errorText show">{{ error }}</div>
        <div class="modal-actions">
          <button
            type="button"
            class="btn ghost"
            @click="mode = mode === 'login' ? 'register' : 'login'"
          >
            {{ mode === "login" ? "注册新账户" : "返回登录" }}
          </button>
          <button type="submit" class="btn brand" :disabled="submitting">
            {{ submitting ? "处理中..." : mode === "login" ? "登录" : "注册" }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
