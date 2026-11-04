#!/usr/bin/env bash
set -e
D="$(dirname "$0")"
L="$1"
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
adb exec-out screencap -p > "$D/${L}.png"
adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > "$D/${L}.xml"
FOCUS=$(adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus | tr -d '\r')
echo "$TS $L $FOCUS" >> "$D/progress.log"
echo "CAP $TS $L: $FOCUS"
