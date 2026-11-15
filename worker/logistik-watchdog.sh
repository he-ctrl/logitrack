#!/bin/bash
# LogiTrack prediction watchdog — user-requested auto-restart (same pattern
# as the Kronos watchdog). Started by a runtime cron every 5 minutes.
# If the worker is already running, do nothing (never start a second
# copy). If it is not running — e.g. after a VM restart, which kills all
# background processes — start it. The worker itself reads
# ~/.logistik-kv.env (Upstash KV REST credentials) at startup and waits
# for that file if it does not exist yet, so credentials are never baked
# in here.
if pgrep -f '[l]ogistik_predict.py' > /dev/null 2>&1; then
  echo "$(date -u +%FT%TZ) logistik worker already running, nothing to do"
  exit 0
fi
echo "$(date -u +%FT%TZ) logistik worker NOT running, restarting"
cd /home/hatch/workspace/logistik-dashboard/worker || exit 1
HF_HUB_DISABLE_XET=1 HF_HUB_OFFLINE=1 nohup /home/hatch/workspace/logistik-timesfm/venv/bin/python logistik_predict.py >> /home/hatch/workspace/logistik-dashboard/worker/logistik-predict.log 2>&1 &
echo "$(date -u +%FT%TZ) logistik worker restarted, pid $!"
