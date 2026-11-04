import subprocess
import time
import datetime
import os
import sys

DIR = ".trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/visible-stream"
LOG = os.path.join(DIR, "progress.log")

def log(msg):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
    line = f"{ts} {msg}\n"
    print(line, end="")
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(line)

def run(cmd):
    p = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    return p.returncode, p.stdout.strip(), p.stderr.strip()

log("[STEP 1] Starting visible-stream execution sequence")

# 1. Prepare device capture directory
log("[STEP 1.1] Preparing /sdcard/stream_vis on device")
run("adb shell 'rm -rf /sdcard/stream_vis && mkdir -p /sdcard/stream_vis'")

# 2. Tap send button at (915, 2055)
log("[STEP 1.2] Tapping send button at (915, 2055)")
run("adb shell input tap 915 2055")
t_send = time.time()
log(f"[STEP 1.2] Send tapped at epoch {t_send:.3f}")

# 3. Launch fast screencap loop on device for 40 frames (~20s)
log("[STEP 1.3] Starting on-device rapid screencap loop (40 frames, ~0.5s interval)")
cmd = "adb shell 'cd /sdcard/stream_vis && for i in $(seq -w 1 40); do echo \"$i $(date +%s%3N)\" >> timeline.txt; screencap -p cap_$i.png; done'"
rc, out, err = run(cmd)
t_loop_done = time.time()
log(f"[STEP 1.4] On-device screencap loop completed at +{t_loop_done - t_send:.3f}s (rc={rc})")

# 4. Pull frames to local stream_frames dir
local_frames = os.path.join(DIR, "stream_frames")
os.makedirs(local_frames, exist_ok=True)
log(f"[STEP 1.5] Pulling captured frames to {local_frames}")
run(f"adb pull /sdcard/stream_vis/. {local_frames}/")

# 5. Immediately dump terminal UI hierarchy & screencap
log("[STEP 1.6] Dumping immediate terminal UI hierarchy and screencap")
run(f"adb exec-out screencap -p > {DIR}/08-terminal.png")
run(f"adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > {DIR}/08-terminal.xml")

# 6. Wait 3.5s for quiescence assertion
log("[STEP 1.7] Waiting 3.5s for terminal quiescence assertion (no late card/pending)")
time.sleep(3.5)

# 7. Capture quiescent state
log("[STEP 1.8] Capturing quiescent terminal state after 3.5s")
run(f"adb exec-out screencap -p > {DIR}/09-terminal-quiescent-3s.png")
run(f"adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > {DIR}/09-terminal-quiescent-3s.xml")

log("[STEP 1] Phone capture sequence completed successfully")
