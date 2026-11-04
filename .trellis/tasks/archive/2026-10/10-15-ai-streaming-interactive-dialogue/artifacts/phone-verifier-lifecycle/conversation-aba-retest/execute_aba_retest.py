import subprocess
import time
import datetime
import os
import json
import sys

DIR = ".trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/conversation-aba-retest"
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

# Read prepared IDs
with open(f"{DIR}/04-conversation-ids.json", "r", encoding="utf-8") as f:
    ids_data = json.load(f)

convA_id = ids_data["conversation_A_id"]
convB_id = ids_data["conversation_B_id"]
log(f"[START] Beginning optimized A->B->A retest execution. ConvA={convA_id}, ConvB={convB_id}")

# Measure clock offset between local, device, and server
log("[OFFSET] Measuring device and server clock offset...")
_, t_dev_raw, _ = run("adb shell date +%s%3N")
t_dev_baseline = int(t_dev_raw.strip()) if t_dev_raw else 0
_, t_srv_raw, _ = run("ssh -i ~/.ssh/jizhang_deploy -o BatchMode=yes ubuntu@jz.yansuu1.xyz \"sudo -n docker exec 0b5eb41efa7c node -e 'console.log(Date.now())'\"")
t_srv_baseline = int(t_srv_raw.strip()) if t_srv_raw else 0
log(f"[OFFSET] Device ms: {t_dev_baseline}, Server ms: {t_srv_baseline}, Server-Device offset: {t_srv_baseline - t_dev_baseline}ms")

# Step 1: In Conversation A, type prompt
log("[STEP 1] Tapping input field at (525, 2043)")
run("adb shell input tap 525 2043")
time.sleep(0.5)

prompt_text = "UI%sTEST:%sPlease%sprovide%s3%spractical%sbudgeting%stips%sfor%syoung%sprofessionals%sin%s150%swords.%sReading%sadvice%sonly,%sdo%snot%sbook%stransactions."
log("[STEP 1.1] Typing prompt via adb shell input text")
run(f"adb shell input text \"{prompt_text}\"")
time.sleep(0.5)

log("[STEP 1.2] Hiding keyboard with keyevent 111")
run("adb shell input keyevent 111")
time.sleep(0.5)

# Capture typed ready state (screencap + XML)
log("[STEP 1.3] Capturing 05-A-typed-ready")
run(f"adb exec-out screencap -p > {DIR}/05-A-typed-ready.png")
run(f"bash -c \"adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > {DIR}/05-A-typed-ready.xml\"")

# Step 2: Push on-device shell script to run optimized timing sequence without uiautomator delay
runner_sh = """#!/system/bin/sh
rm -f /sdcard/aba_*.png /sdcard/retest_t_*.txt

echo $(date +%s%3N) > /sdcard/retest_t_send.txt
input tap 915 2055

sleep 1.0
echo $(date +%s%3N) > /sdcard/retest_t_1s.txt
screencap -p /sdcard/aba_06_generating.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_list.txt
input tap 777 234

sleep 0.4
echo $(date +%s%3N) > /sdcard/retest_t_list_ready.txt
screencap -p /sdcard/aba_07_conv_list.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_B.txt
input tap 171 1006

sleep 0.5
echo $(date +%s%3N) > /sdcard/retest_t_in_B.txt
screencap -p /sdcard/aba_08_in_conv_B.png &

sleep 2.0
echo $(date +%s%3N) > /sdcard/retest_t_leave_B.txt
input tap 777 234

sleep 0.4
echo $(date +%s%3N) > /sdcard/retest_t_list_return.txt
screencap -p /sdcard/aba_09_conv_list_return.png &

echo $(date +%s%3N) > /sdcard/retest_t_tap_A.txt
input tap 171 726

sleep 0.5
echo $(date +%s%3N) > /sdcard/retest_t_back_A.txt
screencap -p /sdcard/aba_10_back_to_conv_A.png &

sleep 3.5
echo $(date +%s%3N) > /sdcard/retest_t_quiescent.txt
screencap -p /sdcard/aba_11_conv_A_terminal_quiescent_3s.png

echo "DONE" > /sdcard/retest_status.txt
"""

with open(f"{DIR}/run_aba.sh", "w", encoding="utf-8", newline="\n") as f:
    f.write(runner_sh)

run(f"adb push {DIR}/run_aba.sh /data/local/tmp/run_aba.sh")
run("adb shell chmod +x /data/local/tmp/run_aba.sh")

log("[STEP 2] Executing on-device optimized ABA sequence...")
rc, out, err = run("adb shell /data/local/tmp/run_aba.sh")
log(f"[STEP 2] Sequence script execution finished. rc={rc}")

# Wait an extra second to ensure all bg writes finish
time.sleep(1.0)

# Pull captured images from sdcard
log("[STEP 3] Pulling captured images from device sdcard...")
for name in [
    ("aba_06_generating.png", "06-A-generating.png"),
    ("aba_07_conv_list.png", "07-conv-list-during-gen.png"),
    ("aba_08_in_conv_B.png", "08-in-conv-B.png"),
    ("aba_09_conv_list_return.png", "09-conv-list-before-return-A.png"),
    ("aba_10_back_to_conv_A.png", "10-back-to-conv-A.png"),
    ("aba_11_conv_A_terminal_quiescent_3s.png", "11-conv-A-terminal-quiescent-3s.png"),
]:
    run(f"adb pull /sdcard/{name[0]} {DIR}/{name[1]}")

# Dump quiescent XML
log("[STEP 3.1] Dumping quiescent XML...")
run(f"bash -c \"adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > {DIR}/11-conv-A-terminal-quiescent-3s.xml\"")

# Read device timestamps
t_names = [
    "t_send", "t_1s", "t_tap_list", "t_list_ready", "t_tap_B",
    "t_in_B", "t_leave_B", "t_list_return", "t_tap_A", "t_back_A", "t_quiescent"
]
device_timestamps = {}
for tn in t_names:
    _, val, _ = run(f"adb shell cat /sdcard/retest_{tn}.txt 2>/dev/null")
    if val:
        device_timestamps[tn] = int(val.strip())

with open(f"{DIR}/device-timestamps.json", "w", encoding="utf-8") as f:
    json.dump(device_timestamps, f, indent=2)
log(f"[TIMESTAMPS] Device recorded timestamps: {json.dumps(device_timestamps, indent=2)}")

# Step 4: Safe read-only probe on server DB
log("[STEP 4] Querying server read-only metadata...")
node_probe = f"""
const D = require('/app/packages/server/node_modules/better-sqlite3');
const db = new D('/data/jizhang.db', {{ readonly: true }});

// Conv A generation
const genA = db.prepare('SELECT id, conversation_id, status, outcome, delivery, last_seq, created_at, updated_at, error_code, error_message, length(partials_json) as partials_len FROM assistant_generations WHERE conversation_id = ? ORDER BY created_at DESC').all('{convA_id}');

// Conv A events
let eventsA = [];
if (genA.length > 0) {{
    eventsA = db.prepare('SELECT generation_id, seq, type, created_at, length(payload_json) as len FROM assistant_generation_events WHERE generation_id = ? ORDER BY seq ASC').all(genA[0].id);
}}

// Conv A messages
const msgsA = db.prepare('SELECT id, conversation_id, role, created_at, length(content_json) as len FROM assistant_messages WHERE conversation_id = ? ORDER BY created_at ASC').all('{convA_id}');

// Conv B check
const genB = db.prepare('SELECT id, conversation_id, status FROM assistant_generations WHERE conversation_id = ?').all('{convB_id}');
const msgsB = db.prepare('SELECT id, conversation_id, role FROM assistant_messages WHERE conversation_id = ?').all('{convB_id}');

// Total counts
const totalGen = db.prepare('SELECT COUNT(*) c FROM assistant_generations').get().c;
const tx = db.prepare('SELECT COUNT(*) c FROM transactions').get().c;
const tr = db.prepare('SELECT COUNT(*) c FROM transfers').get().c;
const pa = db.prepare('SELECT COUNT(*) c FROM assistant_pending_actions').get().c;

console.log(JSON.stringify({{
    genA,
    eventsCountA: eventsA.length,
    eventsA,
    msgsA,
    genB,
    msgsB,
    totalGen,
    ledger: {{ transactions: tx, transfers: tr, assistant_pending_actions: pa }}
}}, null, 2));
db.close();
"""

cmd = [
    "ssh", "-i", os.path.expanduser("~/.ssh/jizhang_deploy"), "-o", "BatchMode=yes",
    "ubuntu@jz.yansuu1.xyz",
    f"sudo -n docker exec 0b5eb41efa7c node -e \"{node_probe}\""
]
p = subprocess.run(cmd, capture_output=True, text=True)
server_data = json.loads(p.stdout.strip())

with open(f"{DIR}/12-server-evidence.json", "w", encoding="utf-8") as f:
    json.dump(server_data, f, indent=2)

with open(f"{DIR}/13-ledger-counts-final.json", "w", encoding="utf-8") as f:
    json.dump(server_data["ledger"], f, indent=2)

genA_info = server_data["genA"][0] if server_data["genA"] else None
log(f"[COMPLETE] A->B->A retest complete:")
log(f"  GenA count: {len(server_data['genA'])}")
if genA_info:
    log(f"  GenA id: {genA_info['id']}")
    log(f"  GenA status: {genA_info['status']}")
    log(f"  GenA error_code: {genA_info['error_code']}")
    log(f"  GenA created_at: {genA_info['created_at']}, updated_at: {genA_info['updated_at']}")
log(f"  Events A count: {server_data['eventsCountA']}")
log(f"  Conv B gen count: {len(server_data['genB'])}, msgs count: {len(server_data['msgsB'])}")
log(f"  Total Generations: {server_data['totalGen']}")
log(f"  Ledger: {server_data['ledger']}")
