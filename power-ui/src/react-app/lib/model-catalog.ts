/** 与网关会话 `model` 字段对齐的目录项 ref（`provider/modelId`） */
export function formatCatalogModelRef(m: { provider: string; id: string }): string {
  const p = (m.provider ?? "").trim();
  const i = (m.id ?? "").trim();
  if (!i) {
    return "";
  }
  return p ? `${p}/${i}` : i;
}
