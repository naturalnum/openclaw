<script setup lang="ts">
import { ref } from "vue";
import { skillsApi } from "@/api/client";
import type { UploadResponse } from "@shared/types/api";

const file = ref<File | null>(null);
const version = ref("");
const uploading = ref(false);
const error = ref("");
const result = ref<UploadResponse | null>(null);
const progress = ref(0);

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function handleUpload() {
  error.value = "";
  result.value = null;

  if (!file.value) {
    error.value = "请选择文件";
    return;
  }

  uploading.value = true;
  progress.value = 10;

  try {
    progress.value = 40;
    const res = await skillsApi.upload(file.value, version.value.trim());
    progress.value = 100;
    result.value = res;
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="upload-page">
    <div class="upload-card">
      <!-- Header -->
      <div class="upload-header">
        <div class="upload-icon">↑</div>
        <div>
          <h2 class="upload-title">上传技能包</h2>
          <p class="upload-desc">支持 .zip 或 .tar.gz 格式，上传后系统将自动进行安全审核。</p>
        </div>
      </div>

      <!-- Form -->
      <div class="upload-form">
        <div class="upload-field">
          <label class="upload-label">技能包文件 <span class="req">*</span></label>
          <input class="input" type="file" accept=".zip,.tar,.tar.gz,.tgz" @change="onFileChange" />
          <span class="field-hint">支持 .zip / .tar.gz / .tgz</span>
        </div>

        <div class="upload-field">
          <label class="upload-label">版本号 <span class="req">*</span></label>
          <input v-model="version" class="input" placeholder="例如: 1.0.0" />
        </div>

        <!-- Progress -->
        <div v-if="uploading" class="progress-bar">
          <div class="progress-fill" :style="{ width: progress + '%' }"></div>
          <div class="progress-text">{{ progress }}%</div>
        </div>

        <!-- Error -->
        <div v-if="error" class="upload-banner error">
          <span class="banner-icon">✕</span>{{ error }}
        </div>

        <button
          class="btn brand upload-submit"
          :disabled="uploading || !file || !version.trim()"
          @click="handleUpload"
        >
          {{ uploading ? "上传中..." : "上传" }}
        </button>
      </div>

      <!-- Result -->
      <div v-if="result" class="upload-result" :class="result.ok ? 'ok' : 'fail'">
        <div class="result-header">
          <span class="result-icon">{{ result.ok ? "✓" : "✕" }}</span>
          <strong>{{ result.ok ? "上传成功" : "上传失败" }}</strong>
        </div>
        <template v-if="result.ok">
          <div class="result-row"><span>技能</span><span class="mono">{{ result.skillName ?? result.slug }}</span></div>
          <div class="result-row"><span>版本</span><span class="mono">{{ result.version }}</span></div>
          <div class="result-row"><span>审核状态</span><span class="mono">{{ result.reviewStatus }}</span></div>
        </template>
        <template v-else>
          <div class="result-row"><span>原因</span><span>{{ result.error }}</span></div>
          <div class="result-row"><span>审核状态</span><span class="mono">{{ result.reviewStatus }}</span></div>
        </template>
        <pre v-if="result.checkResults" class="result-pre">{{ JSON.stringify(result.checkResults, null, 2) }}</pre>
      </div>
    </div>
  </div>
</template>
