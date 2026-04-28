---
name: askdb-analytics
description: Answer database analytics questions through the built-in /askdb command and PostgreSQL connectors.
command-dispatch: tool
command-tool: askdb_query
command-arg-mode: raw
disable-model-invocation: true
metadata: { "openclaw": { "emoji": "📊" } }
---

# AskDB Analytics

Use this skill when the user wants data stats, table counts, or trend summaries from a configured PostgreSQL connector.

## Trigger phrases

- "ask database"
- "query stats from DB"
- "how many rows"
- "near 7 days trend"
- "database analytics"
- "智能问数"
- "数据库统计"
- "查库"

## Preconditions

Before running analytics, ensure:

1. At least one PostgreSQL connector exists and is enabled.
2. The database connection test succeeds.

If these are not true, ask the user to configure Connectors first.

## Primary command interface

Prefer these commands in this order:

```text
/askdb
/askdb schema
/askdb count <table>
/askdb <natural language prompt>
```

## Suggested workflow

1. Start with `/askdb` for high-level summary.
2. If schema is unclear, run `/askdb schema`.
3. For concrete table metrics, run `/askdb count <table>`.
4. For natural-language analytics, use `/askdb <question>`.
5. Return concise findings, then suggest one or two follow-up queries.

## Prompt templates

- `/askdb 近7天完成任务数`
- `/askdb 近7天任务趋势`
- `/askdb 项目任务排行`
- `/askdb count users`

## Response style

- Keep output short and decision-oriented.
- Include concrete numbers first.
- Mention query limitations when the question cannot be mapped safely.
