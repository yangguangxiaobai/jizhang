#!/bin/sh
set -e
WORKDIR="/data/local/tmp/scroll_live"
cd "$WORKDIR"
rm -f frame_*.png timeline.txt actions.txt

T_START=$(date +%s%3N)
echo "START $T_START" > actions.txt

(
  # 1. Tap send
  echo "SEND_TAP $(date +%s%3N)" >> actions.txt
  input tap 915 2055
  
  # 2. Wait 4.5s for streaming to be actively in progress, then swipe to read history
  sleep 4.5
  echo "SWIPE_UP_HISTORY $(date +%s%3N)" >> actions.txt
  input swipe 540 750 540 1550 250
  
  # 3. Wait 3.0s (at ~+7.75s), natural scroll back towards bottom
  sleep 3.0
  echo "SWIPE_TOWARDS_BOTTOM $(date +%s%3N)" >> actions.txt
  input swipe 540 1550 540 750 250
  
  # 4. Wait 2.5s (at ~+10.5s), natural scroll to reach bottom
  sleep 2.5
  echo "SWIPE_REACH_BOTTOM $(date +%s%3N)" >> actions.txt
  input swipe 540 1550 540 750 250
  
  echo "ACTIONS_DONE $(date +%s%3N)" >> actions.txt
) &

for i in $(seq -w 1 35); do
  TS=$(date +%s%3N)
  screencap -p "frame_${i}.png"
  echo "$i $TS" >> timeline.txt
done

wait
echo "ALL_DONE $(date +%s%3N)" >> actions.txt
