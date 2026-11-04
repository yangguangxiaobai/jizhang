#!/usr/bin/env bash
# cap.sh <label>  -> screenshot + ui xml + timestamp line
D="$(dirname "$0")"
L="$1"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
adb exec-out screencap -p > "$D/${L}.png"
adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > "$D/${L}.xml"
echo "$TS $L $(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')" >> "$D/timeline.txt"
echo "CAP $TS $L"
