import subprocess
import time
import datetime
import os
import sys

DIR = ".trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/stop"
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

log("[STEP 1] Starting Stop test sequence")

# 1. 点击发送按钮 (915, 2055)
log("[STEP 1.1] Tapping send button at (915, 2055)")
run("adb shell input tap 915 2055")
t_send = time.time()

# 2. 等待 0.5s 让网络请求发出并挂载 ProvisionalBubble
time.sleep(0.5)

# 3. 立即触发设备端快速 screencap (耗时仅 ~0.15s)
log("[STEP 1.2] Capturing connecting placeholder screen on device")
run("adb shell screencap -p /sdcard/stop_01_connecting.png")

# 4. 在首字占位等待期间 (t ~ 0.7s) 明确点击 Stop 按钮
log("[STEP 1.3] Tapping Stop button at (540, 1205) and (915, 2055)")
run("adb shell input tap 540 1205")
run("adb shell input tap 915 2055")
t_stop = time.time()
log(f"[STEP 1.4] Stop tapped at +{t_stop - t_send:.3f}s after send")

# 5. 立即抓取点击 Stop 后的截图
run("adb shell screencap -p /sdcard/stop_02_clicked.png")

# 6. pull 截图到本地
run(f"adb pull /sdcard/stop_01_connecting.png {DIR}/06a-connecting-placeholder.png")
run(f"adb pull /sdcard/stop_02_clicked.png {DIR}/06b-stop-clicked.png")

# 7. dump 当前 UI hierarchy
log("[STEP 1.5] Dumping UI hierarchy immediately after stop")
run(f"adb exec-out uiautomator dump /dev/tty > {DIR}/06-stop-clicked.xml")

# 8. 终态后等待 3.5 秒 (验证无迟到 card/pending)
log("[STEP 1.6] Waiting 3.5s for terminal quiescence assertion (no late card/pending)")
time.sleep(3.5)

# 9. 抓取 3s 静默期后的完整 UI 与 XML
log("[STEP 1.7] Capturing quiescent terminal state after 3s")
run(f"{DIR}/cap.sh 07-terminal-quiescent-3s")

log("[STEP 1] Phone UI actions completed successfully")
