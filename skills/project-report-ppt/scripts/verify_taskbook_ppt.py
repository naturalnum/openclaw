#!/usr/bin/env python3
"""Regression checks for the taskbook-filled PPT."""

from __future__ import annotations

import argparse
from dataclasses import dataclass
import math
from pathlib import Path
import re
from zipfile import ZipFile
import xml.etree.ElementTree as ET


NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}
EMPHASIS_COLOR = "C00000"
SECTION_TITLE_FONT_SIZE = "3200"
PAGE_SUBTITLE_FONT_SIZE = "2800"
COURSE_SUBTITLE_FONT_SIZE = "1800"
RESEARCH_HEADING_FONT_SIZE = "1800"
MAIN_BODY_FONT_SIZE = "1800"
MIN_BODY_VISUAL_GAP = 240000
BODY_BG_TOP_PAD = 0
BODY_BG_BOTTOM_PAD = 0
MIN_SUBTITLE_HEADING_GAP = 70000
MIN_GLOBAL_BODY_VISUAL_GAP = 180000
MIN_BODY_BG_MARGIN = 0
TEMPLATE_BODY_CY_FLOOR_RATIO = 0.2
TEMPLATE_BG_CY_FLOOR_RATIO = 0.35
TEMPLATE_PATH = Path("/Users/star/code/myskills/tmp/20260127.pptx")
FORBIDDEN_TEMPLATE_RESIDUES = {
    "山东",
    "临沂",
    "泰州",
    "纽约电网仿真环境",
    "全球能源互联网美国研究院",
    "国网江苏电力省级计算推演平台架构",
    "企业级电网智能计算推演",
    "电网高维异构图",
    "多时空推演",
    "源荷预测",
    "天津大学",
    "朱琼锋",
    "米翰宁",
    "16人",
    "Kubernetes01",
    "StatefulSet",
    "Deployment",
    "ConfigMap",
    "Secret",
}
ALLOWED_TEMPLATE_OVERLAPS = {
    "2024.1",
    "2024.3",
    "2024.12",
    "2025.6",
    "2025.9",
    "2025.12",
    "2025年12月",
    "源",
    "网",
    "荷",
    "储",
    "",
    "...",
}
FULL_TEMPLATE_SLIDES = {2, 12, 16, 56, 59, 61}
DIAGRAM_EXCLUDED_SHAPE_NAMES = {"标题 4", "矩形 107", "矩形 7", "矩形 16", "矩形 8", "Slide Number Placeholder 5", "灯片编号占位符 3"}
TEMPLATE_BASELINE_FONT_SLIDES = {3, 4, 5, 7, 13, 14, 53, 57}


@dataclass
class CheckFailure:
    name: str
    detail: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verify generated taskbook PPT.")
    parser.add_argument("--pptx", required=True, help="Generated PPTX path")
    return parser.parse_args()


class Deck:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.zip = ZipFile(path)

    def slide_root(self, slide_no: int) -> ET.Element:
        return ET.fromstring(self.zip.read(f"ppt/slides/slide{slide_no}.xml"))

    def slide_texts(self, slide_no: int) -> list[tuple[int, str]]:
        root = self.slide_root(slide_no)
        out: list[tuple[int, str]] = []
        for i, sp in enumerate(root.findall(".//p:sp", NS)):
            txt = "".join(t.text or "" for t in sp.findall(".//a:t", NS)).strip()
            if txt:
                out.append((i, txt))
        return out

    def slide_all_text(self, slide_no: int) -> str:
        root = self.slide_root(slide_no)
        return "".join(t.text or "" for t in root.findall(".//a:t", NS)).strip()

    def close(self) -> None:
        self.zip.close()

    def all_texts(self) -> list[str]:
        items: list[str] = []
        for slide_no in range(1, 62):
            try:
                text = self.slide_all_text(slide_no)
                if text:
                    items.append(text)
            except KeyError:
                continue
        return items


def shape_text(sp: ET.Element) -> str:
    return "".join(t.text or "" for t in sp.findall(".//a:t", NS)).strip()


def shape_name(sp: ET.Element) -> str:
    c_nv_pr = sp.find("./p:nvSpPr/p:cNvPr", NS)
    return c_nv_pr.get("name", "") if c_nv_pr is not None else ""


def shape_box(sp: ET.Element) -> tuple[int, int, int, int] | None:
    xfrm = sp.find("./p:spPr/a:xfrm", NS)
    off = xfrm.find("./a:off", NS) if xfrm is not None else None
    ext = xfrm.find("./a:ext", NS) if xfrm is not None else None
    if off is None or ext is None:
        return None
    return (
        int(off.get("x", "0")),
        int(off.get("y", "0")),
        int(ext.get("cx", "0")),
        int(ext.get("cy", "0")),
    )


def find_body_background(root: ET.Element, body_shape: ET.Element) -> tuple[int, int, int, int] | None:
    body_box = shape_box(body_shape)
    if body_box is None:
        return None
    bx, by, bcx, _ = body_box
    body_mid_x = bx + bcx / 2
    best: tuple[float, tuple[int, int, int, int]] | None = None
    for sp in root.findall(".//p:sp", NS):
        if sp is body_shape:
            continue
        if shape_text(sp):
            continue
        box = shape_box(sp)
        if box is None:
            continue
        x, y, cx, cy = box
        if cx < 7000000 or cy < 700000:
            continue
        horizontal_overlap = min(bx + bcx, x + cx) - max(bx, x)
        if horizontal_overlap <= bcx * 0.65:
            continue
        if abs((x + cx / 2) - body_mid_x) > 500000:
            continue
        if y > by + 250000:
            continue
        if y + cy < by + 500000:
            continue
        score = abs(y - by) + abs(cx - bcx) + abs(x - bx)
        if best is None or score < best[0]:
            best = (score, box)
    return best[1] if best else None


def all_font_sizes(sp: ET.Element) -> set[str]:
    return {node.get("sz") for node in sp.findall(".//a:rPr", NS) if node.get("sz")}


def first_font_size(sp: ET.Element) -> str | None:
    first = sp.find(".//a:r/a:rPr", NS)
    if first is None:
        return None
    return first.get("sz")


def has_red_emphasis(sp: ET.Element) -> bool:
    for r_pr in sp.findall(".//a:rPr", NS):
        srgb = r_pr.find("./a:solidFill/a:srgbClr", NS)
        if srgb is not None and srgb.get("val") == EMPHASIS_COLOR:
            return True
    return False


def visual_top_candidates(root: ET.Element) -> list[int]:
    tops: list[int] = []
    for tag in ("sp", "pic", "grpSp", "graphicFrame"):
        for node in root.findall(f".//p:{tag}", NS):
            if tag == "grpSp":
                xfrm = node.find("./p:grpSpPr/a:xfrm", NS)
            elif tag == "graphicFrame":
                xfrm = node.find("./p:xfrm", NS)
            else:
                xfrm = node.find("./p:spPr/a:xfrm", NS)
            off = xfrm.find("./a:off", NS) if xfrm is not None else None
            if off is None:
                continue
            tops.append(int(off.get("y", "0")))
    return tops


def body_overlap_gap(root: ET.Element, body_prefix: str) -> int | None:
    body_bottom = None
    tops = visual_top_candidates(root)
    for sp in root.findall(".//p:sp", NS):
        txt = shape_text(sp)
        if not txt.startswith(body_prefix):
            continue
        box = shape_box(sp)
        if box is None:
            continue
        _, y, _, cy = box
        body_bottom = y + cy
        break
    if body_bottom is None:
        return None
    lower = [top for top in tops if top > body_bottom]
    if not lower:
        return None
    return min(lower) - body_bottom


def min_body_overlap_gap(root: ET.Element) -> int | None:
    gaps: list[int] = []
    tops = visual_top_candidates(root)
    shape_rows = []
    for sp in root.findall(".//p:sp", NS):
        txt = shape_text(sp)
        box = shape_box(sp)
        if box is None:
            continue
        name = shape_name(sp)
        _, y, _, cy = box
        shape_rows.append((name, txt, y, cy))
    for name, txt, y, cy in shape_rows:
        if name != "矩形 7" or len(txt) < 40:
            continue
        lower = [top for top in tops if top > y + 100000]
        for _, other_txt, oy, _ in shape_rows:
            if oy <= y + 100000:
                continue
            if other_txt and len(other_txt) >= 25:
                continue
            lower.append(oy)
        if lower:
            gaps.append(min(lower) - (y + cy))
    return min(gaps) if gaps else None


def check_slide10(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    texts = [txt for _, txt in deck.slide_texts(10)]
    merged = "".join(texts)
    if "暂无重大变更" not in merged or "科技项目管理流程" not in merged:
        failures.append(CheckFailure("slide10-change-text", "第10页未完整替换为“暂无重大变更事项”文案。"))
    for bad in ("天津大学", "16人", "3负责人", "原课题3"):
        if bad in merged:
            failures.append(CheckFailure("slide10-template-residue", f"第10页仍残留模板旧内容：{bad}"))
    return failures


def check_template_scaffold(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    template = Deck(TEMPLATE_PATH)
    try:
        for slide_no in FULL_TEMPLATE_SLIDES:
            if deck.slide_texts(slide_no) != template.slide_texts(slide_no):
                failures.append(CheckFailure("template-slide-scaffold", f"第{slide_no}页目录/固定页未保持模板原文。"))
        for slide_no in range(1, 62):
            try:
                template_root = template.slide_root(slide_no)
                deck_root = deck.slide_root(slide_no)
            except KeyError:
                continue
            t_titles = [shape_text(sp) for sp in template_root.findall(".//p:sp", NS) if shape_name(sp) == "标题 4"]
            d_titles = [shape_text(sp) for sp in deck_root.findall(".//p:sp", NS) if shape_name(sp) == "标题 4"]
            if t_titles != d_titles:
                failures.append(CheckFailure("template-title-scaffold", f"第{slide_no}页章节标题未沿用模板。"))
    finally:
        template.close()
    return failures


def check_slide11_table(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    merged = "".join(txt for _, txt in deck.slide_texts(11))
    if "待更新00%" in merged:
        failures.append(CheckFailure("slide11-updating-cell", "第11页仍存在“待更新00%”残留。"))
    return failures


def check_uniform_heading_fonts(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    template = Deck(TEMPLATE_PATH)
    for slide_no in range(1, 61):
        root = deck.slide_root(slide_no)
        template_root = template.slide_root(slide_no)
        template_shapes = template_root.findall(".//p:sp", NS)
        deck_shapes = root.findall(".//p:sp", NS)
        for idx, sp in enumerate(deck_shapes):
            txt = shape_text(sp)
            name = shape_name(sp)
            expected_template_size = None
            if slide_no in TEMPLATE_BASELINE_FONT_SLIDES and idx < len(template_shapes):
                expected_template_size = first_font_size(template_shapes[idx])
            if name == "标题 4":
                sizes = all_font_sizes(sp)
                expected = {expected_template_size} if expected_template_size else {SECTION_TITLE_FONT_SIZE}
                if sizes != expected:
                    failures.append(CheckFailure("section-title-font", f"第{slide_no}页大标题字号不统一：{sorted(sizes)}"))
            if txt.startswith(("研究内容", "内容")) and "：" in txt:
                sizes = all_font_sizes(sp)
                if sizes != {RESEARCH_HEADING_FONT_SIZE}:
                    failures.append(CheckFailure("research-heading-font", f"第{slide_no}页研究内容横条字号不统一：{sorted(sizes)}"))
            if name == "矩形 107" and txt.startswith(("课题", "创新点", "专家意见")):
                sizes = all_font_sizes(sp)
                expected = {expected_template_size} if expected_template_size else {COURSE_SUBTITLE_FONT_SIZE}
                if sizes != expected:
                    failures.append(CheckFailure("subtitle-font", f"第{slide_no}页副标题字号不统一：{sorted(sizes)}"))
            elif name == "矩形 107":
                sizes = all_font_sizes(sp)
                expected = {expected_template_size} if expected_template_size else {PAGE_SUBTITLE_FONT_SIZE}
                if sizes and sizes != expected:
                    failures.append(CheckFailure("page-subtitle-font", f"第{slide_no}页页内副标题字号不统一：{sorted(sizes)}"))
                body_pr = sp.find('./p:txBody/a:bodyPr', NS)
                if body_pr is not None and body_pr.get("wrap") not in {None, "none"}:
                    failures.append(CheckFailure("page-subtitle-wrap", f"第{slide_no}页页内副标题不应换行：{txt}"))
            if name == "矩形 7" and len(txt) >= 40:
                sizes = all_font_sizes(sp)
                expected = {expected_template_size} if expected_template_size else {MAIN_BODY_FONT_SIZE}
                if sizes != expected:
                    failures.append(CheckFailure("body-font", f"第{slide_no}页主正文字号不统一：{sorted(sizes)}"))
    template.close()
    return failures


def check_no_red_in_headings(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    protected_shape_names = {"标题 4", "矩形 107", "矩形 16"}
    for slide_no in range(1, 61):
        root = deck.slide_root(slide_no)
        for sp in root.findall(".//p:sp", NS):
            txt = shape_text(sp)
            name = shape_name(sp)
            if not txt:
                continue
            if name in protected_shape_names:
                if has_red_emphasis(sp):
                    failures.append(CheckFailure("red-heading-text", f"第{slide_no}页标题/副标题区域不应标红：{txt[:40]}"))
    return failures


def check_body_gaps(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    cases = [17, 22, 26]
    for slide_no in cases:
        root = deck.slide_root(slide_no)
        gap = min_body_overlap_gap(root)
        if gap is not None and gap < MIN_BODY_VISUAL_GAP:
            failures.append(CheckFailure("body-visual-gap", f"第{slide_no}页正文区与下方图形区间距不足：{gap}"))
    return failures


def check_all_body_visual_gaps(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        try:
            root = deck.slide_root(slide_no)
        except KeyError:
            continue
        tops = visual_top_candidates(root)
        shape_rows = []
        for sp in root.findall(".//p:sp", NS):
            txt = shape_text(sp)
            box = shape_box(sp)
            if box is None:
                continue
            name = shape_name(sp)
            _, y, _, cy = box
            shape_rows.append((sp, name, txt, y, cy))
        for _, name, txt, y, cy in shape_rows:
            if name != "矩形 7" or len(txt) < 40:
                continue
            lower = [top for top in tops if top > y + 100000]
            for _, _, other_txt, oy, _ in shape_rows:
                if oy <= y + 100000:
                    continue
                if other_txt and len(other_txt) >= 25:
                    continue
                lower.append(oy)
            if not lower:
                continue
            gap = min(lower) - (y + cy)
            if gap < MIN_GLOBAL_BODY_VISUAL_GAP:
                failures.append(CheckFailure("body-visual-overlap-global", f"第{slide_no}页正文区与下方图形区间距不足：{gap}"))
    return failures


def check_body_inside_background(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        try:
            root = deck.slide_root(slide_no)
        except KeyError:
            continue
        for sp in root.findall(".//p:sp", NS):
            txt = shape_text(sp)
            if shape_name(sp) != "矩形 7" or len(txt) < 40:
                continue
            body_box = shape_box(sp)
            bg_box = find_body_background(root, sp)
            if body_box is None or bg_box is None:
                continue
            _, body_y, _, body_cy = body_box
            _, bg_y, _, bg_cy = bg_box
            if body_y < bg_y + BODY_BG_TOP_PAD:
                failures.append(CheckFailure("body-outside-background", f"第{slide_no}页正文顶部超出背景框。"))
            if body_y + body_cy > bg_y + bg_cy - BODY_BG_BOTTOM_PAD:
                failures.append(CheckFailure("body-outside-background", f"第{slide_no}页正文底部超出背景框。"))
            top_margin = body_y - bg_y
            bottom_margin = (bg_y + bg_cy) - (body_y + body_cy)
            if top_margin < MIN_BODY_BG_MARGIN or bottom_margin < MIN_BODY_BG_MARGIN:
                failures.append(CheckFailure("body-background-margin", f"第{slide_no}页正文与背景框留白不足：top={top_margin}, bottom={bottom_margin}"))
    return failures


def check_body_background_template_baseline(deck: Deck, template_deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        try:
            root = deck.slide_root(slide_no)
            template_root = template_deck.slide_root(slide_no)
        except KeyError:
            continue
        current_bodies = [sp for sp in root.findall(".//p:sp", NS) if shape_name(sp) == "矩形 7" and shape_text(sp)]
        template_bodies = [sp for sp in template_root.findall(".//p:sp", NS) if shape_name(sp) == "矩形 7" and shape_text(sp)]
        if not current_bodies or not template_bodies:
            continue
        current_body = current_bodies[0]
        template_body = template_bodies[0]
        current_body_box = shape_box(current_body)
        template_body_box = shape_box(template_body)
        current_bg_box = find_body_background(root, current_body)
        template_bg_box = find_body_background(template_root, template_body)
        if current_body_box is None or template_body_box is None or current_bg_box is None or template_bg_box is None:
            continue
        _, _, _, current_body_cy = current_body_box
        _, _, _, template_body_cy = template_body_box
        _, _, _, current_bg_cy = current_bg_box
        _, _, _, template_bg_cy = template_bg_box
        if current_body_cy < int(template_body_cy * TEMPLATE_BODY_CY_FLOOR_RATIO):
            failures.append(CheckFailure("body-template-baseline", f"第{slide_no}页正文框高度被压缩过度：{current_body_cy} < {template_body_cy}*{TEMPLATE_BODY_CY_FLOOR_RATIO}"))
        if current_bg_cy < int(template_bg_cy * TEMPLATE_BG_CY_FLOOR_RATIO):
            failures.append(CheckFailure("background-template-baseline", f"第{slide_no}页背景框高度被压缩过度：{current_bg_cy} < {template_bg_cy}*{TEMPLATE_BG_CY_FLOOR_RATIO}"))
    return failures


def estimate_required_body_height(sp: ET.Element) -> int | None:
    txt = shape_text(sp)
    box = shape_box(sp)
    if not txt or box is None:
        return None
    _, _, cx, _ = box
    body_pr = sp.find("./p:txBody/a:bodyPr", NS)
    l_ins = int(body_pr.get("lIns", "0")) if body_pr is not None and body_pr.get("lIns") else 0
    r_ins = int(body_pr.get("rIns", "0")) if body_pr is not None and body_pr.get("rIns") else 0
    t_ins = int(body_pr.get("tIns", "0")) if body_pr is not None and body_pr.get("tIns") else 0
    b_ins = int(body_pr.get("bIns", "0")) if body_pr is not None and body_pr.get("bIns") else 0
    sizes: list[int] = []
    for node in sp.findall(".//a:rPr", NS) + sp.findall(".//a:defRPr", NS):
        sz = node.get("sz")
        if sz and sz.isdigit():
            sizes.append(int(sz))
    font_pt = (max(sizes) if sizes else 1800) / 100
    font_emu = font_pt * 12700
    usable = max(cx - l_ins - r_ins, 1)
    char_width = font_emu * 0.95
    chars_per_line = max(int(usable / char_width), 1)
    line_count = 0
    paras = sp.findall("./p:txBody/a:p", NS)
    if not paras:
        paras = [sp]
    for para in paras:
        ptxt = "".join(t.text or "" for t in para.findall(".//a:t", NS))
        if not ptxt.strip():
            continue
        line_count += max(1, math.ceil(len(ptxt) / chars_per_line))
    line_count = max(line_count, 1)
    return int(line_count * font_emu * 1.35 + t_ins + b_ins + 40000)


def estimate_shape_overflow(sp: ET.Element) -> tuple[str, int] | None:
    txt = shape_text(sp)
    box = shape_box(sp)
    if not txt or box is None:
        return None
    _, _, cx, cy = box
    body_pr = sp.find("./p:txBody/a:bodyPr", NS)
    l_ins = int(body_pr.get("lIns", "0")) if body_pr is not None and body_pr.get("lIns") else 0
    r_ins = int(body_pr.get("rIns", "0")) if body_pr is not None and body_pr.get("rIns") else 0
    t_ins = int(body_pr.get("tIns", "0")) if body_pr is not None and body_pr.get("tIns") else 0
    b_ins = int(body_pr.get("bIns", "0")) if body_pr is not None and body_pr.get("bIns") else 0
    wrap = body_pr.get("wrap") if body_pr is not None else None
    sizes: list[int] = []
    for node in sp.findall(".//a:rPr", NS) + sp.findall(".//a:defRPr", NS):
        sz = node.get("sz")
        if sz and sz.isdigit():
            sizes.append(int(sz))
    font_pt = (max(sizes) if sizes else 1400) / 100
    font_emu = font_pt * 12700
    if wrap == "none":
        required = int(len(txt) * font_emu * 0.95 + l_ins + r_ins)
        overflow = required - cx
        return ("width", overflow) if overflow > 160000 else None
    usable = max(cx - l_ins - r_ins, 1)
    chars_per_line = max(int(usable / (font_emu * 0.95)), 1)
    line_count = 0
    paras = sp.findall("./p:txBody/a:p", NS)
    if not paras:
        paras = [sp]
    for para in paras:
        ptxt = "".join(t.text or "" for t in para.findall(".//a:t", NS))
        if not ptxt.strip():
            continue
        line_count += max(1, math.ceil(len(ptxt) / chars_per_line))
    line_count = max(line_count, 1)
    required = int(line_count * font_emu * 1.2 + t_ins + b_ins + 20000)
    overflow = required - cy
    return ("height", overflow) if overflow > 120000 else None


def check_body_text_fits_textbox(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        try:
            root = deck.slide_root(slide_no)
        except KeyError:
            continue
        for sp in root.findall(".//p:sp", NS):
            if shape_name(sp) != "矩形 7":
                continue
            txt = shape_text(sp)
            if len(txt) < 20:
                continue
            box = shape_box(sp)
            required = estimate_required_body_height(sp)
            if box is None or required is None:
                continue
            _, _, _, cy = box
            if required > cy:
                failures.append(CheckFailure("body-text-overflow", f"第{slide_no}页正文文本框高度不足：need={required}, actual={cy}"))
    return failures


def check_diagram_text_fits_shapes(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        if slide_no < 18 or slide_no > 55:
            continue
        if slide_no in FULL_TEMPLATE_SLIDES:
            continue
        try:
            root = deck.slide_root(slide_no)
        except KeyError:
            continue
        for sp in root.findall(".//p:sp", NS):
            name = shape_name(sp)
            txt = shape_text(sp)
            if not txt or name in DIAGRAM_EXCLUDED_SHAPE_NAMES:
                continue
            if txt.startswith(("研究内容", "内容", "课题", "创新点", "专家意见")):
                continue
            if len(txt) < 7:
                continue
            box = shape_box(sp)
            if box is None:
                continue
            _, _, cx, cy = box
            if cx > 5000000 and cy > 800000:
                continue
            if cx < 600000:
                continue
            if cy > 900000:
                continue
            overflow = estimate_shape_overflow(sp)
            if overflow is not None:
                axis, amount = overflow
                failures.append(CheckFailure("diagram-text-overflow", f"第{slide_no}页图表文字框{axis}向溢出：{amount}，内容={txt[:40]}"))
    return failures


def check_subtitle_heading_gaps(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for slide_no in range(1, 62):
        try:
            root = deck.slide_root(slide_no)
        except KeyError:
            continue
        subtitles = []
        headings = []
        for sp in root.findall(".//p:sp", NS):
            txt = shape_text(sp)
            name = shape_name(sp)
            box = shape_box(sp)
            if not txt or box is None:
                continue
            if name == "矩形 107":
                subtitles.append((txt, box))
            if txt.startswith(("研究内容", "内容")) and "：" in txt:
                headings.append((txt, box))
        for _, (sx, sy, scx, scy) in subtitles:
            for heading_txt, (hx, hy, hcx, hcy) in headings:
                if hy <= sy:
                    continue
                overlap = min(sx + scx, hx + hcx) - max(sx, hx)
                if overlap <= min(scx, hcx) * 0.4:
                    continue
                gap = hy - (sy + scy)
                if gap < MIN_SUBTITLE_HEADING_GAP:
                    failures.append(CheckFailure("subtitle-heading-gap", f"第{slide_no}页副标题与研究内容横条间距不足：{gap}，{heading_txt[:40]}"))
    return failures


def check_patent_pages(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    merged = "".join(deck.slide_all_text(slide) for slide in (51, 52, 53))
    for bad in ("论文6篇", "6篇", "11项", "软件著作权1项", "总报告1份", "技术报告4份"):
        if bad in merged:
            failures.append(CheckFailure("成果页明细泄漏", f"第51-53页仍包含不应写死的成果数量：{bad}"))
    return failures


def check_no_template_text_residue(deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    for text in deck.all_texts():
        if any(token in text for token in FORBIDDEN_TEMPLATE_RESIDUES):
            failures.append(CheckFailure("template-text-residue", f"仍残留旧项目/模板专属文案：{text[:60]}"))
    return failures


def run_checks(deck: Deck, template_deck: Deck) -> list[CheckFailure]:
    failures: list[CheckFailure] = []
    failures.extend(check_template_scaffold(deck))
    failures.extend(check_slide10(deck))
    failures.extend(check_slide11_table(deck))
    failures.extend(check_uniform_heading_fonts(deck))
    failures.extend(check_no_red_in_headings(deck))
    failures.extend(check_body_gaps(deck))
    failures.extend(check_all_body_visual_gaps(deck))
    failures.extend(check_body_inside_background(deck))
    failures.extend(check_body_background_template_baseline(deck, template_deck))
    failures.extend(check_body_text_fits_textbox(deck))
    failures.extend(check_diagram_text_fits_shapes(deck))
    failures.extend(check_subtitle_heading_gaps(deck))
    failures.extend(check_patent_pages(deck))
    failures.extend(check_no_template_text_residue(deck))
    return failures


def main() -> None:
    args = parse_args()
    deck = Deck(Path(args.pptx).expanduser().resolve())
    template_deck = Deck(TEMPLATE_PATH)
    try:
        failures = run_checks(deck, template_deck)
    finally:
        deck.close()
        template_deck.close()

    if failures:
        for failure in failures:
            print(f"[FAIL] {failure.name}: {failure.detail}")
        raise SystemExit(1)

    print("[PASS] 回归测试通过")


if __name__ == "__main__":
    main()
