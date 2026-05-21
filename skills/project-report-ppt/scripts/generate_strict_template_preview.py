#!/usr/bin/env python3
"""Generate a strict-template preview by replacing text in a PPTX package."""

from __future__ import annotations

import argparse
from pathlib import Path
import re
import xml.etree.ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

NS = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}


REPLACEMENTS = [
    (
        "面向企业级电网智能计算推演的共性服务关键技术研究",
        "基于人机协同的配网检修运行方式智能校核与编制优化关键技术研究",
    ),
    ("国网山东省电力公司", "国网上海市电力公司"),
    ("亓富军", "金敏杰"),
]

PARTICIPANT_LINES = [
    "中国电力科学研究院有限公司",
    "北京交通大学",
    "西安交通大学",
    "国网信息通信产业集团有限公司",
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Create a strict-template PPT preview by editing PPTX XML in place."
    )
    parser.add_argument("--template", required=True, help="Input template PPTX.")
    parser.add_argument("--output", required=True, help="Output PPTX path.")
    return parser.parse_args()


def replace_text(data: bytes) -> bytes:
    text = data.decode("utf-8")
    for source, target in REPLACEMENTS:
        text = text.replace(source, target)
    return text.encode("utf-8")


def patch_cover_slide(data: bytes) -> bytes:
    root = ET.fromstring(data)
    nodes = [node for node in root.findall(".//a:t", NS) if node.text]
    texts = [node.text.strip() for node in nodes]
    if "项目负责人：" not in texts:
        return data

    participant_order = [
        "中国电力科学研究院有限公司",
        "国网信息通信产业集团有限公司",
        "天津大学",
        "国网电力科学研究院有限公司",
    ]
    replacements = dict(zip(participant_order, PARTICIPANT_LINES))
    for node in nodes:
        clean = node.text.strip()
        if clean in replacements:
            suffix = " " if node.text.endswith(" ") else ""
            node.text = replacements[clean] + suffix
        if clean == "2026":
            node.text = "2025 "
        if clean == "1":
            node.text = "12 "

    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def patch_budget_slide(data: bytes) -> bytes:
    text = data.decode("utf-8")
    text = text.replace("日，国网临沂供电公司累计拨付", "日，国网上海市电力公司累计拨付")
    return text.encode("utf-8")


def patch_nodes(data: bytes, updates: dict[int, str]) -> bytes:
    root = ET.fromstring(data)
    nodes = root.findall(".//a:t", NS)
    for index, value in updates.items():
        if index < len(nodes):
            nodes[index].text = value
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


SLIDE_UPDATES: dict[str, dict[int, str]] = {
    "ppt/slides/slide3.xml": {
        2: "上海超大城市配电网设备密集、运行方式复杂，检修计划编排与运行方式调整面临多专业耦合、约束繁杂等挑战。",
        3: "人工提报、人工校核、人工协调",
        4: "等传统方式",
        5: "效率低、可追溯性弱",
        6: "，难以支撑多时间尺度检修计划与方式预案的高质量协同编制，亟需",
        7: "构建人机协同的数据知识增强与智能校核优化能力",
        8: "。",
        10: "以上海配电网检修业务为例",
        11: "检修计划与方式预案协同需求突出",
        12: "计",
        13: "校",
        14: "编",
        15: "调",
    },
    "ppt/slides/slide4.xml": {
        0: "本项目面向配网多时间尺度检修运行方式智能校核与协同编制优化需求，",
        1: "结合配电网状态计算与安全校核能力，",
        2: "融合检修计划报送、编制、预案等",
        3: "领域知识、运行规则和专家经验，",
        4: "建立数据知识融合的智能决策推理与演化模型",
        5: "，提升计划编制智能生成的可信性和安全性。",
        9: "支撑检修计划智能编排",
        10: "数据知识融合增强",
        15: "知识融合与共享",
        16: "智能决策空间",
        17: "配网业务现场",
    },
    "ppt/slides/slide5.xml": {
        3: "需要统一、可信的人机协同支撑框架",
        4: "当前配网检修运行方式编制存在",
        5: "数据复杂、约束缺失、过程低效",
        6: "等问题：计划报送、校核、编排与方式调整",
        7: "衔接不紧密",
        8: "；专家经验难沉淀为可复用知识",
        9: "知识更新不足",
        10: "；风险研判与预案生成",
        11: "自动化水平有限",
        12: "。",
        13: "先验知识建模",
        14: "风险主动发现",
        15: "多时间尺度检修计划与运行方式协同优化任务复杂，",
        16: "跨专业约束与多电压等级耦合明显",
        17: "。传统人工方式",
        18: "耗时长",
        19: "、",
        20: "一致性差、解释成本高",
        21: "；面向实际业务的智能体方法在",
        22: "可信校核与闭环反馈",
        23: "方面仍需增强",
        24: "。",
        25: "项目拟通过数据知识增强与反馈趋优学习",
        26: "打通计划编排、风险辨识到预案生成链路",
        27: "形成可持续优化的人机协同机制",
        28: "，",
        29: "构建",
        30: "自主更新的检修计划知识库",
        31: "与编制优化模块",
        32: "。",
        33: "多时间尺度计划",
        34: "智能协同编排",
        35: "人机协同",
        36: "知识增强",
        37: "融合",
        38: "专家经验",
        39: "，研发",
        40: "检修运行方式",
        41: "智能校核与编制优化能力，在",
        42: "实际业务",
        43: "实现",
        44: "风险快速研判与预案高效生成",
        45: "。",
    },
    "ppt/slides/slide6.xml": {
        2: "基于人机协同的配网检修运行方式智能校核与编制优化关键技术研究",
        4: "国网上海市电力公司",
        6: "525",
        9: "2024",
        11: "1",
        13: "2025",
        15: "12",
        22: "面向配网检修运行方式动态协调编排的人机协同数据知识增强架构研究",
        23: "中国电力科学研究院有限公司",
        27: "基于先验知识内嵌机器学习的配网检修风险主动发现与溯因技术研究",
        28: "西安交通大学、中国电力科学研究院有限公司",
        32: "检修计划与运行方式预案的专家反馈趋优学习与知识更新技术研究",
        33: "北京交通大学",
        34: "、中国电力科学研究院有限公司",
        38: "人机协同数据知识增强的配电系统检修运行方式智能校核与编制优化模块的开发与应用",
        39: "国网上海市电力公司、",
        40: "中国电力科学研究院有限公司",
        41: "、国网信息通信产业集团有限公司",
        42: "",
        43: "",
        44: "",
        45: "",
        46: "",
    },
    "ppt/slides/slide7.xml": {
        5: "乔骥",
        6: "李琰",
        9: "黄玉雄",
        10: "",
        12: "陈予尧",
        15: "王",
        17: "小君",
        18: "李家腾",
        21: "苏",
        23: "运",
        24: "张海涛",
        25: "上海公司",
        26: "金敏杰",
        27: "中国电科院",
        28: "中国电科院",
        29: "西安交大",
        30: "北京交大",
        31: "中国电科院",
        32: "国网上海市电力公司",
        33: "中国电科院",
        34: "",
        35: "中国电科院",
        36: "国网信通产业集团",
        37: "",
        38: "",
        39: "",
        40: "项目采用“上海公司牵头、课题单位协同、专家咨询支撑”的组织模式，",
        41: "持续推进实施方案、课题攻关、模块研发与试点验证。",
        42: "",
        43: "",
        44: "",
        48: "项目顾问：行业专家咨询机制",
        49: "",
        50: "专家咨询",
        51: "协同攻关",
        52: "试点验证",
    },
    "ppt/slides/slide8.xml": {
        0: "项目已形成课题实施方案和协同工作机制，围绕",
        1: "实施方案、阶段检查",
        2: "，持续开展",
        3: "月度交底、季度讨论",
        4: "和",
        5: "专家咨询评审",
        6: "，动态优化课题任务分工、技术路线、接口协同和应用验证安排。",
        10: "项目过程管理",
        12: "季度讨论",
        13: "实施方案",
    },
    "ppt/slides/slide9.xml": {
        0: "任务书下达后，项目启动并完成研究方案与实施路径设计，明确总体分工",
        1: "围绕架构研究、风险溯因、趋优学习和模块应用四条主线，分阶段推进研究与验证工作",
        2: "2024.1",
        3: "2024.3",
        4: "2024.12",
        5: "2025.6",
        6: "2025.12",
        7: "2024.1",
        9: "下达任务书",
        11: "启动项目，形成实施方案",
        12: "开展课题调研与关键方法研究，明确模型与知识表示路径",
        14: "阶段推进研究",
        15: "完成架构、风险预测、趋优训练等核心方法研发",
        17: "开展系统集成与试点应用验证",
        18: "形成模块原型，推进接口联调与场景验证",
        19: "",
        20: "",
        22: "准备验收材料",
        23: "完成项目",
        24: "结题验收准备",
        26: "验收",
        27: "",
    },
    "ppt/slides/slide10.xml": {
        0: "项目当前未发生影响总体目标和考核指标的重大方向性调整。围绕课题协同、模块开发和试点验证需要，",
        1: "",
        2: "人员与分工",
        3: "",
        4: "已按研究进度进行动态优化与衔接，相关调整均纳入项目统一管理范围。",
        5: "",
        6: "",
        7: "目前项目整体组织有序",
        8: "，实施过程符合科技项目管理要求，",
        9: "后续将继续做好过程留痕与验收衔接。",
    },
    "ppt/slides/slide11.xml": {
        1: "5",
        2: "25",
        9: "日，国网上海市电力公司累计拨付",
        10: "5",
        11: "25",
        16: "根据任务书，项目各承担单位已完成预算分解，",
        17: "",
        18: "累计支出与执行率以后续财务决算数据为准",
        19: "",
        20: "，",
        21: "当前可确认预算总额为",
        22: "525万元",
        24: "后续执行",
        25: "依据任务书统筹安排",
        34: "国网上海市电力公司",
        35: "5",
        36: "—",
        37: "—",
        39: "360",
        40: "—",
        41: "—",
        43: "40",
        44: "—",
        45: "—",
        46: "北京交通大学",
        47: "60",
        48: "—",
        49: "—",
        50: "西安交通大学",
        51: "60",
        52: "—",
        53: "—",
        54: "",
        55: "",
        57: "525",
        58: "—",
        59: "—",
    },
    "ppt/slides/slide16.xml": {
        4: "本项目聚焦配网检修运行方式智能校核与协同编制优化关键技术研究，共设四个子课题：课题",
        7: "人机协同数据知识增强架构",
        10: "提出",
        11: "风险主动发现与溯因技术",
        16: "专家反馈趋优学习",
        18: "知识更新",
        20: "预案生成优化",
        22: "全链条智能决策技术体系",
        24: "检修计划编排与运行方式预案的快速、可信生成；课题",
        26: "研发智能校核与编制优化模块原型系统，",
        27: "并开展",
        28: "试点应用验证",
        30: "数据知识增强",
        31: "风险主动发现",
        32: "趋优学习更新",
        33: "模块研发应用",
    },
}


def main() -> None:
    args = parse_args()
    template = Path(args.template).expanduser().resolve()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    with ZipFile(template, "r") as zin, ZipFile(output, "w", compression=ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename.endswith(".xml") and item.filename.startswith("ppt/"):
                data = replace_text(data)
                if item.filename == "ppt/slides/slide1.xml":
                    data = patch_cover_slide(data)
                if item.filename == "ppt/slides/slide11.xml":
                    data = patch_budget_slide(data)
                if item.filename in SLIDE_UPDATES:
                    data = patch_nodes(data, SLIDE_UPDATES[item.filename])
            zout.writestr(item, data)


if __name__ == "__main__":
    main()
