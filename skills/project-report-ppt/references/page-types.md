# 第二代页型说明

这份说明配合 [page-schema.json](/Users/star/code/myskills/project-report-ppt/references/page-schema.json) 使用，目标是把“模板页长什么样”和“动态内容该怎么落进去”拆开。

## 设计原则

- 固定模板页只保留模板语义，不参与正文改写。
- 动态页先落结构化内容，再做短话术改写。
- 图示页的小框文字和正文页的浅蓝底板正文，属于两种不同渲染约束，不能再用一套替换逻辑。

## 核心页型

- `background-body`
  - 适用页：3-4
  - 作用：长段背景说明，正文必须完整落在浅蓝背景框内
  - 动态内容：`body_summary`

- `problem-structure`
  - 适用页：5
  - 作用：三栏问题与目标卡片
  - 动态内容：`problem_cards`、`goal_cards`

- `project-info-table`
  - 适用页：6
  - 作用：项目信息表 + 课题设置表
  - 动态内容：`project_meta`、`task_table`

- `responsibility-page`
  - 适用页：7
  - 作用：牵头单位、负责人、顾问、课题负责人
  - 动态内容：`lead_org`、`project_owner`、`consultants`、`task_owners`

- `timeline-page`
  - 适用页：9
  - 作用：关键事件节点时间轴
  - 动态内容：`milestones`

- `task-subtitle-page`
  - 适用页：18、25、31、38
  - 作用：进入课题簇时给出单独课题副标题
  - 动态内容：`task_title`
  - 约束：副标题单行优先，允许短化

- `task-research-page`
  - 适用页：课题页簇主体
  - 作用：研究内容横条 + 正文底板 + 下方技术路线或验证区
  - 动态内容：`task_title`、`research_item_title`、`body_summary`、`diagram_labels`
  - 约束：
    - 研究内容横条优先短化，不要依赖缩字
    - 正文必须完整待在浅蓝背景框内
    - 下方图示标签和正文使用不同缩写策略

- `task-route-page`
  - 适用页：18、25、31、38
  - 作用：课题整体路线概览页
  - 动态内容：`task_title`、`route_title`、`route_summary`、`route_labels`
  - 约束：
    - 优先使用通用短标签生成，不够时再用页级 override
    - `route_labels` 必须是短标签，不允许直接塞长句

- `indicator-table-page`
  - 适用页：50
  - 作用：总指标完成情况
  - 动态内容：`indicator_rows`

- `deliverable-table-page`
  - 适用页：51-52
  - 作用：论文、专利、软著、报告等成果表
  - 动态内容：`deliverable_rows`
  - 约束：任务书没有明细时，用待补充或模糊化表达，不写死

- `innovation-summary-page`
  - 适用页：53-55
  - 作用：创新点总结
  - 动态内容：`innovation_title`、`innovation_summary`、`supporting_results`、`innovation_labels`

## 新链路

1. 先抽取任务书，生成结构化内容 JSON。
2. 再按 `page-schema.json` 生成 slide manifest。
3. 最后由渲染层把 manifest 映射到模板里的具体 shape。

这会比“直接 patch PPT XML 文本节点”稳得多，因为内容层、页型层、渲染层终于拆开了。
