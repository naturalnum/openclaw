#!/usr/bin/env python3
"""Build a page manifest that maps structured content into template page types."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
from typing import Any


TASK_PAGE_PLANS: dict[int, dict[int, dict[str, str]]] = {
    2: {
        30: {
            "research_item_title": "风险主动发现与溯因",
            "body_summary": "项目围绕线路故障、主变停电和母线检修等场景开展风险发现与溯因验证，形成不少于3类风险研判能力的技术基础。",
        },
    },
    4: {
        44: {
            "research_item_title": "风险辨识验证",
            "body_summary": "项目在典型检修场景下开展运行风险辨识验证，重点评估识别准确率、校核可信性和业务辅助支撑效果。",
        },
        45: {
            "research_item_title": "预案生成验证",
            "body_summary": "项目围绕检修计划与运行方式预案生成开展场景验证，检验多目标编排、校核约束和方案输出能力。",
        },
        46: {
            "research_item_title": "薄弱环节分析验证",
            "body_summary": "项目围绕薄弱断面、关键设备和高风险环节开展分析验证，提升检修计划执行前的风险识别与提前干预能力。",
        },
        47: {
            "research_item_title": "编制优化验证",
            "body_summary": "项目在典型业务流程中验证编制优化能力，检验方案推荐结果对人工编排效率和一致性的提升效果。",
        },
        48: {
            "research_item_title": "PMS闭环验证",
            "body_summary": "项目将模块与PMS等业务系统开展闭环验证，打通计划解析、校核、预案生成和结果回传流程。",
        },
        49: {
            "task_title": "智能校核与编制优化模块开发及试点应用验证",
            "research_item_title": "开展4类典型场景试点验证",
            "body_summary": "随机故障处置预案组件面向线路短路、设备跳闸和新能源波动场景。支撑故障定位、路径推荐和恢复方案输出。",
        },
    },
}

TASK_PAGE_SPECIAL_OVERRIDE_SLIDES = {30, 44, 45, 46, 47, 48, 49}
VISUAL_GUIDANCE_OVERRIDE_SLIDES = {41, 43, 44, 45, 46, 47, 48, 49}

TASK_RESEARCH_LABEL_OVERRIDES = {
    20: [
        "负荷预测场景数据需求",
        "设备用户光伏电价",
        "台账类数据",
        "日冻结曲线",
        "电流电压功率负荷",
        "系统/区域负荷数据集",
        "用户集群负荷预测数据集",
        "净负荷预测数据集",
        "其他",
        "GIS气象温度",
        "数据接入",
        "数据抽取",
        "数据存储",
        "数据集生成",
        "服务协同关系",
        "数据协同关系",
    ],
    22: [
        "数据知识融合引擎",
        "动态协调编排框架",
    ],
    23: [
        "检修计划报送",
        "运行方式调整",
        "计划编排约束建模",
        "多时间尺度协同机制",
        "先验知识融合技术",
        "设备状态数据",
        "拓扑结构约束",
        "检修作业资源",
        "历史方案样本",
        "知识增强编排引擎",
        "专家规则提取",
        "输出联合建模",
        "知识编码",
        "约束映射",
        "动态协调编排",
        "计划与方式联合求解",
        "知识表示学习",
        "风险校核先验",
        "知识图谱推理",
        "数据知识增强架构",
        "分层协同训练",
        "检修运行方式动态校核",
    ],
    24: [
        "联合建模目标",
        "知识表征目标",
        "增强架构目标",
    ],
    26: [
        "量纲统一模块",
        "数据清洗模块",
        "数据归一化模块",
        "数据采样模块",
        "数据插值模块",
        "四分位法去除异常值",
        "缺失值填充",
        "Min-Max归一化",
        "Z-score标准化",
        "线性插值",
        "样条插值",
    ],
    27: [
        "多粒度风险特征",
        "检修安排数据",
        "状态与拓扑特征",
        "风险等级预测模型",
        "风险标签样本",
        "运行规则知识",
        "等级预测结果",
        "面向风险等级预测的时空学习框架",
        "计划-风险联合评估",
        "规则约束",
        "知识校验",
    ],
    28: [
        "主动发现线索",
        "设备状态异常 / 作业冲突异常",
        "溯因分析流程",
        "联合校验机理",
        "数据证据聚合 / 规则比对 / 根因定位",
        "规则冲突消解",
        "数据异常检测",
        "知识逻辑校验",
        "风险根因定位",
    ],
    29: [
        "风险知识图谱构建",
        "主动发现与溯因链路",
    ],
    30: [
        "典型风险主动发现结果",
        "不同场景下风险等级预测与溯因对比",
        "风险主动发现与根因定位示例",
    ],
    32: [
        "特征扩散",
        "预提取",
        "精提取",
        "特征",
        "模型",
        "数据集划分",
        "SGD",
        "Adam",
        "RMSprop",
        "Adagrad",
        "训练算法选取",
        "特征自动选取",
        "结构自动构建",
        "训练参数自动更新",
        "XGBoost 1",
        "XGBoost n",
        "Timer",
        "基模型组合方案",
        "结构集成权重",
        "短期",
        "中长期",
        "超短期",
        "光伏",
        "负荷",
        "风电",
        "规则库",
        "MLP",
        "历史精度校验",
    ],
    33: [
        "候选方案生成结果",
        "不同策略下预案质量对比",
        "自动构建约束集",
        "趋优训练后安全校核通过率提升",
        "不同方案生成效率对比",
    ],
    34: [
        "反馈样本构建",
        "初始策略",
        "偏好对齐",
        "策略修正",
        "趋优训练",
        "结果评估",
        "规则反馈：运行校核意见",
        "风险反馈：风险等级修正",
        "效果反馈：执行结果回流",
    ],
    36: [
        "反馈特征优化",
        "偏好参数校准",
        "策略结构优化",
        "反馈学习理论",
        "输入反馈层",
        "策略训练层",
        "结果输出层",
    ],
    37: [
        "局部反馈分析示意",
        "反馈特征时序变化",
        "多因素反馈摘要",
        "全局知识重要性排序",
        "超短期方案更新前后对比",
        "短期方案更新前后对比",
        "中长期方案更新前后对比",
    ],
    35: [
        "反馈样本分布",
        "训练前后通过率对比",
        "偏好对齐收敛过程",
        "策略修正迭代过程",
        "多场景生成效果对比",
    ],
    40: [
        "关系数据建模",
        "非关系数据建模",
        "BiGRU-CRF",
        "向量嵌入",
        "关系模型",
        "融合数据",
        "节点转换",
        "边转换",
        "属性转换",
        "数模解析",
        "实体1",
        "实体2",
        "实体3",
        "实体n",
        "...",
        "关系1",
        "关系2",
        "关系3",
        "关系n",
        "...",
        "实体1",
        "实体2",
        "实体3",
        "实体n",
        "...",
        "关系1",
        "关系2",
        "关系3",
        "关系n",
        "...",
        "实体集",
        "实体集",
        "关系集",
        "关系集",
        "图表示学习",
        "Skip-gram",
        "业务子图",
        "建立链接的实体",
        "图模型本体关系抽取",
        "图实体链接识别",
        "同义实体消歧",
    ],
    44: [
        "网架数据",
        "主网网架/馈线图模数据",
        "断面数据",
        "QS文件与DT文件",
        "知识类数据",
        "调度规程与事故预案",
        "图形类数据",
        "潮流图与站内接线图",
    ],
    48: [
        "指标测试：荷转供策略的正确操作步骤和路径正确率大于90%",
    ],
    41: [
        "智能校核功能页面",
        "阶段成果：形成智能校核与编制优化模块原型",
    ],
    42: [
        "系统部署总体流程",
        "集成部署环境",
        "集成运维管理",
        "环境初始化",
        "节点管理配置",
        "网络参数配置",
        "资源标签配置",
        "资源配额",
        "资源编排",
        "服务仓库",
        "版本管理",
        "服务镜像",
        "构建发布",
        "发布管理",
        "引入部署模板",
        "增强灰度发布",
        "模块资源管理",
        "状态服务",
        "应用部署",
        "配置管理",
        "密钥管理",
        "业务用户",
        "业务页面",
        "接口服务",
        "系统节点",
        "阶段成果：形成模块集成与部署方案",
    ],
    43: [
        "模型训练与优化页面",
    ],
    45: [
        "典型场景量测与校核位置",
        "考核目标：千节点规模配网风险辨识准确率高于90%",
    ],
    46: [
        "阶段目标：验证预案自动生成与风险提示能力",
    ],
    47: [
        "考核目标：典型风险场景辨识与辅助分析",
    ],
    49: [
        "考核目标：与PMS等相关系统完成集成应用验证",
    ],
}

TASK_ROUTE_PAGE_OVERRIDES = {
    1: {
        "route_title": "内容1：联合建模、表征与增强架构",
        "route_summary": "课题1围绕联合建模、先验知识表征和数据知识增强架构，形成动态协调编排基础技术链路。",
        "route_labels": [
            "关键任务1：计划编排与方式调整联合建模",
            "知识约束",
            "联合建模",
            "策略优化",
            "增强架构",
            "多时间尺度计划",
            "反馈修正",
            "运行方式调整",
            "知识更新",
            "先验知识提取",
            "规则表征",
            "人机协同架构",
            "多电压等级",
            "检修编排架构",
            "知识类型",
            "业务数据与规则基础",
            "作业约束",
            "多源数据协同",
            "业务应用服务层",
            "融合增强框架",
            "知识中台",
            "业务协同关系",
            "规则中台",
            "接口集成",
            "随机故障预案验证",
            "计划报送",
            "推理服务层",
            "知识管理层",
            "数据采集层",
            "模型训练层",
            "业务资源接入层",
            "整体能力支撑",
            "研究内容3：人机数据知识融合增强架构",
            "方法基础",
            "计划-方式耦合关系",
            "先验知识建模",
            "架构增强设计",
            "动态协调编排",
        ],
    },
    2: {
        "route_title": "研究内容1：建模、预测与溯因分析",
        "route_summary": "课题2围绕安全约束建模、风险等级预测和主动发现溯因展开研究，形成配网检修风险识别与解释的完整方法链路。",
        "route_labels": [
            "研究内容1：安全约束建模方法",
            "设备边界约束",
            "检修时序约束",
            "运行规则约束",
            "研究内容2：风险等级预测技术",
            "多粒度时空特征",
            "风险等级学习模型",
            "知识校验约束",
            "服务支撑",
            "研究内容3：风险主动发现与溯因",
            "风险线索发现",
            "状态估计支撑",
            "薄弱环节分析",
            "供电路径搜索",
        ],
    },
    3: {
        "route_title": "内容1：生成、反馈与知识更新",
        "route_summary": "课题3形成预案生成、反馈学习和知识更新闭环机制。",
        "route_labels": [
            "反馈基础",
            "多目标计划编排",
            "预案生成智能体",
            "专家评价反馈",
            "多场景预案生成",
            "内容2：智能体自主趋优训练技术",
            "偏好对齐训练机制",
            "反馈样本构建",
            "策略修正机制",
            "自主趋优训练",
            "知识基础",
            "内容3：知识库自学习更新方法",
            "知识采集层",
            "冲突消解机制",
            "知识增量更新方法",
            "闭环优化机制",
            "知识推理层",
            "应用反馈层",
        ],
    },
    4: {
        "route_title": "内容1：模块设计、集成与试点验证",
        "route_summary": "课题4围绕模块原型设计、架构集成和试点验证展开研究，支撑智能校核与编制优化能力在业务场景落地。",
        "route_labels": [
            "数据知识支撑",
            "多源数据接入与治理",
            "统一校核数据模型",
            "业务规则与知识融合",
            "内容2：模块架构与集成方案",
            "智能校核服务",
            "预案生成与优化",
            "模块服务化封装",
            "模块系统支撑",
            "内容3：开展地区电网试点应用验证",
            "检修风险辨识",
            "运行方式校核",
            "预案编制优化",
            "PMS集成联调",
        ],
    },
}

INNOVATION_TITLE_OVERRIDES = {
    1: "设计人机协同数据知识增强架构，明确协同关系",
}

INNOVATION_SLIDE_OVERRIDES = {
    53: {
        "innovation_number": 2,
        "innovation_title": "融合安全约束建模、风险等级预测与溯因分析",
        "innovation_summary": "项目形成融合安全约束建模、风险等级预测和溯因分析的主动风险发现方法链路。",
        "supporting_results": ["代表性成果：论文《配网检修风险主动发现与溯因分析方法》"],
    },
    54: {
        "innovation_number": 2,
        "innovation_title": "融合安全约束建模、风险等级预测与溯因分析",
        "innovation_summary": "面向配网检修计划报送、校核与方式编排场景，项目融合设备状态、检修时序、运行边界和作业冲突等多源信息，构建安全约束建模、风险等级预测与溯因分析一体化方法链，实现检修方案风险预警、根因定位与校核支撑。代表性成果：形成配网检修风险主动发现与溯因分析方法，支撑课题2技术报告。",
        "supporting_results": ["代表性成果：形成配网检修风险主动发现与溯因分析方法，支撑课题2技术报告。"],
    },
}

INNOVATION_SUMMARY_OVERRIDES = {
    1: "项目提出人机协同数据知识增强架构，统一数据接入、知识管理与推理服务。",
    2: "项目形成了融合安全约束建模、风险等级预测和溯因分析的主动风险发现方法链路。",
    3: "项目形成了覆盖预案生成、反馈学习和知识更新的闭环优化机制，支撑结果持续趋优。",
}

INNOVATION_SUPPORT_OVERRIDES = {
    1: ["阶段性形成联合建模、知识表征和架构设计成果。", "支撑课题1技术报告等阶段成果。"],
    2: ["形成风险研判与溯因分析方法基础。", "支撑课题2技术报告等阶段成果。"],
    3: ["形成反馈训练与知识更新闭环机制。", "支撑课题3技术报告等阶段成果。"],
}

INNOVATION_LABEL_OVERRIDES = {
    53: [
        "面向配网检修运行方式的人机协同数据知识增强架构",
        "支撑成果：课题1技术报告等阶段性成果",
    ],
    54: [
        "先验知识内嵌机器学习",
        "计划数据",
        "知识数据",
        "风险主动发现与溯因",
        "规则约束+数据驱动",
        "专家反馈趋优学习",
        "知识库基础",
        "校核推理框架",
        "预案生成",
        "知识更新",
    ],
    55: [
        "反馈样本构建",
        "专家评价输入",
        "结果校核反馈",
        "偏好对齐训练",
        "策略持续优化",
        "知识增量更新",
        "知识冲突消解",
        "更新结果用于优化模型",
        "反馈结果用于持续优化",
        "基于反馈的智能体趋优训练",
        "高",
        "低",
        "结果解释与更新依据",
        "基于反馈的知识更新闭环",
    ],
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build slide manifest from page schema and content JSON.")
    parser.add_argument("--schema", required=True, help="Path to page-schema.json")
    parser.add_argument("--content", required=True, help="Path to extracted content JSON")
    parser.add_argument("--output", required=True, help="Output manifest JSON")
    return parser.parse_args()


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8"))


def get_task(content: dict[str, Any], task_number: int) -> dict[str, Any]:
    for task in content.get("tasks", []):
        if task.get("task_number") == task_number:
            return task
    return {}


def first_sentence(text: str) -> str:
    normalized = " ".join((text or "").split())
    if not normalized:
        return ""
    parts = [part for part in re.split(r"[。；;]", normalized) if part.strip()]
    return parts[0].strip() if parts else normalized


def compact_join(items: list[str], limit: int = 3) -> str:
    cleaned = [" ".join((item or "").split()) for item in items if " ".join((item or "").split())]
    return "、".join(cleaned[:limit])


def shorten_label(text: str, limit: int = 20) -> str:
    normalized = " ".join((text or "").split())
    normalized = re.sub(r"^[：:;；、，。\-\s]+", "", normalized)
    replacements = [
        ("提出", ""),
        ("形成", ""),
        ("项目", ""),
        ("研究", ""),
        ("技术", ""),
        ("方法", ""),
        ("能力", ""),
    ]
    for src, dst in replacements:
        normalized = normalized.replace(src, dst)
    normalized = re.sub(r"[；;].*$", "", normalized)
    normalized = re.sub(r"[。].*$", "", normalized)
    normalized = normalized.strip("：:、，。；; ")
    return normalized[:limit] if len(normalized) > limit else normalized


def normalize_summary_phrase(text: str, limit: int = 24) -> str:
    normalized = first_sentence(text)
    normalized = re.sub(r"^(项目围绕|项目面向|围绕|面向|针对|聚焦|开展)", "", normalized)
    normalized = re.sub(r"(关键技术研究|关键技术|技术研究|研究任务|研究内容)$", "", normalized)
    normalized = normalized.strip("：:、，。；; ")
    return shorten_label(normalized, limit)


def merge_summary_sentences(parts: list[str], limit: int) -> str:
    merged = ""
    for part in parts:
        normalized = " ".join((part or "").split())
        if not normalized:
            continue
        if normalized[-1] not in "。！？":
            normalized += "。"
        candidate = merged + normalized
        if merged and len(candidate) > limit:
            break
        merged = candidate if len(candidate) <= limit or not merged else merged
    return merged[:limit] if len(merged) > limit else merged


def compress_route_label(text: str) -> str:
    normalized = " ".join((text or "").split())
    replacements = [
        ("关键任务1：", ""),
        ("关键任务2：", ""),
        ("关键任务3：", ""),
        ("研究内容1：", "内容1："),
        ("研究内容2：", "内容2："),
        ("研究内容3：", "内容3："),
        ("任务目标：", "目标："),
        ("阶段目标：", "目标："),
        ("阶段成果：", "成果："),
        ("考核目标：", "考核："),
        ("提出基于人机混合增强智能的", ""),
        ("配电网检修运行方式编排架构", "配网检修编排架构"),
        ("专利2项、论文2篇、技术报告1份", "专利/论文/报告"),
        ("智能体自主趋优训练技术", "趋优训练"),
        ("知识库自学习更新方法", "知识更新"),
        ("模块架构与集成方案", "架构与集成"),
        ("开展地区电网试点应用验证", "试点应用验证"),
        ("安全约束建模方法", "安全约束建模"),
        ("风险等级预测技术", "风险等级预测"),
        ("风险主动发现与溯因", "主动发现与溯因"),
        ("人机数据知识融合增强架构", "知识增强架构"),
        ("多源数据接入与治理", "多源数据接入"),
        ("统一校核数据模型", "统一校核模型"),
        ("业务规则与知识融合", "规则知识融合"),
    ]
    for src, dst in replacements:
        normalized = normalized.replace(src, dst)
    if normalized.startswith("目标："):
        normalized = normalized.replace("目标：", "", 1).strip()
    if normalized.startswith("考核："):
        normalized = "随机故障预案验证"
    return shorten_label(normalized, 18)


def build_generic_route_labels(task: dict[str, Any]) -> list[str]:
    titles = task.get("slide_ready_research_titles") or task.get("research_contents") or []
    labels = [f"研究内容{i + 1}：{title}" for i, title in enumerate(titles[:3]) if title]
    objective = first_sentence(task.get("objective", ""))
    if objective:
        labels.append(f"任务目标：{shorten_label(objective, 24)}")
    indicators = task.get("indicators", [])
    indicator_text = compact_join(indicators, 2)
    if indicator_text:
        labels.append(f"阶段成果：{shorten_label(indicator_text, 24)}")
    return [compress_route_label(label) for label in labels]


def build_generic_diagram_labels(research_title: str, task: dict[str, Any]) -> list[str]:
    title = " ".join((research_title or "").split())
    if not title:
        return []
    patterns = [
        (("安全约束",), ["关键对象", "约束边界", "安全建模", "结果输出"]),
        (("联合建模",), ["关键对象", "规则约束", "联合建模", "结果输出"]),
        (("预测", "风险等级"), ["状态特征", "拓扑特征", "时空学习", "风险分级"]),
        (("溯因", "主动发现"), ["异常线索", "证据聚合", "规则校验", "根因定位"]),
        (("架构", "增强"), ["数据接入", "知识管理", "推理服务", "业务应用"]),
        (("智能体", "预案生成"), ["约束解析", "候选生成", "多目标权衡", "结果输出"]),
        (("趋优", "训练"), ["反馈样本", "偏好对齐", "策略修正", "结果评估"]),
        (("知识库", "更新"), ["知识采集", "增量更新", "冲突消解", "闭环优化"]),
        (("模块", "原型"), ["数据接入", "规则解析", "智能校核", "结果展示"]),
        (("集成", "架构"), ["接口联调", "服务发布", "页面交互", "系统集成"]),
        (("验证", "试点"), ["典型场景", "结果对比", "能力验证", "应用支撑"]),
    ]
    for keywords, labels in patterns:
        if any(keyword in title for keyword in keywords):
            return labels
    titles = task.get("slide_ready_research_titles") or []
    if title in titles:
        idx = titles.index(title) + 1
        return [f"研究内容{idx}", "关键方法", "场景验证", "阶段结果"]
    return [shorten_label(title, 12), "关键方法", "应用场景", "阶段结果"]


def build_visual_guidance_labels(slide: int, research_title: str) -> list[str]:
    title = " ".join((research_title or "").split())
    if slide == 41:
        return ["试点应用界面展示", "模块原型已形成"]
    if slide == 43:
        return ["展示模型训练与优化页面"]
    if slide == 44:
        return [
            "网架图模基础",
            "展示主网/馈线图模数据",
            "断面工况基础",
            "展示QS/DT断面文件",
            "规则知识基础",
            "展示规程与预案知识",
            "图形展示基础",
            "展示潮流图与接线图",
        ]
    if slide == 45:
        return ["典型场景量测与校核位置", "展示场景校核结果"]
    if slide == 46:
        return ["展示薄弱环节识别结果"]
    if slide == 47:
        return ["展示编制优化推荐结果"]
    if slide == 48:
        return ["展示PMS闭环验证结果"]
    if slide == 49:
        return ["指标测试：N-1故障预案生成<2min"]
    if "验证" in title:
        return [f"展示{shorten_label(title, 14)}结果"]
    return []


def build_generic_body_summary(task: dict[str, Any], research_title: str) -> str:
    title = " ".join((research_title or "").split())
    objective = first_sentence(task.get("objective", ""))
    objective_phrase = normalize_summary_phrase(objective, 22)
    patterns = [
        (
            ("安全约束",),
            [
                "项目将设备边界、检修安排和运行规则纳入统一约束模型。",
                "为风险分析、计划校核和方案生成提供安全边界支撑。",
            ],
        ),
        (
            ("联合建模",),
            [
                "项目围绕计划编排与运行方式调整关系开展联合建模。",
                "形成计划与方式协同推演的统一方法基础。",
            ],
        ),
        (
            ("表征", "先验知识"),
            [
                "项目从计划报送、校核规则和历史方案中提取先验知识。",
                "形成支撑计划校核、风险分析和模型训练的统一知识表征。",
            ],
        ),
        (
            ("增强架构", "数据知识"),
            [
                "项目构建覆盖接入、管理、推理和应用的数据知识增强架构。",
                "实现多源数据、规则知识和交互反馈协同利用。",
            ],
        ),
        (
            ("预测", "风险等级"),
            [
                "项目融合设备状态、检修时序和网络拓扑特征，构建多粒度时空学习模型。",
                "支撑不同检修安排下的风险等级预测与分层评估。",
            ],
        ),
        (
            ("溯因", "主动发现"),
            [
                "项目形成风险线索发现、证据聚合与根因定位的分析链路。",
                "支撑异常识别、知识校验和结果回溯。",
            ],
        ),
        (
            ("智能体", "预案生成"),
            [
                "项目围绕检修计划编排与运行方式协同生成需求，构建预案生成智能体。",
                "形成候选方案生成、多目标权衡与预案输出能力，支撑复杂场景下的方案快速构造。",
            ],
        ),
        (
            ("趋优", "训练"),
            [
                "项目将专家评分、审查意见和校核结果转化为可学习样本。",
                "形成偏好对齐、策略修正与结果反馈闭环，推动生成方案持续趋优。",
            ],
        ),
        (
            ("知识库", "更新"),
            [
                "项目建立知识采集、增量更新和冲突消解机制，支撑规则知识持续沉淀。",
                "持续提升模型推理质量、结果一致性与可解释性，增强知识服务能力。",
            ],
        ),
        (
            ("模块原型",),
            [
                "项目研发智能校核与编制优化模块原型。",
                "支撑计划解析、风险识别、方式校核和结果展示等核心功能。",
            ],
        ),
        (
            ("集成", "架构"),
            [
                "项目围绕接口联调、服务发布和页面交互开展系统集成。",
                "推动模块融入既有业务流程与应用环境。",
            ],
        ),
        (
            ("验证", "试点"),
            [
                "项目在典型业务场景下开展能力验证。",
                "检验风险辨识、预案生成和编制优化的业务支撑效果。",
            ],
        ),
    ]
    for keywords, sentences in patterns:
        if any(keyword in title for keyword in keywords):
            return merge_summary_sentences(sentences, 72)
    if objective:
        return merge_summary_sentences(
            [
                f"项目围绕{objective_phrase or shorten_label(objective, 22)}开展研究。",
                "形成阶段性方法成果，并为后续场景验证与工程应用提供支撑。",
            ],
            72,
        )
    return merge_summary_sentences(
        [
            f"项目围绕{title or '相关研究内容'}开展阶段性研究。",
            "形成面向业务场景的关键方法和应用支撑成果。",
        ],
        72,
    )


def build_indicator_rows(content: dict[str, Any], limit: int = 4) -> list[str]:
    rows: list[str] = []
    for task in content.get("tasks", []):
        for indicator in task.get("indicators", []):
            short = shorten_label(indicator, 28)
            if short and short not in rows:
                rows.append(short)
            if len(rows) >= limit:
                return rows
    return rows or [
        "形成可落地的关键技术架构。",
        "形成面向典型场景的风险研判能力。",
        "形成知识增强与智能推理能力。",
        "形成模块集成与应用验证成果。",
    ]


def build_deliverable_rows(content: dict[str, Any]) -> list[str]:
    paper_sample = "配网检修运行方式智能校核方法研究"
    patent_sample = "一种配网检修风险辨识方法"
    report_sample = "项目阶段技术研究报告"
    return [paper_sample, patent_sample, report_sample]


def build_innovation_summary(task: dict[str, Any]) -> str:
    titles = task.get("slide_ready_research_titles") or task.get("research_contents") or []
    title_text = compact_join(titles, 2)
    if title_text:
        return merge_summary_sentences(
            [
                f"项目围绕{title_text}形成阶段性创新成果。",
                "支撑检修运行方式智能校核与编制优化场景应用。",
            ],
            64,
        )
    objective = first_sentence(task.get("objective", ""))
    if objective:
        return merge_summary_sentences(
            [
                f"项目围绕{normalize_summary_phrase(objective, 24)}形成阶段性创新成果。",
                "为后续验证推广和成果凝练提供支撑。",
            ],
            64,
        )
    return "项目形成了阶段性创新成果，并具备进一步推广价值。"


def build_innovation_support(task: dict[str, Any]) -> list[str]:
    indicators = task.get("indicators", [])
    rows = [f"支撑成果：{shorten_label(item, 28)}" for item in indicators[:2] if shorten_label(item, 28)]
    if rows:
        return rows
    return [f"支撑成果：{task.get('slide_ready_short_title') or task.get('task_title', '相关')}阶段成果。"]


def build_innovation_labels(slide: int, task: dict[str, Any]) -> list[str]:
    override = INNOVATION_LABEL_OVERRIDES.get(slide)
    if override:
        return override
    titles = task.get("slide_ready_research_titles") or task.get("research_contents") or []
    labels = [shorten_label(title, 20) for title in titles[:4] if shorten_label(title, 20)]
    return labels


def build_task_route_content(task_number: int, task: dict[str, Any]) -> dict[str, Any]:
    override = TASK_ROUTE_PAGE_OVERRIDES.get(task_number, {})
    titles = task.get("slide_ready_research_titles") or task.get("research_contents") or []
    default_title = f"研究内容1：{compact_join(titles, 3)}" if titles else "研究内容1：关键技术路线"
    default_summary = merge_summary_sentences(
        [
            f"围绕{compact_join(titles, 2) or f'课题{task_number}关键研究内容'}构建技术路线。",
            "支撑关键方法研究、能力验证与阶段成果沉淀。",
        ],
        58,
    )
    return {
        "task_title": task.get("slide_ready_short_title") or task.get("task_title", ""),
        "route_title": override.get("route_title") or default_title,
        "route_summary": override.get("route_summary") or default_summary,
        "route_labels": [compress_route_label(label) for label in (override.get("route_labels") or build_generic_route_labels(task))],
    }


def build_scenario_label(meta: dict[str, Any], overview: dict[str, Any]) -> str:
    org = meta.get("lead_org", "") or meta.get("funding_org", "")
    city_match = re.search(r"国网(.{2,8}?)(?:市)?电力公司", org)
    city = city_match.group(1) if city_match else ""
    scope = "配网"
    objective = " ".join((overview.get("overall_objective", "") or "").split())
    if "配电" in objective or "配网" in objective:
        scope = "配网"
    elif "电网" in objective:
        scope = "电网"
    if city:
        return f"以{city}{scope}业务为例"
    return f"以典型{scope}业务为例"


def build_figure_guidance(page_type: str, slide: int, meta: dict[str, Any], overview: dict[str, Any]) -> list[str]:
    if page_type == "background-body":
        scenario = build_scenario_label(meta, overview)
        captions = {
            3: scenario,
            4: "推进配网业务智能升级",
        }
        return [captions.get(slide, "")]
    if page_type == "research-baseline-page":
        captions = {
            13: "国内相关研究案例",
            14: "国内示范平台案例",
        }
        return [captions.get(slide, "")]
    return []


def build_task_research_sequence(slides: list[int], research_count: int) -> list[int]:
    slide_count = len(slides)
    if research_count <= 0:
        return [0] * slide_count
    template_patterns = {
        (4, 3): [0, 1, 2, 2],
        (6, 3): [0, 0, 1, 1, 2, 2],
        (7, 3): [0, 0, 1, 1, 2, 2, 2],
        (11, 3): [0, 0, 1, 1, 1, 2, 2, 2, 2, 2, 2],
    }
    if (slide_count, research_count) in template_patterns:
        return template_patterns[(slide_count, research_count)]
    return [idx % research_count for idx in range(slide_count)]


def build_task_pages(slides: list[int], task: dict[str, Any]) -> list[dict[str, Any]]:
    pages = []
    research_titles = task.get("slide_ready_research_titles") or task.get("research_contents") or []
    body_points = task.get("slide_ready_body_points") or []
    title_sequence = build_task_research_sequence(slides, len(research_titles))
    for index, slide in enumerate(slides):
        override = TASK_PAGE_PLANS.get(task.get("task_number", 0), {}).get(slide, {}) if slide in TASK_PAGE_SPECIAL_OVERRIDE_SLIDES else {}
        title_index = title_sequence[index] if index < len(title_sequence) else min(index, max(0, len(research_titles) - 1))
        research_title = override.get("research_item_title") or (research_titles[title_index] if research_titles else "")
        body_summary = override.get("body_summary") or build_generic_body_summary(task, research_title) or (
            body_points[title_index] if body_points and title_index < len(body_points) else (body_points[-1] if body_points else task.get("objective", ""))
        )
        pages.append(
            {
                "slide": slide,
                "task_number": task.get("task_number"),
                "task_title": override.get("task_title") or task.get("slide_ready_short_title") or task.get("task_title", ""),
                "research_item_title": research_title,
                "body_summary": body_summary,
                "diagram_labels": build_visual_guidance_labels(slide, research_title)
                if slide in VISUAL_GUIDANCE_OVERRIDE_SLIDES
                else (TASK_RESEARCH_LABEL_OVERRIDES.get(slide) or build_generic_diagram_labels(research_title, task)),
                "body_source": "task.research_contents / task.objective",
            }
        )
    return pages


def build_manifest(schema: dict[str, Any], content: dict[str, Any]) -> dict[str, Any]:
    slides = []
    meta = content.get("project_meta", {})
    overview = content.get("overview", {})
    management = content.get("management", {})
    summary = content.get("summary", {})
    feedback = content.get("feedback", {})

    for entry in schema.get("slide_map", []):
        page_type = entry["page_type"]
        slide_numbers = entry["slides"]
        if page_type == "cover":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "project_title": meta.get("project_title", ""),
                        "project_lead": meta.get("project_owner", ""),
                        "lead_org": meta.get("lead_org", ""),
                        "participant_orgs": meta.get("participant_orgs", []),
                    },
                }
            )
        elif page_type == "background-body":
            bodies = [
                "面向配网多时间尺度检修运行方式智能校核与协同编制优化需求，项目聚焦人机协同智能校核与编制优化关键技术，提升检修编制的可信性、安全性和效率。",
                "项目结合配电网状态计算、安全校核和多电压等级检修计划知识，通过专家先验知识约束与反馈趋优训练，形成数据知识融合的智能决策推理与演化模型。",
            ]
            scenario_label = build_scenario_label(meta, overview)
            for i, slide in enumerate(slide_numbers):
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {
                            "body_summary": bodies[min(i, len(bodies) - 1)],
                            "scenario_label": scenario_label if i == 0 else "",
                            "figure_guidance": build_figure_guidance(page_type, slide, meta, overview),
                        },
                    }
                )
        elif page_type == "problem-structure":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "problem_cards": overview.get("overall_research_contents", [])[:3],
                        "goal_cards": [
                            "统一、高效的平台支撑框架",
                            "检修计划与方式协同建模",
                            "数据知识融合决策推理与演化",
                        ],
                    },
                }
            )
        elif page_type == "project-info-table":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "project_meta": meta,
                        "task_table": [
                            {
                                "task_number": task.get("task_number"),
                                "task_title": task.get("slide_ready_short_title") or task.get("task_title", ""),
                                "owner_orgs": task.get("owner_orgs", []),
                            }
                            for task in content.get("tasks", [])
                        ],
                    },
                }
            )
        elif page_type == "responsibility-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "lead_org": meta.get("lead_org", ""),
                        "project_owner": meta.get("project_owner", ""),
                        "consultants": [],
                        "task_owners": [
                            {
                                "task_number": task.get("task_number"),
                                "task_title": task.get("slide_ready_short_title") or task.get("task_title", ""),
                                "owners": task.get("owners", []),
                                "owner_orgs": task.get("owner_orgs", []),
                            }
                            for task in content.get("tasks", [])
                        ],
                    },
                }
            )
        elif page_type == "management-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "body_summary": management.get("org_mechanism_summary", ""),
                        "mechanism_labels": ["节点跟踪机制", "成果汇交机制"],
                    },
                }
            )
        elif page_type == "timeline-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "milestones": management.get("milestones", []),
                    },
                }
            )
        elif page_type == "change-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "change_statement": management.get("change_statement", ""),
                    },
                }
            )
        elif page_type == "budget-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "budget_rows": management.get("budget_rows", []),
                    },
                }
            )
        elif page_type == "research-baseline-page":
            bodies = [
                "当前面向配网检修运行方式的智能分析仍存在模型透明度不足、专家经验难结构化融入、复杂工况样本获取成本高等问题。",
                "需要把电网业务机理、运行规程、风险约束、可解释学习和人工交互能力结合起来，形成服务真实运检业务的混合增强智能方案。",
                "项目研究基础以四个课题递进展开，覆盖架构研究、风险溯因、趋优学习和模块应用验证。"
            ]
            for i, slide in enumerate(slide_numbers):
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {
                            "body_summary": bodies[min(i, len(bodies) - 1)],
                            "comparison_points": [],
                            "figure_guidance": build_figure_guidance(page_type, slide, meta, overview),
                        },
                    }
                )
        elif page_type == "overall-roadmap-page":
            overall_titles = overview.get("overall_research_contents", [])
            overall_summary = merge_summary_sentences(
                [
                    "项目由四个课题共同构成完整研究链路。",
                    "覆盖知识增强架构、风险主动发现、反馈趋优学习和模块应用验证。",
                ],
                72,
            )
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "overall_roadmap": overall_titles,
                        "overall_summary": overall_summary,
                        "body_summary": overall_summary,
                    },
                }
            )
        elif page_type == "task-subtitle-page":
            task = get_task(content, entry["task_number"])
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "task_number": entry["task_number"],
                    "dynamic_content": {
                        "task_title": task.get("slide_ready_short_title") or task.get("task_title", ""),
                    },
                }
            )
        elif page_type == "task-route-page":
            task = get_task(content, entry["task_number"])
            route_content = build_task_route_content(entry["task_number"], task)
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "task_number": entry["task_number"],
                    "dynamic_content": route_content,
                }
            )
        elif page_type == "task-research-page":
            task = get_task(content, entry["task_number"])
            for page in build_task_pages(slide_numbers, task):
                slides.append(
                    {
                        "slide": page["slide"],
                        "page_type": page_type,
                        "task_number": entry["task_number"],
                        "dynamic_content": {
                            "task_title": page["task_title"],
                            "research_item_title": page["research_item_title"],
                            "body_summary": page["body_summary"],
                            "diagram_labels": page.get("diagram_labels", []),
                        },
                    }
                )
        elif page_type == "indicator-table-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "indicator_rows": build_indicator_rows(content),
                    },
                }
            )
        elif page_type == "deliverable-table-page":
            deliverables = build_deliverable_rows(content)
            for slide in slide_numbers:
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {
                            "deliverable_rows": deliverables,
                        },
                    }
                )
        elif page_type == "innovation-summary-page":
            for i, slide in enumerate(slide_numbers, start=1):
                task = get_task(content, i)
                slide_override = INNOVATION_SLIDE_OVERRIDES.get(slide, {})
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {
                            "innovation_number": slide_override.get("innovation_number", i),
                            "innovation_title": slide_override.get("innovation_title") or INNOVATION_TITLE_OVERRIDES.get(i) or task.get("slide_ready_short_title") or f"创新点{i}",
                            "innovation_summary": slide_override.get("innovation_summary") or INNOVATION_SUMMARY_OVERRIDES.get(i) or build_innovation_summary(task),
                            "supporting_results": slide_override.get("supporting_results") or INNOVATION_SUPPORT_OVERRIDES.get(i) or build_innovation_support(task),
                            "innovation_labels": build_innovation_labels(slide, task),
                        },
                    }
                )
        elif page_type == "summary-page":
            for i, slide in enumerate(slide_numbers):
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {
                            "body_summary": summary.get("summary_points", [""])[min(i, len(summary.get("summary_points", [""])) - 1)],
                            "outlook_points": summary.get("outlook_points", []),
                        },
                    }
                )
        elif page_type == "feedback-page":
            slides.append(
                {
                    "slide": slide_numbers[0],
                    "page_type": page_type,
                    "dynamic_content": {
                        "feedback_items": feedback.get("feedback_items", []),
                    },
                }
            )
        else:
            for slide in slide_numbers:
                slides.append(
                    {
                        "slide": slide,
                        "page_type": page_type,
                        "dynamic_content": {},
                    }
                )

    slides = sorted(slides, key=lambda item: item["slide"])
    return {
        "version": "2.0",
        "template": schema.get("template"),
        "project_title": meta.get("project_title", ""),
        "slide_manifest": slides,
    }


def main() -> None:
    args = parse_args()
    schema = load_json(args.schema)
    content = load_json(args.content)
    manifest = build_manifest(schema, content)
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
