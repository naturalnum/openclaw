# AskDB Retrieve Dictionary Guide

这个文件说明如何维护 `retrieve-dictionary.json`，让智能问数在自然语言提问时更稳定命中业务口径。

## 文件位置

- `skills/askdb-analytics/retrieve-dictionary.json`

## 基本结构

词典包含 5 个分类：

- `unit`: 单位/组织映射（例如总部、分公司）
- `award`: 奖项映射
- `domain`: 领域映射（例如人工智能、新能源）
- `term`: 术语映射（补充选表/选字段关键词）
- `example`: 预留示例映射

每条记录格式：

```json
{ "key": "用户提问里可能出现的词", "content": "标准映射内容" }
```

## 维护规则

- `key` 写用户常说法，尽量短、可直接命中。
- `content` 写标准词或扩展检索词（可用空格分隔多个词）。
- 避免重复 `key`；同义词用多条记录表达。
- 不要写带引号的 SQL 片段；这里只做语义映射，不直接存 SQL。
- 改完后建议跑一次 AskDB 相关测试：
  - `pnpm test src/connectors/askdb-command-core.test.ts`

## 示例

```json
{
  "unit": [
    { "key": "公司总部", "content": "总部" }
  ],
  "domain": [
    { "key": "AI", "content": "人工智能,AI" }
  ],
  "term": [
    { "key": "项目金额", "content": "project amount total_amount payment_amount gmv" }
  ]
}
```

## 常见问题

- 映射没生效？
  - 先确认 `key` 是否是提问中的连续文本。
  - 确认 JSON 格式合法（逗号、引号）。
  - 重启相关服务/进程后再测（避免进程级缓存未刷新）。
