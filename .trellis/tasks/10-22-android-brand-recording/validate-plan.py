"""Validate this planning set only; never builds or starts tasks."""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TASKS = (
    "10-22-android-brand-recording",
    "10-22-android-brand-icons",
    "10-22-android-home-balances",
    "10-22-android-recording-cards",
)
errors = []
for name in TASKS:
    task = ROOT / ".trellis" / "tasks" / name
    state = json.loads((task / "task.json").read_text(encoding="utf-8-sig"))
    if state["status"] != "planning":
        errors.append(f"{name}: task left planning")
    for filename in ("prd.md", "design.md", "implement.md"):
        file = task / filename
        if not file.is_file():
            errors.append(f"{name}: missing {filename}")
            continue
        text = file.read_text(encoding="utf-8-sig")
        if re.search(r"\bTBD\b|_example", text):
            errors.append(f"{name}/{filename}: placeholder")
        for target in re.findall(r"\]\(<?([^)>]+)>?\)", text):
            if re.match(r"[a-z]+://", target) or target.startswith("#"):
                continue
            path = target.split("#", 1)[0]
            if not (file.parent / path).exists():
                errors.append(f"{name}/{filename}: broken link {target}")
    for kind in ("implement", "check"):
        file = task / f"{kind}.jsonl"
        entries = [json.loads(line) for line in file.read_text(encoding="utf-8-sig").splitlines() if line.strip()]
        if not entries or any("_example" in entry for entry in entries):
            errors.append(f"{name}/{kind}: empty or example context")
        for entry in entries:
            if not (ROOT / entry.get("file", "MISSING")).is_file():
                errors.append(f"{name}/{kind}: missing context {entry}")
if errors:
    raise SystemExit("\n".join(errors))
print("PASS: four planning tasks; 12 nonplaceholder documents; relative links; 8 real context manifests")
