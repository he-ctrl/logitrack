# LogiTrack — Dashboard Pelacakan Logistik

Dashboard logistik dengan tabel data dinamis, grafik, dan prediksi ke depan
memakai Google TimesFM 3.0. Live di
https://logitrack-mocha-seven.vercel.app/

## Isi repo

- `site/` — aplikasi Next.js (deploy di Vercel). Tabel dinamis
  (kolom tanggal wajib + tipe string/int/double/rumus), grafik, filter,
  prediksi, login 2 role (logistik / supervisor), navbar per fitur,
  CRUD baris. Data tersimpan di Upstash KV (key diawali `logistik:`).
- `worker/` — backend prediksi: script Python TimesFM + watchdog
  auto-restart. Baca `worker/README.md` untuk cara menjalankan.

## Arsitektur

```
Browser ──> Next.js (Vercel) ──> Upstash KV (HTTP REST)
   │                ▲                     ▲
   │        /api/* (login, data,          │
   │         kolom, baris, prediksi)      │
   │                                      │
   └─ Worker TimesFM (VPS/sandbox) ───────┘
      poll logistik:predict:job tiap 10 detik,
      tulis logistik:predict:result:<jobId>
```

Kunci KV: `logistik:schema`, `logistik:rows`, `logistik:predict:job`,
`logistik:predict:result:<jobId>`, `logistik:users`, `logistik:sessions`.

## Kredensial

Tidak ada kredensial di repo ini. Yang dibutuhkan:

- Vercel: `KV_REST_API_URL` + `KV_REST_API_TOKEN` (Upstash KV).
- Worker: file `~/.logistik-kv.env` dengan dua variabel yang sama.
