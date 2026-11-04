import subprocess
import time
import datetime
import os
import json
import sys

DIR = ".trellis/tasks/10-15-ai-streaming-interactive-dialogue/artifacts/phone-verifier-lifecycle/conversation-aba"
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

def cap(label):
    ts = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    run(f"adb exec-out screencap -p > {DIR}/{label}.png")
    run(f"bash -c \"adb exec-out uiautomator dump /dev/tty 2>/dev/null | sed 's/UI hierchary dumped to:.*//' > {DIR}/{label}.xml\"")
    _, focus, _ = run("adb shell dumpsys window 2>/dev/null | grep -m1 mCurrentFocus")
    log(f"[CAP] {label} focus={focus.strip()}")

# Read prepared IDs
with open(f"{DIR}/04-conversation-ids.json", "r", encoding="utf-8") as f:
    ids_data = json.load(f)

convA_id = ids_data["conversation_A_id"]
convB_id = ids_data["conversation_B_id"]
log(f"[START] Beginning A->B->A test execution. ConvA={convA_id}, ConvB={convB_id}")

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

cap("05-A-typed-ready")

# Step 2: Send request in Conversation A
log("[STEP 2] Tapping send button at (915, 2055)")
run("adb shell input tap 915 2055")
t_send = time.time()
log(f"[STEP 2] Send tapped at epoch {t_send:.3f}")

# Wait ~1.0s: Provisional bubble mounted, generation started
time.sleep(1.0)
log(f"[STEP 2.1] Capturing generating state in Conversation A at +{time.time() - t_send:.3f}s")
cap("06-A-generating")

# Step 3: Switch to Conversation List during active generation
log(f"[STEP 3] Tapping '会话' at (777, 234) during active generation at +{time.time() - t_send:.3f}s")
run("adb shell input tap 777 234")
time.sleep(0.6)
cap("07-conv-list-during-gen")

# Step 4: Tap Conversation B (Item 1 at 171, 1006)
log(f"[STEP 4] Tapping Conversation B at (171, 1006) at +{time.time() - t_send:.3f}s")
run("adb shell input tap 171 1006")
time.sleep(0.8)
cap("08-in-conv-B")

# Verify in Conversation B: stay for 2.0s while Conv A completes on server
log(f"[STEP 4.1] In Conversation B, pausing 2.0s to allow Conv A server generation progress (+{time.time() - t_send:.3f}s)")
time.sleep(2.0)

# Step 5: Switch back from B to Conversation List
log(f"[STEP 5] Tapping '会话' at (777, 234) in Conversation B at +{time.time() - t_send:.3f}s")
run("adb shell input tap 777 234")
time.sleep(0.6)
cap("09-conv-list-before-return-A")

# Step 6: Tap Conversation A (Item 0 at 171, 726)
log(f"[STEP 6] Tapping Conversation A at (171, 726) at +{time.time() - t_send:.3f}s")
run("adb shell input tap 171 726")
time.sleep(1.2)
cap("10-back-to-conv-A")

# Step 7: Wait 3.5s for terminal quiescence
log(f"[STEP 7] Waiting 3.5s for terminal quiescence at +{time.time() - t_send:.3f}s")
time.sleep(3.5)
cap("11-conv-A-terminal-quiescent-3s")

log("[STEP 8] Phone UI operations complete. Now querying server read-only metadata...")

# Step 8: Safe read-only probe on server DB
node_probe = f"""
const D = require('/app/packages/server/node_modules/better-sqlite3');
const db = new D('/data/jizhang.db', {{ readonly: true }});

// Conv A generation
const genA = db.prepare('SELECT id, conversation_id, status, outcome, delivery, last_seq, created_at, updated_at, error_code, error_message FROM assistant_generations WHERE conversation_id = ? ORDER BY created_at DESC').all('{convA_id}');

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

log(f"[COMPLETE] A->B->A test execution finished. GenA count={len(server_data['genA'])}, GenA status={server_data['genA'][0]['status'] if server_data['genA'] else 'NONE'}, GenB count={len(server_data['genB'])}, TotalGen={server_data['totalGen']}")
