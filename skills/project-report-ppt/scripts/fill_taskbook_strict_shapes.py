#!/usr/bin/env python3
"""Fill the original PPT by replacing whole shapes, preserving layout and theme."""

from __future__ import annotations

import argparse
from pathlib import Path

from pptx import Presentation
from pptx.enum.text import MSO_AUTO_SIZE
from pptx.util import Pt


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fill original PPT by shape index.")
    parser.add_argument("--input", required=True, help="Original PPTX path.")
    parser.add_argument("--output", required=True, help="Output PPTX path.")
    return parser.parse_args()


def set_shape_text(shape, text: str, font_size: float | None = None, autosize: bool = True) -> None:
    if not shape.has_text_frame:
        return
    frame = shape.text_frame
    orig_para = frame.paragraphs[0]
    orig_align = orig_para.alignment
    orig_run = orig_para.runs[0] if orig_para.runs else None
    orig_name = orig_run.font.name if orig_run else None
    orig_size = orig_run.font.size if orig_run and orig_run.font.size else None
    orig_bold = orig_run.font.bold if orig_run else None
    orig_italic = orig_run.font.italic if orig_run else None
    orig_color = None
    if orig_run and orig_run.font.color and orig_run.font.color.type is not None:
        try:
            orig_color = orig_run.font.color.rgb
        except Exception:
            orig_color = None
    shape.text = text
    frame.word_wrap = True
    frame.auto_size = MSO_AUTO_SIZE.TEXT_TO_FIT_SHAPE if autosize else None
    for paragraph in frame.paragraphs:
        paragraph.alignment = orig_align
        for run in paragraph.runs:
            if orig_name:
                run.font.name = orig_name
            run.font.size = Pt(font_size) if font_size is not None else orig_size
            run.font.bold = orig_bold
            run.font.italic = orig_italic
            if orig_color is not None:
                try:
                    run.font.color.rgb = orig_color
                except Exception:
                    pass


def fill_table_cell(table, row: int, col: int, text: str, font_size: float | None = None) -> None:
    cell = table.cell(row, col)
    orig_para = cell.text_frame.paragraphs[0]
    orig_align = orig_para.alignment
    orig_run = orig_para.runs[0] if orig_para.runs else None
    orig_name = orig_run.font.name if orig_run else None
    orig_size = orig_run.font.size if orig_run and orig_run.font.size else None
    orig_bold = orig_run.font.bold if orig_run else None
    orig_italic = orig_run.font.italic if orig_run else None
    orig_color = None
    if orig_run and orig_run.font.color and orig_run.font.color.type is not None:
        try:
            orig_color = orig_run.font.color.rgb
        except Exception:
            orig_color = None
    cell.text = text
    for paragraph in cell.text_frame.paragraphs:
        paragraph.alignment = orig_align
        for run in paragraph.runs:
            if orig_name:
                run.font.name = orig_name
            run.font.size = Pt(font_size) if font_size is not None else orig_size
            run.font.bold = orig_bold
            run.font.italic = orig_italic
            if orig_color is not None:
                try:
                    run.font.color.rgb = orig_color
                except Exception:
                    pass


def main() -> None:
    args = parse_args()
    input_path = Path(args.input).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)

    prs = Presentation(str(input_path))

    # Slide 1 cover
    slide = prs.slides[0]
    set_shape_text(slide.shapes[0], "基于人机协同的配网检修运行方式智能校核与编制优化关键技术研究")
    table = slide.shapes[1].table
    fill_table_cell(table, 0, 1, "金敏杰")
    fill_table_cell(table, 1, 1, "国网上海市电力公司")
    fill_table_cell(
        table,
        2,
        1,
        "中国电力科学研究院有限公司\n北京交通大学\n西安交通大学\n国网信息通信产业集团有限公司",
    )
    set_shape_text(slide.shapes[2], "2025 年 12 月")

    # Slide 3
    slide = prs.slides[2]
    slide.shapes[0].height = slide.shapes[0].height + 250000
    set_shape_text(
        slide.shapes[2],
        "面向上海超大城市配电网，检修计划编排与运行方式调整面临设备密集、约束繁杂、多专业协同难等现实挑战。人工提报、人工校核、人工协调等传统方式效率低、可追溯性弱，难以支撑多时间尺度检修计划与方式预案的高质量协同编制，亟需构建人机协同的数据知识增强与智能校核优化能力。",
        18,
        autosize=False,
    )
    set_shape_text(slide.shapes[9], "以上海配网检修业务为例")

    # Slide 4
    slide = prs.slides[3]
    slide.shapes[1].height = slide.shapes[1].height + 220000
    set_shape_text(
        slide.shapes[2],
        "项目聚焦人机协同的智能校核和编制优化关键技术，融合配电网状态计算、安全校核、检修计划报送与预案编制领域知识，建立数据知识融合的智能决策推理与演化模型，实现检修计划与运行方式的可信、安全、高效智能编制。",
        18,
        autosize=False,
    )
    set_shape_text(slide.shapes[8], "支撑检修计划智能编排")

    # Slide 5
    slide = prs.slides[4]
    set_shape_text(slide.shapes[23], "检修编排存在多专业协同难")
    set_shape_text(slide.shapes[25], "先验知识建模与增强")
    set_shape_text(slide.shapes[28], "风险主动发现与溯因")
    set_shape_text(slide.shapes[29], "人机协同共性服务")
    set_shape_text(
        slide.shapes[31],
        "融合配网状态计算、安全校核、检修计划报送与预案编制领域知识，建立数据知识融合的智能决策推理与演化模型。",
        autosize=False,
    )

    # Slide 7 organization
    slide = prs.slides[6]
    slide.shapes[1].height = slide.shapes[1].height + 120000
    set_shape_text(
        slide.shapes[2],
        "项目采用“上海公司牵头、课题单位协同、专家咨询支撑”的组织模式，持续推进实施方案、课题攻关、模块研发与试点验证。",
        18,
        autosize=False,
    )
    set_shape_text(slide.shapes[6], "项目顾问：专家咨询机制（待补充专家名单）")
    set_shape_text(slide.shapes[8], "课题 1")
    set_shape_text(slide.shapes[9], "课题 2")
    set_shape_text(slide.shapes[12], "课题 3 / 4")

    # Slide 8 management
    slide = prs.slides[7]
    slide.shapes[1].height = slide.shapes[1].height + 220000
    set_shape_text(
        slide.shapes[2],
        "项目已形成课题实施方案和协同工作机制，围绕实施方案、阶段检查、月度交底、季度讨论和专家咨询评审，动态优化任务分工、技术路线、接口协同和应用验证安排。",
        18,
        autosize=False,
    )
    set_shape_text(slide.shapes[6], "项目过程管理")
    set_shape_text(slide.shapes[7], "实施方案与阶段检查")

    # Slide 9 timeline
    slide = prs.slides[8]
    set_shape_text(slide.shapes[2], "任务书下达后，项目启动并完成研究方案与实施路径设计，明确总体分工。")
    set_shape_text(slide.shapes[3], "围绕架构研究、风险溯因、趋优学习和模块应用四条主线，分阶段推进研究与验证工作。")
    timeline = ["2024.1", "2024.3", "2024.12", "2025.6", "2025.9", "2025.12"]
    for shape_idx, text in zip([6, 7, 8, 9, 10, 11], timeline):
        set_shape_text(slide.shapes[shape_idx], text)
    set_shape_text(slide.shapes[16], "1. 下达任务书")
    set_shape_text(slide.shapes[17], "2. 启动项目，形成实施方案")
    set_shape_text(slide.shapes[18], "开展课题调研与关键方法研究")
    set_shape_text(slide.shapes[19], "3. 核心方法研究")
    set_shape_text(slide.shapes[20], "完成原型开发与训练测试")
    set_shape_text(slide.shapes[21], "4. 系统集成与试点验证")
    set_shape_text(slide.shapes[22], "推进接口联调与场景验证")
    set_shape_text(slide.shapes[23], "5. 准备验收材料")
    set_shape_text(slide.shapes[24], "完成结题验收准备")
    set_shape_text(slide.shapes[25], "6. 项目验收")

    # Slide 10 changes
    slide = prs.slides[9]
    slide.shapes[1].height = slide.shapes[1].height + 180000
    set_shape_text(
        slide.shapes[2],
        "任务书下达稿阶段暂无重大变更事项。后续如发生负责人、经费或实施计划调整，将按国家电网科技项目管理流程履行备案。",
        autosize=False,
    )

    # Slide 11 budget
    slide = prs.slides[10]
    slide.shapes[1].height = slide.shapes[1].height + 260000
    set_shape_text(
        slide.shapes[2],
        "项目总预算 525.00 万元。根据任务书，国网上海市电力公司预算 5 万元，中国电力科学研究院有限公司 360 万元，北京交通大学 60 万元，西安交通大学 60 万元，国网信息通信产业集团有限公司 40 万元。累计支出和预算执行率待后续财务数据更新。",
        18,
        autosize=False,
    )
    table = slide.shapes[6].table
    rows = [
        ("国网上海市电力公司", "5", "待更新", "待更新"),
        ("中国电力科学研究院有限公司", "360", "待更新", "待更新"),
        ("北京交通大学", "60", "待更新", "待更新"),
        ("西安交通大学", "60", "待更新", "待更新"),
        ("国网信息通信产业集团有限公司", "40", "待更新", "待更新"),
        ("总计", "525", "待更新", "待更新"),
    ]
    for r, values in enumerate(rows, start=1):
        for c, value in enumerate(values):
            fill_table_cell(table, r, c, value, 11)

    # Slide 17
    slide = prs.slides[16]
    slide.shapes[2].height = slide.shapes[2].height + 260000
    set_shape_text(
        slide.shapes[3],
        "本项目围绕“数据知识增强架构、风险主动发现与溯因、专家反馈趋优学习、智能校核与编制优化模块开发应用”四个方向展开，形成从知识建模到应用验证的闭环研究链路。",
        18,
        autosize=False,
    )

    output_path = Path(args.output).expanduser().resolve()
    prs.save(str(output_path))


if __name__ == "__main__":
    main()
