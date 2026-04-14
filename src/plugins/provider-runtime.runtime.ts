import * as providerRuntime from "./provider-runtime.js";

type ProviderRuntimeModule = typeof import("./provider-runtime.js");

type AugmentModelCatalogWithProviderPlugins =
  ProviderRuntimeModule["augmentModelCatalogWithProviderPlugins"];
type BuildProviderAuthDoctorHintWithPlugin =
  ProviderRuntimeModule["buildProviderAuthDoctorHintWithPlugin"];
type BuildProviderMissingAuthMessageWithPlugin =
  ProviderRuntimeModule["buildProviderMissingAuthMessageWithPlugin"];
type FormatProviderAuthProfileApiKeyWithPlugin =
  ProviderRuntimeModule["formatProviderAuthProfileApiKeyWithPlugin"];
type PrepareProviderRuntimeAuth = ProviderRuntimeModule["prepareProviderRuntimeAuth"];
type RefreshProviderOAuthCredentialWithPlugin =
  ProviderRuntimeModule["refreshProviderOAuthCredentialWithPlugin"];

export async function augmentModelCatalogWithProviderPlugins(
  ...args: Parameters<AugmentModelCatalogWithProviderPlugins>
): Promise<Awaited<ReturnType<AugmentModelCatalogWithProviderPlugins>>> {
  return providerRuntime.augmentModelCatalogWithProviderPlugins(...args);
}

export async function buildProviderAuthDoctorHintWithPlugin(
  ...args: Parameters<BuildProviderAuthDoctorHintWithPlugin>
): Promise<Awaited<ReturnType<BuildProviderAuthDoctorHintWithPlugin>>> {
  return providerRuntime.buildProviderAuthDoctorHintWithPlugin(...args);
}

export async function buildProviderMissingAuthMessageWithPlugin(
  ...args: Parameters<BuildProviderMissingAuthMessageWithPlugin>
): Promise<Awaited<ReturnType<BuildProviderMissingAuthMessageWithPlugin>>> {
  return providerRuntime.buildProviderMissingAuthMessageWithPlugin(...args);
}

export async function formatProviderAuthProfileApiKeyWithPlugin(
  ...args: Parameters<FormatProviderAuthProfileApiKeyWithPlugin>
): Promise<Awaited<ReturnType<FormatProviderAuthProfileApiKeyWithPlugin>>> {
  return providerRuntime.formatProviderAuthProfileApiKeyWithPlugin(...args);
}

export async function prepareProviderRuntimeAuth(
  ...args: Parameters<PrepareProviderRuntimeAuth>
): Promise<Awaited<ReturnType<PrepareProviderRuntimeAuth>>> {
  return providerRuntime.prepareProviderRuntimeAuth(...args);
}

export async function refreshProviderOAuthCredentialWithPlugin(
  ...args: Parameters<RefreshProviderOAuthCredentialWithPlugin>
): Promise<Awaited<ReturnType<RefreshProviderOAuthCredentialWithPlugin>>> {
  return providerRuntime.refreshProviderOAuthCredentialWithPlugin(...args);
}
