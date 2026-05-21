#!/usr/bin/env python3
"""Validate the v2 content JSON and page manifest before PPT rendering."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Validate v2 project content and page manifest.")
    parser.add_argument("--schema", required=True, help="Path to page-schema.json")
    parser.add_argument("--content", required=True, help="Path to project-content.json")
    parser.add_argument("--manifest", required=True, help="Path to page-manifest-v2.json")
    return parser.parse_args()


def load_json(path: str) -> dict[str, Any]:
    return json.loads(Path(path).expanduser().resolve().read_text(encoding="utf-8"))


def fail(msg: str) -> None:
    print(f"[FAIL] {msg}")
    sys.exit(1)


def main() -> None:
    args = parse_args()
    schema = load_json(args.schema)
    content = load_json(args.content)
    manifest = load_json(args.manifest)

    slide_numbers = []
    for entry in schema["slide_map"]:
        slide_numbers.extend(entry["slides"])
    expected = sorted(slide_numbers)
    actual = sorted(item["slide"] for item in manifest["slide_manifest"])

    if expected != actual:
        fail("page manifest slide coverage does not match page schema")

    tasks = content.get("tasks", [])
    if len(tasks) != 4:
        fail(f"expected 4 tasks, got {len(tasks)}")

    for field in ["project_title", "lead_org", "funding_org", "project_owner"]:
        if not content["project_meta"].get(field):
            fail(f"missing project_meta.{field}")

    for task in tasks:
        if not task.get("task_title"):
            fail(f"task {task.get('task_number')} missing task_title")
        if len(task.get("owners", [])) < 2:
            fail(f"task {task.get('task_number')} missing clean task owners")
        if len(task.get("research_contents", [])) < 3:
            fail(f"task {task.get('task_number')} has too few research contents")
        if len(task.get("indicators", [])) < 1:
            fail(f"task {task.get('task_number')} has no indicators")

    for item in manifest["slide_manifest"]:
        page_type = item["page_type"]
        dynamic = item.get("dynamic_content", {})
        if page_type == "cover" and not dynamic.get("project_title"):
            fail("cover page missing project_title")
        if page_type == "task-subtitle-page" and not dynamic.get("task_title"):
            fail(f"slide {item['slide']} missing task_title")
        if page_type == "task-route-page" and not (
            dynamic.get("task_title") and dynamic.get("route_title") and dynamic.get("route_summary")
        ):
            fail(f"slide {item['slide']} missing route page payload")
        if page_type == "task-research-page" and not (
            dynamic.get("research_item_title") or dynamic.get("body_summary")
        ):
            fail(f"slide {item['slide']} missing research content payload")
        if page_type == "task-research-page":
            research_title = dynamic.get("research_item_title", "")
            if len(research_title) > 18:
                fail(f"slide {item['slide']} research_item_title too long for stable single-line rendering")
            if any(flag in research_title for flag in ["研究", "；", "。"]) and len(research_title) > 10:
                fail(f"slide {item['slide']} research_item_title still looks like raw source text")
            if len(dynamic.get("body_summary", "")) > 72:
                fail(f"slide {item['slide']} body_summary too long for current body box strategy")
        if page_type == "task-route-page":
            if len(dynamic.get("route_title", "")) > 18:
                fail(f"slide {item['slide']} route_title too long for route-page heading box")
            if len(dynamic.get("route_summary", "")) > 58:
                fail(f"slide {item['slide']} route_summary too long for route-page body box")
            for label in dynamic.get("route_labels", []):
                if len(label) > 44:
                    fail(f"slide {item['slide']} route label too long for stable route-page rendering")
        if page_type == "task-research-page":
            for label in dynamic.get("diagram_labels", []):
                if len(label) > 28:
                    fail(f"slide {item['slide']} diagram label too long for stable research-page rendering")
        if page_type == "indicator-table-page":
            if not dynamic.get("indicator_rows"):
                fail(f"slide {item['slide']} missing indicator rows")
        if page_type == "deliverable-table-page":
            if not dynamic.get("deliverable_rows"):
                fail(f"slide {item['slide']} missing deliverable rows")
        if page_type == "innovation-summary-page":
            if not (dynamic.get("innovation_title") and dynamic.get("innovation_summary")):
                fail(f"slide {item['slide']} missing innovation summary payload")
            if len(dynamic.get("innovation_summary", "")) > 64:
                fail(f"slide {item['slide']} innovation_summary too long for current innovation box")
            for label in dynamic.get("innovation_labels", []):
                if len(label) > 40:
                    fail(f"slide {item['slide']} innovation label too long for stable rendering")

    print("[PASS] v2 content and page manifest validation passed")


if __name__ == "__main__":
    main()
