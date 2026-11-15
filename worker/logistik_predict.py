#!/usr/bin/env python3
"""LogiTrack prediction worker — TimesFM 3.0 (PyTorch) on CPU.

Polls Upstash KV (HTTP) for prediction jobs, forecasts the requested
numeric columns with Google TimesFM, writes results back to KV.

KV contract (prefix logistik:):
  logistik:schema            {"columns": [{"id","name","type"}]}  type: tanggal|string|int|double
  logistik:rows              [{"id","values": {"tanggal": ISO, "<colId>": value}}]
  logistik:predict:job       {"id","columns": "all"|[ids],"horizon": N,"status": pending|processing|done|error,"created_at": ISO,"error": null,"filters": {colId: value}}
  logistik:predict:result:<jobId>  {"job_id","at","horizon","columns": {id: {"dates":[],"values":[],"q10":[],"q90":[]}},"meta": {...}}

Design (user-confirmed): kolom tanggal/waktu is the FEATURE (time axis);
other numeric columns (int/double, e.g. jumlah barang) are the LABELS to
forecast. Rows are sorted by tanggal; forecast dates extend the last
tanggal by the median interval between consecutive tanggal values.
TimesFM only sees the ordered values, not the dates as a covariate.
String columns (e.g. jenis barang) act as category FILTERS, tanggal uses a
date RANGE, and int/double columns use a NUMBER RANGE: job.filters keeps
only rows matching all active filters, for the table, the chart and the
prediction (e.g. jenis barang=sayur, harga max=rendah).

Credentials: only from ~/.logistik-kv.env (KV_REST_API_URL /
KV_REST_API_TOKEN), never in this file. The worker waits for that file
to exist instead of crash-looping, so the watchdog can start it before
the KV store is provisioned.
"""

import json
import os
import sys
import time
import traceback
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("HF_HUB_DISABLE_XET", "1")
os.environ.setdefault("OMP_NUM_THREADS", "4")

import numpy as np  # noqa: E402
import torch  # noqa: E402

torch.set_num_threads(4)

KV_ENV = os.path.expanduser("~/.logistik-kv.env")
LOG_PATH = os.path.expanduser("~/workspace/logistik-dashboard/worker/logistik-predict.log")
POLL_SECONDS = 10
MIN_POINTS = 5        # fewer than this: column is skipped
WARN_POINTS = 10      # fewer than this: forecast runs but carries a warning


def log(msg):
    line = f"{datetime.now(timezone.utc).isoformat()} {msg}"
    print(line, flush=True)
    try:
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass


def load_kv_env():
    env = {}
    with open(KV_ENV) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    url = env.get("KV_REST_API_URL", "").rstrip("/")
    token = env.get("KV_REST_API_TOKEN", "")
    if not url or not token:
        raise ValueError("~/.logistik-kv.env must define KV_REST_API_URL and KV_REST_API_TOKEN")
    return url, token


def kv_get(url, token, key):
    req = urllib.request.Request(
        f"{url}/get/{urllib.parse.quote(key, safe='')}",
        headers={"Authorization": f"Bearer {token}"},
    )
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r).get("result")


def kv_set(url, token, key, value):
    # value: a JSON string. Upstash REST: POST /set/<key> with the raw body.
    body = value.encode("utf-8")
    req = urllib.request.Request(
        f"{url}/set/{urllib.parse.quote(key, safe='')}",
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def parse_iso(s):
    try:
        return datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None


def median_interval(dates):
    if len(dates) < 2:
        return timedelta(days=1)
    diffs = sorted((b - a).total_seconds() for a, b in zip(dates, dates[1:]) if (b - a).total_seconds() > 0)
    if not diffs:
        return timedelta(days=1)
    return timedelta(seconds=diffs[len(diffs) // 2])


def process_job(url, token, forecaster, job):
    job_id = job["id"]
    horizon = int(job.get("horizon") or 7)
    horizon = max(1, min(horizon, 60))
    log(f"job {job_id}: horizon={horizon} columns={job.get('columns')} filters={job.get('filters') or {}}")

    schema = json.loads(kv_get(url, token, "logistik:schema") or "{}")
    rows = json.loads(kv_get(url, token, "logistik:rows") or "[]")
    columns = schema.get("columns", [])
    numeric = {c["id"]: c for c in columns if c.get("type") in ("int", "double", "rumus")}

    # Filter: string = cocok persis, tanggal = rentang tanggal,
    # int/double = rentang angka. Berlaku untuk tabel, grafik & prediksi.
    col_types = {c["id"]: c.get("type") for c in columns}
    raw_filters = job.get("filters") or {}
    filters = {}
    for k, v in raw_filters.items():
        t = col_types.get(k)
        if t in ("string", "selection"):
            if str(v) != "":
                filters[k] = str(v)
        elif t == "tanggal" and isinstance(v, dict):
            f, to = parse_iso(v.get("from")), parse_iso(v.get("to"))
            if f is not None or to is not None:
                filters[k] = {"from": f.isoformat() if f else None, "to": to.isoformat() if to else None}
        elif t in ("int", "double", "rumus") and isinstance(v, dict):
            try:
                lo = float(v.get("min")) if v.get("min") not in (None, "") else None
            except (TypeError, ValueError):
                lo = None
            try:
                hi = float(v.get("max")) if v.get("max") not in (None, "") else None
            except (TypeError, ValueError):
                hi = None
            if lo is not None or hi is not None:
                filters[k] = {"min": lo, "max": hi}
    rows_total = len(rows)
    if filters:
        def _match(r):
            vals = r.get("values") or {}
            for k, f in filters.items():
                t = col_types.get(k)
                if t in ("string", "selection"):
                    if str(vals.get(k, "")) != f:
                        return False
                elif t == "tanggal":
                    d = parse_iso(vals.get("tanggal"))
                    if d is None:
                        return False
                    if f.get("from") and d < parse_iso(f["from"]):
                        return False
                    if f.get("to") and d > parse_iso(f["to"]):
                        return False
                else:  # int/double: rentang angka
                    try:
                        n = float(vals.get(k, 0) or 0)
                    except (TypeError, ValueError):
                        return False
                    if f.get("min") is not None and n < f["min"]:
                        return False
                    if f.get("max") is not None and n > f["max"]:
                        return False
            return True
        rows = [r for r in rows if _match(r)]
        log(f"job {job_id}: filter {filters} -> {len(rows)} dari {rows_total} baris")

    wanted = job.get("columns") or "all"
    if wanted == "all":
        target_ids = list(numeric.keys())
    else:
        target_ids = [cid for cid in wanted if cid in numeric]
    skipped = {}
    for cid in (wanted if isinstance(wanted, list) else []):
        if cid not in numeric:
            skipped[cid] = "bukan kolom angka (string/tanggal tidak diprediksi)"

    # Sort rows by tanggal (the feature axis).
    dated = []
    for r in rows:
        d = parse_iso((r.get("values") or {}).get("tanggal"))
        if d is not None:
            dated.append((d, r))
    dated.sort(key=lambda t: t[0])
    dates = [d for d, _ in dated]
    if not dated:
        if filters:
            raise ValueError("tidak ada baris yang cocok dengan filter")
        raise ValueError("tidak ada baris dengan tanggal yang valid")

    series = {}
    for cid in target_ids:
        vals = []
        for _, r in dated:
            try:
                vals.append(float((r.get("values") or {}).get(cid, 0) or 0))
            except (TypeError, ValueError):
                vals.append(0.0)
        if len(vals) < MIN_POINTS:
            skipped[cid] = f"data terlalu sedikit ({len(vals)} baris, minimal {MIN_POINTS})"
        else:
            series[cid] = vals
    if not series:
        raise ValueError("tidak ada kolom angka yang bisa diprediksi: " + json.dumps(skipped))

    ids = list(series.keys())
    ctx = np.array([series[cid] for cid in ids], dtype=np.float32)
    out = forecaster.predict(ctx, horizon=horizon, return_quantiles=True, make_positive=True)
    forecast = np.asarray(out.forecast, dtype=float)          # (n_cols, horizon)
    quantiles = np.asarray(out.quantiles, dtype=float)        # (n_cols, horizon, 9), levels 0.1..0.9
    if forecast.ndim == 1:
        forecast = forecast[None, :]
        quantiles = quantiles[None, :, :]

    step = median_interval(dates)
    last = dates[-1]
    fdates = [(last + step * (i + 1)).isoformat() for i in range(horizon)]

    result_cols = {}
    for i, cid in enumerate(ids):
        result_cols[cid] = {
            "dates": fdates,
            "values": [round(float(v), 4) for v in forecast[i]],
            "q10": [round(float(v), 4) for v in quantiles[i, :, 0]],
            "q90": [round(float(v), 4) for v in quantiles[i, :, 8]],
        }

    warning = None
    if len(dated) < WARN_POINTS:
        warning = f"Data hanya {len(dated)} baris (< {WARN_POINTS}); prediksi sekadar kelanjutan tren, tambah data agar lebih akurat."

    result = {
        "job_id": job_id,
        "at": datetime.now(timezone.utc).isoformat(),
        "horizon": horizon,
        "columns": result_cols,
        "meta": {
            "rows_used": len(dated),
            "rows_total": rows_total,
            "filters": filters,
            "last_date": dates[-1].isoformat(),
            "step_seconds": step.total_seconds(),
            "warning": warning,
            "skipped": skipped,
        },
    }
    kv_set(url, token, f"logistik:predict:result:{job_id}", json.dumps(result))
    job["status"] = "done"
    job["error"] = None
    kv_set(url, token, "logistik:predict:job", json.dumps(job))
    log(f"job {job_id}: done, {len(ids)} kolom diprediksi ({', '.join(ids)}), {len(dated)} baris dipakai")
    return True


def main():
    log("logistik worker starting")
    url = token = None
    while url is None:
        try:
            url, token = load_kv_env()
        except (OSError, ValueError) as e:
            log(f"menunggu ~/.logistik-kv.env: {e}")
            time.sleep(30)
    log("KV terhubung")

    forecaster = None
    while True:
        try:
            raw = kv_get(url, token, "logistik:predict:job")
            job = json.loads(raw) if raw else None
            if job and job.get("status") == "pending":
                if forecaster is None:
                    log("memuat TimesFM 3.0 ...")
                    from timesfm3 import TimesFM3Forecaster

                    forecaster = TimesFM3Forecaster.from_pretrained(
                        "google/timesfm-3.0-pytorch", device="cpu"
                    )
                    log("TimesFM 3.0 siap")
                job["status"] = "processing"
                kv_set(url, token, "logistik:predict:job", json.dumps(job))
                try:
                    process_job(url, token, forecaster, job)
                except Exception as e:
                    log(f"job {job.get('id')}: ERROR {e}\n{traceback.format_exc()}")
                    job["status"] = "error"
                    job["error"] = str(e)
                    try:
                        kv_set(url, token, "logistik:predict:job", json.dumps(job))
                    except Exception:
                        log("gagal menulis status error ke KV")
        except Exception as e:
            log(f"poll error: {e}")
        time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()
