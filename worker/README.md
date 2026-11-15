# LogiTrack — Worker Prediksi (TimesFM)

Worker Python yang membaca job prediksi dari Upstash KV, menjalankan
Google TimesFM 3.0 (PyTorch, CPU), lalu menulis hasilnya kembali ke KV.
Situs Next.js di `../site/` hanya membaca hasilnya — worker inilah
"backend prediksi"-nya.

## Cara kerja

- Poll key `logistik:predict:job` setiap 10 detik.
- Job berisi `{columns: "all" | [id...], horizon: 1-60, filters: {...}}`.
- Kolom `tanggal` dipakai sebagai feature (sumbu waktu); kolom angka
  (`int` / `double` / `rumus`) adalah label yang diprediksi.
- Filter: string = cocok persis, tanggal = rentang tanggal,
  int/double/rumus = rentang angka. Baris harus lolos semua filter.
- Series diurutkan berdasarkan tanggal; tanggal prediksi = tanggal
  terakhir + median interval antar tanggal.
- Hasil ditulis ke `logistik:predict:result:<jobId>` lalu job ditandai
  `done` (atau `error` bila gagal). Satu job yang gagal tidak
  mematikan worker.
- Minimal 5 baris per kolom (peringatan bila < 10 baris).

## Menjalankan

```bash
# 1. Python 3.12 + venv (torch CPU dulu, baru timesfm — jangan sampai
#    pip menarik torch CUDA yang berat)
python3.12 -m venv venv
venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
venv/bin/pip install timesfm

# 2. Unduh checkpoint sekali (1,3 GB, tersimpan di HF cache)
HF_HUB_DISABLE_XET=1 venv/bin/python -c \
  "from timesfm3 import TimesFM3Forecaster; TimesFM3Forecaster.from_pretrained('google/timesfm-3.0-pytorch', device='cpu')"

# 3. Kredensial Upstash KV (JANGAN di-commit) di ~/.logistik-kv.env:
#    KV_REST_API_URL=https://<id>.upstash.io
#    KV_REST_API_TOKEN=<token>

# 4. Jalankan (sekali jalan terus; muat model ~10-30 detik di awal)
HF_HUB_OFFLINE=1 HF_HUB_DISABLE_XET=1 venv/bin/python logistik_predict.py
```

Jangan jalankan model Kronos dan TimesFM dalam satu proses yang sama
(keduanya memakai torch) — proses terpisah tidak masalah.

## Auto-restart

`logistik-watchdog.sh` memulai worker bila tidak berjalan (cek dengan
`pgrep`). Pasang di cron tiap 5 menit:

```cron
*/5 * * * * bash /path/ke/worker/logistik-watchdog.sh
```

Sesuaikan path di dalam `logistik-watchdog.sh` (`venv` dan lokasi
`logistik_predict.py`) dengan mesinmu.

## File

- `logistik_predict.py` — worker (poll KV → TimesFM → tulis hasil).
- `logistik-watchdog.sh` — auto-restart bila worker mati.
- `logistik-predict.log` — log worker (dibuat saat jalan, jangan di-commit).
