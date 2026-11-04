#!/usr/bin/env python3
"""Choose an available iPhone simulator supported by the selected Xcode SDK."""
import json
import re
import subprocess

sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-version"], text=True).strip()
sdk_version = tuple(int(x) for x in sdk.split(".")[:2])
devices = json.loads(subprocess.check_output(["xcrun", "simctl", "list", "devices", "available", "--json"], text=True))
candidates = []
for runtime, rows in devices["devices"].items():
    match = re.search(r"\.iOS-(\d+)-(\d+)", runtime)
    if not match:
        continue
    version = tuple(map(int, match.groups()))
    if version > sdk_version:
        continue
    for row in rows:
        if row.get("isAvailable") and row["name"].startswith("iPhone"):
            candidates.append((version, row["name"], row["udid"]))
if not candidates:
    raise SystemExit(f"No iPhone simulator compatible with SDK {sdk}; install a matching runtime.")
print(sorted(candidates, reverse=True)[0][2])
