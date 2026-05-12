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
/askdb date
/askdb search <keywords>
/askdb context <keywords>
/askdb describe <schema.table>
/askdb sql SELECT ...
/askdb count <table>
/askdb <natural language prompt>   # demo templates only (tasks/projects)
```

## Suggested workflow

1. `/askdb` — connector summary + first table row counts.
2. `/askdb date` — anchor “today / rolling 7d / ISO week” on the **database server** clock (fixes “昨天/上周” mistakes).
3. `/askdb search <topic>` — rank imported tables by name (shortlist ~20).
4. `/askdb context <topic>` — top 5 tables with **columns** from `information_schema` (lightweight “data dictionary” from the DB).
5. `/askdb describe schema.table` — full column list for one table.
6. `/askdb sql SELECT ...` — single read-only statement after you know the grain.
7. `/askdb count <table>` — quick row count sanity check.
8. Demo NL (`/askdb 近7天…`) only applies when those demo tables exist.

## Prompt templates

- `/askdb date`
- `/askdb search 订单`
- `/askdb context 订单`
- `/askdb sql select current_date`
- `/askdb 近7天完成任务数`
- `/askdb 近7天任务趋势`
- `/askdb 项目任务排行`
- `/askdb count users`

## Response style

- Keep output short and decision-oriented.
- Include concrete numbers first.
- Mention query limitations when the question cannot be mapped safely.
