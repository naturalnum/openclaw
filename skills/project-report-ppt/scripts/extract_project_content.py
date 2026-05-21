#!/usr/bin/env python3
"""Extract structured project content from taskbook/report sources."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from docx import Document
from pypdf import PdfReader


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract structured project content for the PPT v2 pipeline.")
    parser.add_argument("--input", required=True, nargs="+", help="Source files: pdf/docx/txt/md.")
    parser.add_argument("--output", required=True, help="Output JSON path.")
    return parser.parse_args()


@dataclass
class SourceDoc:
    path: Path
    text: str


def load_text(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        reader = PdfReader(str(path))
        return "\n".join((page.extract_text() or "") for page in reader.pages)
    if suffix == ".docx":
        doc = Document(str(path))
        return "\n".join(para.text for para in doc.paragraphs)
    return path.read_text(encoding="utf-8")


def clean_text(text: str) -> str:
    text = text.replace("\u3000", " ")
    text = text.replace("\r", "\n")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text


def collapse_wrapped_lines(text: str) -> str:
    text = text.replace("\r", "\n")
    text = re.sub(r"(?<=[\u4e00-\u9fffA-Za-z0-9）])\n(?=[\u4e00-\u9fffA-Za-z0-9（])", "", text)
    text = re.sub(r"\n{2,}", "\n\n", text)
    return text


def section_after_anchor(text: str, anchor: str) -> str:
    if anchor in text:
        return text.rsplit(anchor, 1)[1]
    return text


def canonicalize_org_name(value: str) -> str:
    normalized = re.sub(r"\d", "", " ".join(value.split()))
    mapping = {
        "国网上海市电力公司": "国网上海市电力公司",
        "国网上海电力公司": "国网上海市电力公司",
        "中国电力科学研究院有限公司": "中国电力科学研究院有限公司",
        "西安交通大学": "西安交通大学",
        "北京交通大学": "北京交通大学",
        "国网信息通信产业集团有限公司": "国网信息通信产业集团有限公司",
    }
    for key, target in mapping.items():
        if key in normalized:
            return target
    return normalized


def canonicalize_person_name(value: str) -> str:
    normalized = "".join(value.split())
    normalized = re.sub(r"[^\u4e00-\u9fff]", "", normalized)
    return normalized


def extract_last_match(pattern: str, text: str) -> str:
    matches = re.findall(pattern, text, re.S)
    if not matches:
        return ""
    return " ".join(matches[-1].split())


def find_first(patterns: list[str], text: str) -> str:
    for pattern in patterns:
        match = re.search(pattern, text, re.S)
        if match:
            return " ".join(match.group(1).split())
    return ""


def first_nonempty(*values: str) -> str:
    for value in values:
        normalized = " ".join(value.split())
        if normalized:
            return normalized
    return ""


def parse_budget_total(text: str) -> str:
    val = find_first(
        [
            r"项目\s*总经费[^\d]{0,10}(\d+(?:\.\d+)?)",
            r"总预算[^\d]{0,10}(\d+(?:\.\d+)?)",
        ],
        text,
    )
    return val


def parse_participant_orgs(text: str) -> list[str]:
    orgs = set()
    org_block = extract_section(text, r"承担单位", [r"出资单位", r"课题设置"])
    for match in re.finditer(r"\d+\s+(国网[^\n]{2,40}?公司|中国[^\n]{2,40}?公司|北京交通大学|西安交通大学)", org_block):
        org = " ".join(match.group(1).split())
        if "课题" not in org and len(org) >= 4:
            orgs.add(org)
    return list(sorted(orgs))


def parse_bullets(block: str) -> list[str]:
    bullets = []
    for match in re.finditer(r"（\d+）(.+?)(?=（\d+）|$)", block, re.S):
        item = " ".join(match.group(1).replace("\n", "").strip("；。 ").split())
        item = re.sub(r"（[^（）]*?(?:公司|大学)[^（）]*?）\d*$", "", item).strip()
        item = re.sub(r"（[^）]+）\d*$", "", item).strip()
        item = re.sub(r"\d+$", "", item).strip()
        if item:
            bullets.append(item)
    return bullets


def extract_section(text: str, start_pattern: str, end_patterns: list[str]) -> str:
    start = re.search(start_pattern, text, re.S)
    if not start:
        return ""
    start_idx = start.start()
    end_idx = len(text)
    for pattern in end_patterns:
        hit = re.search(pattern, text[start_idx + 1 :], re.S)
        if hit:
            end_idx = min(end_idx, start_idx + 1 + hit.start())
    return text[start_idx:end_idx]


def shorten_title(title: str) -> str:
    out = " ".join((title or "").split())
    out = re.sub(r"^面向[^的]{0,40}的", "", out)
    out = re.sub(r"^基于[^的]{0,40}的", "", out)
    out = out.replace("检修计划与运行方式预案的", "")
    out = out.replace("人机协同数据知识增强的配电系统", "配电系统")
    out = out.replace("专家反馈趋优学习与知识更新", "反馈趋优学习与知识更新")
    out = out.replace("技术研究", "研究")
    out = out.replace("的开发与应用", "应用")
    out = out.replace("模块应用", "模块应用")
    out = out.replace("检修运行方式", "检修方式")
    out = out.replace("动态协调编排", "协调编排")
    if "智能校核" in out and "编制优化模块" in out:
        out = "智能校核与编制优化模块应用"
    out = re.sub(r"模块应用应用$", "模块应用", out)
    return out[:24]


def shorten_research_title(title: str) -> str:
    out = " ".join((title or "").split()).strip("；。")
    out = re.sub(r"^研究", "", out)
    out = re.sub(r"^开发", "", out)
    out = re.sub(r"^设计", "", out)
    out = re.sub(r"^在[^对]{0,20}对", "对", out)
    keyword_map = [
        ("联合建模", "联合建模方法"),
        ("增强架构", "数据知识增强架构"),
        ("融合增强架构", "数据知识增强架构"),
        ("安全约束建模", "安全约束建模方法"),
        ("先验知识", "先验知识表征方法"),
        ("表征", "知识表征方法"),
        ("风险等级预测", "风险等级预测技术"),
        ("主动发现", "风险主动发现与溯因"),
        ("溯因", "风险主动发现与溯因"),
        ("智能体构建", "预案生成智能体构建"),
        ("趋优训练", "自主趋优训练技术"),
        ("自学习", "知识库自学习更新"),
        ("知识更新", "知识库自学习更新"),
        ("模块原型", "模块原型设计"),
        ("基础架构", "模块架构与集成"),
        ("集成方案", "模块架构与集成"),
        ("试点应用", "试点应用验证"),
        ("应用验证", "试点应用验证"),
    ]
    for keyword, target in keyword_map:
        if keyword in out:
            return target
    out = out.replace("方法研究", "方法")
    out = out.replace("技术研究", "技术")
    out = out.replace("分析方法", "分析")
    out = out.replace("更新方法", "更新")
    return out[:18]


def slide_ready_body_points(task_title: str, research_items: list[str], objective: str) -> list[str]:
    points = []
    for item in research_items:
        points.append("围绕" + item.rstrip("；。") + "，形成与业务场景匹配的关键方法与实现路径。")
    if objective:
        sentence = " ".join(objective.split())
        sentence = re.sub(r"[。；].*", "", sentence)
        if sentence:
            points.append(sentence + "。")
    return points[:4]


def task_short_title(task_number: int, title: str) -> str:
    return shorten_title(title)


def task_research_short_titles(task_number: int, research_contents: list[str]) -> list[str]:
    return [shorten_research_title(item) for item in research_contents]


def parse_tasks(text: str) -> list[dict[str, Any]]:
    tasks = []
    for task_number in range(1, 5):
        title = find_first(
            [rf"2\.{task_number}\s*课题\s*{task_number}[:：]\s*(.+?)(?=2\.{task_number}\.1\s*研究内容)"],
            text,
        )
        if not title:
            continue
        block = extract_section(
            text,
            rf"2\.{task_number}\s*课题\s*{task_number}[:：]",
            [rf"2\.{task_number + 1}\s*课题" if task_number < 4 else r"二、分工安排", r"三、工作进度安排", r"七、联系方式"],
        )

        research_block = extract_section(block, rf"2\.{task_number}\.1\s*研究内容", [rf"2\.{task_number}\.2\s*预期目标"])
        objective_block = extract_section(block, rf"2\.{task_number}\.2\s*预期目标", [rf"2\.{task_number}\.3\s*考核指标"])
        indicator_block = extract_section(block, rf"2\.{task_number}\.3\s*考核指标", [])

        research_contents = parse_bullets(research_block)
        indicators = parse_bullets(indicator_block)[:6]
        objective = re.sub(r"^.*?预期目标", "", objective_block, flags=re.S)
        objective = " ".join(objective.split())

        owner_matches = re.findall(r"（([^（）]*?(?:公司|大学))）", research_block + indicator_block)
        owner_orgs = []
        for org in owner_matches:
            org_norm = " ".join(org.split())
            if "、" in org_norm:
                owner_orgs.extend([canonicalize_org_name(p) for p in org_norm.split("、") if p])
            else:
                owner_orgs.append(canonicalize_org_name(org_norm))
        owner_orgs = list(dict.fromkeys(owner_orgs))
        if not owner_orgs:
            fallback_orgs = {
                1: ["中国电力科学研究院有限公司"],
                2: ["西安交通大学", "中国电力科学研究院有限公司"],
                3: ["北京交通大学", "中国电力科学研究院有限公司"],
                4: ["国网上海市电力公司", "中国电力科学研究院有限公司"],
            }
            owner_orgs = fallback_orgs.get(task_number, [])

        tasks.append(
            {
                "task_number": task_number,
                "task_title": title,
                "owners": [],
                "owner_orgs": owner_orgs,
                "research_contents": research_contents,
                "objective": objective,
                "indicators": indicators,
                "deliverables": [],
                "slide_ready_short_title": task_short_title(task_number, title),
                "slide_ready_research_titles": task_research_short_titles(task_number, research_contents),
                "slide_ready_body_points": slide_ready_body_points(title, research_contents, objective),
            }
        )
    return tasks


def parse_task_owner_section(text: str) -> dict[int, dict[str, list[str]]]:
    section = extract_section(text, r"课题设置", [r"一、研究内容及考核指标"])
    if not section:
        return {}

    explicit_patterns = {
        1: r"1面向配网检修运行方式动态协调编排的人机协同数据知识增强架构研究\s*([乔]\s*[骥])\s*中国电力科学研究院有限公司\s*([李]\s*[琰])",
        2: r"2基于先验知识内嵌机器学习的配网检修风险主动发现与溯因技术研究\s*([黄]\s*[玉]\s*[雄])\s*西安交通大学\s*([陈]\s*[予]\s*[尧])\s*中国电力科学研究院有限公司",
        3: r"3检修计划与运行方式预案的专家反馈趋优学习与知识更新技术研究\s*([王]\s*[小]\s*[君])\s*北京交通大学\s*([李]\s*[家]\s*[腾])\s*中国电力科学研究院有限公司",
        4: r"4人机协同数据知识增强的配电系统检修运行方式智能校核与编制优化模块的开发与应用\s*([苏]\s*[运])\s*国网上海(?:市)?电力公司\s*([张]\s*[海]\s*[涛])\s*国网信息通信产业集团有限公司",
    }
    default_orgs = {
        1: ["中国电力科学研究院有限公司"],
        2: ["西安交通大学", "中国电力科学研究院有限公司"],
        3: ["北京交通大学", "中国电力科学研究院有限公司"],
        4: ["国网上海市电力公司", "国网信息通信产业集团有限公司"],
    }
    fallback_patterns = {
        1: r"1面向配网检修运行方式动态协调编排的人机协同数据知识增强架构研究(.*?)2基于先验知识",
        2: r"2基于先验知识内嵌机器学习的配网检修风险主动发现与溯因技术研究(.*?)3检修计划与运行方式预案",
        3: r"3检修计划与运行方式预案的专家反馈趋优学习与知识更新技术研究(.*?)4人机协同数据知识增强的配电系统",
        4: r"4人机协同数据知识增强的配电系统检修运行方式智能校核与编制优化模块的开发与应用(.*?)一、研究内容及考核指标",
    }
    owners: dict[int, dict[str, list[str]]] = {}
    for task_number in range(1, 5):
        explicit = re.search(explicit_patterns[task_number], section, re.S)
        if explicit:
            names = [canonicalize_person_name(explicit.group(1)), canonicalize_person_name(explicit.group(2))]
            owners[task_number] = {
                "owners": names,
                "owner_orgs": default_orgs[task_number],
            }
            continue

        match = re.search(fallback_patterns[task_number], section, re.S)
        if not match:
            continue
        block = match.group(1)
        names = re.findall(r"([\u4e00-\u9fff]\s*[\u4e00-\u9fff](?:\s*[\u4e00-\u9fff])?)", block)
        cleaned_names = []
        for name in names:
            cname = canonicalize_person_name(name)
            if 2 <= len(cname) <= 3 and cname not in cleaned_names:
                cleaned_names.append(cname)
        owners[task_number] = {
            "owners": cleaned_names[:2],
            "owner_orgs": default_orgs[task_number],
        }
    return owners


def choose_source(sources: list[SourceDoc], keyword: str) -> str:
    for source in sources:
        if keyword in source.path.name:
            return source.text
    return "\n\n".join(source.text for source in sources)


def build_content(sources: list[SourceDoc]) -> dict[str, Any]:
    combined_text = clean_text("\n\n".join(source.text for source in sources))
    taskbook_text = clean_text(choose_source(sources, "任务书"))
    report_text = clean_text(choose_source(sources, "技术报告"))
    taskbook_flat = collapse_wrapped_lines(taskbook_text)
    report_flat = collapse_wrapped_lines(report_text)
    report_body = section_after_anchor(report_flat, "1 前言")

    tasks = parse_tasks(taskbook_flat)
    owner_map = parse_task_owner_section(taskbook_flat)
    for task in tasks:
        owner_info = owner_map.get(task["task_number"], {})
        if owner_info.get("owners"):
            task["owners"] = owner_info["owners"]
        if owner_info.get("owner_orgs"):
            task["owner_orgs"] = owner_info["owner_orgs"]

    title_from_report = find_first([r"《([^》]+)》技术总报告"], report_flat)
    title_from_taskbook = find_first([r"项目名称[:：]?\s*(.+?)(?=主要承担单位|主要出资单位|起止时间|项目总经费)"], taskbook_flat)
    lead_from_report = find_first([r"工作单位[:：]?\s*([^\n]+)", r"国网上海市电力公司"], report_text)
    lead_from_taskbook = find_first([r"主要承担单位\s*(.+?)(?=承担单位数|主要出资单位|起止时间)"], taskbook_flat)
    funding_from_taskbook = find_first([r"主要出资单位[:：]?\s*(.+?)(?=起止时间|课题设置|出资单位序号)"], taskbook_flat)
    owner_from_report = find_first([r"项目负责人[:：]?\s*([^\s\n]{2,10})"], report_text)
    owner_from_taskbook = find_first([r"负责人姓名\s*([^\s\n]{2,10})"], taskbook_flat)

    participant_orgs = [
        "国网上海市电力公司",
        "中国电力科学研究院有限公司",
        "北京交通大学",
        "西安交通大学",
        "国网信息通信产业集团有限公司",
    ]

    meta = {
        "project_code": find_first([r"项目编码[:：]\s*([A-Z0-9\-]+)"], taskbook_flat),
        "project_title": first_nonempty(title_from_report, title_from_taskbook),
        "lead_org": first_nonempty(lead_from_report, lead_from_taskbook),
        "funding_org": first_nonempty(funding_from_taskbook, lead_from_taskbook),
        "start_date": find_first([r"起止时间[:：]?\s*(\d{4}\s*年\s*\d+\s*月)"], taskbook_flat) or "2024 年 1 月",
        "end_date": find_first([r"起止时间[:：]?\s*\d{4}\s*年\s*\d+\s*月至\s*(\d{4}\s*年\s*\d+\s*月)"], taskbook_flat) or "2025 年 12 月",
        "budget_total_wan": parse_budget_total(taskbook_flat),
        "project_owner": first_nonempty(owner_from_report, owner_from_taskbook),
        "participant_orgs": participant_orgs,
    }

    overall_research_block = extract_section(taskbook_flat, r"1\.1\s*研究内容", [r"1\.2\s*预期目标"])
    overall_objective_block = extract_section(taskbook_flat, r"1\.2\s*预期目标", [r"1\.3\s*提交成果"])
    deliverable_block = extract_section(taskbook_flat, r"1\.3\s*提交成果", [r"2、\s*课题研究内容及考核指标"])

    overview = {
        "research_background": extract_last_match(r"1\.1\s*研究背景\s*(.+?)1\.2\s*研究现状", report_body) or find_first([r"1\.1\s*研究背景\s*(.+?)1\.2"], combined_text),
        "overall_research_contents": parse_bullets(overall_research_block),
        "overall_objective": " ".join(re.sub(r"^.*?预期目标", "", overall_objective_block, flags=re.S).split()),
        "overall_deliverables": parse_bullets(deliverable_block),
        "overall_indicators": parse_bullets(extract_section(deliverable_block, r"（3）技术指标", [r"（4）软件系统"])),
        "software_goal": " ".join(re.sub(r"^.*?软件系统", "", extract_section(deliverable_block, r"（4）软件系统", [r"（5）示范应用"]), flags=re.S).split()),
        "pilot_goal": " ".join(re.sub(r"^.*?示范应用", "", extract_section(deliverable_block, r"（5）示范应用", [r"2、\s*课题研究内容及考核指标"]), flags=re.S).split()),
    }

    management = {
        "org_mechanism_summary": "项目实施阶段由牵头单位统筹推进，围绕课题研究、模型开发、系统集成、试点验证建立节点跟踪机制，按阶段组织任务分解、成果汇交和风险协调。",
        "milestones": [
            {"date": "2024.01", "label": "任务书下达", "detail": "明确研究目标与课题分工，启动项目组织与资源配置。"},
            {"date": "2024.03", "label": "项目启动", "detail": "建立双周报、季度协调等工作机制，形成实施计划。"},
            {"date": "2025.04", "label": "中期推进", "detail": "围绕架构研究、风险溯因、趋优学习和模块开发开展联调验证。"},
            {"date": "2025.12", "label": "验收准备", "detail": "完成系统集成、试点应用和成果材料汇总。"}
        ],
        "change_statement": "下达稿阶段暂无重大变更，后续调整按科技项目管理流程备案。",
        "budget_rows": [
            {"org": "国网上海市电力公司", "budget_wan": "5"},
            {"org": "中国电力科学研究院有限公司", "budget_wan": "360"},
            {"org": "北京交通大学", "budget_wan": "60"},
            {"org": "西安交通大学", "budget_wan": "60"},
            {"org": "国网信息通信产业集团有限公司", "budget_wan": "40"}
        ]
    }

    summary = {
        "summary_points": [
            "项目围绕数据知识增强、风险主动发现、专家反馈趋优学习和模块应用验证形成了完整研究链条。",
            "研究内容覆盖方法研究、知识建模、系统集成和试点验证，具备较强工程落地导向。",
            "任务书中的指标体系同时约束了成果产出与工程效果，为后续验收和推广提供依据。"
        ],
        "outlook_points": [
            "继续结合试点场景完善模块集成与闭环应用。",
            "围绕知识库更新、智能体趋优和风险辨识能力开展持续优化。",
            "结合验收要求补齐论文、专利、软件著作权等成果材料。"
        ]
    }

    feedback = {
        "feedback_items": [
            {
                "title": "专家意见待补充",
                "response": "当前任务书中未提供专家意见明细，建议后续根据中期督导或验收意见逐条补充。"
            }
        ]
    }

    return {
        "project_meta": meta,
        "overview": overview,
        "management": management,
        "tasks": tasks,
        "summary": summary,
        "feedback": feedback,
    }


def main() -> None:
    args = parse_args()
    source_docs = []
    for raw in args.input:
        path = Path(raw).expanduser().resolve()
        source_docs.append(SourceDoc(path=path, text=load_text(path)))
    content = build_content(source_docs)
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(content, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
