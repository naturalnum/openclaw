#!/usr/bin/env python3
"""Build a sectioned generation plan for a project report PPT."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


SECTION_RULES = [
    {
        "id": "basic_info",
        "title": "项目基本情况",
        "keywords": ["项目概况", "项目背景", "立项背景", "基本情况", "组织管理", "项目经费", "执行情况"],
        "target_slides": "封面、目录、项目背景、项目信息、组织管理、进度和经费页",
    },
    {
        "id": "research_progress",
        "title": "国内外研究进展",
        "keywords": ["国内外", "研究进展", "现状", "对比", "相关工作", "技术路线"],
        "target_slides": "研究现状、差距分析、技术演进页",
    },
    {
        "id": "results",
        "title": "完成情况及主要创新成果",
        "keywords": ["研究内容", "完成情况", "成果", "创新", "论文", "专利", "系统", "试点", "应用验证"],
        "target_slides": "课题拆解、方法方案、实验验证、指标完成、论文专利页",
    },
    {
        "id": "summary",
        "title": "总结与展望",
        "keywords": ["总结", "展望", "后续", "推广", "下一步"],
        "target_slides": "项目总结、推广价值、下一步计划页",
    },
    {
        "id": "qa",
        "title": "专家意见回应",
        "keywords": ["专家意见", "整改", "回应", "咨询建议"],
        "target_slides": "专家意见与整改闭环页",
    },
]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a JSON generation plan for a fixed-format project report PPT."
    )
    parser.add_argument("--input", required=True, help="Source text file: txt, md, or extracted text.")
    parser.add_argument(
        "--title",
        default="待补充项目标题",
        help="Project title used in the cover metadata.",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output JSON path for the generation plan.",
    )
    return parser.parse_args()


def split_blocks(text: str) -> list[str]:
    chunks = re.split(r"\n\s*\n+", text)
    blocks = []
    for chunk in chunks:
        normalized = " ".join(chunk.split())
        if normalized:
            blocks.append(normalized)
    return blocks


def score_block(block: str, keywords: list[str]) -> int:
    return sum(block.count(keyword) for keyword in keywords)


def select_evidence(blocks: list[str], keywords: list[str], limit: int = 5) -> list[str]:
    ranked = sorted(
        ((score_block(block, keywords), block) for block in blocks),
        key=lambda item: item[0],
        reverse=True,
    )
    chosen = [block for score, block in ranked if score > 0][:limit]
    if chosen:
        return chosen
    return blocks[: min(limit, len(blocks))]


def build_plan(title: str, source_text: str) -> dict[str, Any]:
    blocks = split_blocks(source_text)
    sections = []
    for rule in SECTION_RULES:
        evidence = select_evidence(blocks, rule["keywords"])
        sections.append(
            {
                "id": rule["id"],
                "title": rule["title"],
                "target_slides": rule["target_slides"],
                "keywords": rule["keywords"],
                "evidence_blocks": evidence,
                "llm_tasks": [
                    "提炼该章节的 1 句主标题和 3-5 条关键结论",
                    "将长段落改写为适合 PPT 的短句、短标题和要点式表达",
                    "如模板原页存在示例正文，全部替换为输入材料支持的内容",
                ],
            }
        )

    return {
        "project_title": title,
        "output_file": "./edited.pptx",
        "workflow_contract": {
            "content_source": "All substantive content must come from the input material.",
            "format_source": "Use the fixed PPT template for section rhythm, layout, fonts, and visual style.",
            "forbidden": [
                "Do not copy template body text as project content.",
                "Do not invent unsupported metrics or milestones.",
                "Do not cram excessive prose into a single slide.",
            ],
        },
        "sections": sections,
    }


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    source_text = input_path.read_text(encoding="utf-8")
    plan = build_plan(args.title, source_text)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
