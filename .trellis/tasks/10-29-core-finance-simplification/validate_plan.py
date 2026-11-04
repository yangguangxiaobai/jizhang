"""Read-only checks for this planning package, not product acceptance tests."""

from __future__ import annotations

import json
import re
from pathlib import Path


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
MAIN = ROOT / "docs/superpowers/plans/2026-10-29-core-finance-simplification.md"
EXPECTED_COUNTS = {"C1": 8, "C2": 9, "C3": 7, "C4": 8, "C5": 8}
ERRORS: list[str] = []


def require(condition: bool, message: str) -> None:
    if not condition:
        ERRORS.append(message)


def read(path: Path) -> str:
    require(path.is_file(), f"Missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def row_ids(text: str) -> set[str]:
    return set(re.findall(r"^\| ((?:C[1-5]-|G)\d{2}) \|", text, re.MULTILINE))


parent = json.loads(read(HERE / "task.json"))
require(bool(parent.get("title")) and bool(parent.get("description")), "Parent title/description empty")
require(parent.get("status") == "planning", "Parent must remain planning in this planning delivery")
children = parent.get("children", [])
require(len(children) == 5 and len(set(children)) == 5, "Expected exactly five unique child tasks")
task_dirs = [HERE] + [HERE.parent / name for name in children]
documents: list[Path] = [MAIN]
proposed_files: set[str] = set()
covered_requirements: set[str] = set()
all_case_ids = {f"G{i:02}" for i in range(1, 7)}

for directory in task_dirs:
    for filename in ("prd.md", "design.md", "implement.md"):
        path = directory / filename
        content = read(path)
        require(len(content.strip()) >= 200, f"Incomplete document: {path.relative_to(ROOT)}")
        documents.append(path)
        if filename == "implement.md":
            for label in ("**Goal:", "**Architecture:", "**Tech Stack:", "**Spec:", "## Global Constraints", "## Review Focus", "- [ ]"):
                require(label in content, f"Missing plan header/steps {label}: {path.relative_to(ROOT)}")
        if filename == "design.md":
            proposed_files.update(re.findall(r"^\| Create \| ([^|]+) \|", content, re.MULTILINE))

for index, directory in enumerate(task_dirs):
    data = json.loads(read(directory / "task.json"))
    require(data.get("status") == "planning", f"Task unexpectedly activated: {directory.name}")
    require(bool(data.get("title")) and bool(data.get("description")), f"Empty task title/description: {directory.name}")
    require(data.get("meta", {}).get("implementation_approved") is False, f"Implementation approval incorrectly recorded: {directory.name}")
    if index:
        code = f"C{index}"
        require(data.get("parent") in (HERE.name, str(HERE.relative_to(ROOT)), str(HERE)), f"Broken parent: {directory.name}")
        expected = {f"{code}-{i:02}" for i in range(1, EXPECTED_COUNTS[code] + 1)}
        require(set(data.get("meta", {}).get("acceptance_ids", [])) == expected, f"Incorrect acceptance metadata: {code}")
        require(row_ids(read(directory / "prd.md")) == expected, f"Incomplete PRD acceptance rows: {code}")
        all_case_ids.update(expected)
        covered_requirements.update(data.get("meta", {}).get("requirements", []))
    design = read(directory / "design.md")
    for path in re.findall(r"^\| Inspect/modify \| ([^|]+) \|", design, re.MULTILINE):
        require((ROOT / path).is_file() or path in proposed_files, f"Nonexistent inspect/modify path: {path}")
    for filename in ("implement.jsonl", "check.jsonl"):
        contents = read(directory / filename)
        entries = [json.loads(line) for line in contents.splitlines() if line.strip()]
        require(bool(entries), f"Empty manifest: {directory.name}/{filename}")
        for entry in entries:
            require("_example" not in entry, f"Seed manifest row remains: {directory.name}/{filename}")
            path = entry.get("file", "")
            require(bool(path) and (ROOT / path).is_file(), f"Missing context file {path}: {directory.name}/{filename}")
            require(path.startswith((".trellis/spec/", ".trellis/tasks/", "docs/superpowers/")), f"Code path in spec/research manifest: {path}")
            require(bool(entry.get("reason")), f"Context reason missing: {path}")

require(covered_requirements | {"F12"} == {f"F{i:02}" for i in range(1, 13)}, "Requirement ownership does not cover F01-F12")
parent_requirements = set(re.findall(r"^\| (F\d{2}) \|", read(HERE / "prd.md"), re.MULTILINE))
require(parent_requirements == {f"F{i:02}" for i in range(1, 13)}, "Parent requirements incomplete")
documents.append(HERE / "acceptance.md")
require(row_ids(read(HERE / "acceptance.md")) == all_case_ids, "Parent acceptance differs from child/integration IDs")
require(row_ids(read(MAIN)) == all_case_ids, "User plan acceptance differs from authoritative matrix")
require(len(all_case_ids) == 46, "Expected46 functional/integration cases")
documents.extend(path for path in HERE.glob("*.md") if path not in documents)

links = 0
for path in documents:
    text = read(path)
    require(not re.search(r"\b(?:TBD|TODO|FIXME)\b|include128\?", text), f"Unresolved placeholder: {path.relative_to(ROOT)}")
    require(all(line == line.rstrip() for line in text.splitlines()), f"Trailing whitespace: {path.relative_to(ROOT)}")
    for target in re.findall(r"\[[^\]]+\]\(([^)]+)\)", text):
        target = target.strip().strip("<>").split("#", 1)[0]
        if not target or re.match(r"^[a-zA-Z]+://|^mailto:", target):
            continue
        target_path = (path.parent / target).resolve()
        require(target_path.is_file(), f"Broken link in {path.relative_to(ROOT)}: {target}")
        links += 1

if ERRORS:
    print("PLANNING CHECK FAILED")
    for error in ERRORS:
        print(f"- {error}")
    raise SystemExit(1)

print(f"PLANNING CHECK PASSED: {len(task_dirs)} planning tasks, 12 requirements, {len(all_case_ids)} cases, {len(documents)} core Markdown files, {links} valid links, 12 curated manifests.")
print("Product tests, device acceptance and deployment have not been performed by this check.")
