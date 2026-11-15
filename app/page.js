'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const COLORS = ['#2e86c1', '#f5a623', '#1e8449', '#8e44ad', '#c0392b', '#16a085', '#d35400', '#2c3e50'];

function nowInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? '');
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function fmtTick(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
}

function fmtNum(v) {
  if (typeof v === 'number') return v.toLocaleString('id-ID');
  return v ?? '';
}

// Tooltip grafik: judulnya tanggal + jam lengkap, bukan cuma tanggal.
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload || payload.length === 0) return null;
  const full = payload[0]?.payload?.full;
  return (
    <div style={{ background: '#fff', border: '1px solid #dde4ea', borderRadius: 8, padding: '8px 10px', fontSize: 13, boxShadow: '0 1px 4px rgba(15,42,67,0.15)' }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{full ? fmtDate(full) : label}</div>
      {payload.filter((p) => p.value !== undefined && p.value !== null).map((p) => (
        <div key={String(p.dataKey)}><span style={{ color: p.color || p.stroke }}>●</span> {p.name}: {fmtNum(p.value)}</div>
      ))}
    </div>
  );
}

export default function Home() {
  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [colName, setColName] = useState('');
  const [colType, setColType] = useState('int');
  const [colBusy, setColBusy] = useState(false);
  const [delColId, setDelColId] = useState('');
  const [delBusy, setDelBusy] = useState(false);

  const [rowForm, setRowForm] = useState({ tanggal: nowInput() });
  const [rowBusy, setRowBusy] = useState(false);

  const [chartX, setChartX] = useState('tanggal');
  const [chartY, setChartY] = useState([]);
  const [sampleBusy, setSampleBusy] = useState(false);

  const [predScope, setPredScope] = useState('all');
  const [predCols, setPredCols] = useState([]);
  const [horizon, setHorizon] = useState(7);
  const [job, setJob] = useState(null);
  const [result, setResult] = useState(null);
  const [predMsg, setPredMsg] = useState('');
  const [predBusy, setPredBusy] = useState(false);

  // Filter kategori (kolom string): dipakai grafik & prediksi.
  const [filters, setFilters] = useState({});

  const numericCols = useMemo(() => columns.filter((c) => c.type === 'int' || c.type === 'double'), [columns]);

  const filterOptions = useCallback((colId) => {
    const vals = new Set();
    for (const r of rows) {
      const v = String(r.values[colId] ?? '').trim();
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) => a.localeCompare(b, 'id'));
  }, [rows]);

  // Baris yang lolos semua filter yang aktif (berlaku untuk tabel, grafik & prediksi).
  // string = cocok persis, tanggal = rentang tanggal, int/double = rentang angka.
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      for (const [k, f] of Object.entries(filters)) {
        if (f === '' || f == null) continue;
        const col = columns.find((c) => c.id === k);
        if (!col) continue;
        if (col.type === 'string') {
          if (String(r.values[k] ?? '') !== f) return false;
        } else if (col.type === 'tanggal') {
          const d = new Date(r.values.tanggal);
          if (Number.isNaN(d.getTime())) return false;
          if (f.from && d < new Date(`${f.from}T00:00:00.000Z`)) return false;
          if (f.to && d > new Date(`${f.to}T23:59:59.999Z`)) return false;
        } else {
          const n = Number(r.values[k]);
          if (Number.isNaN(n)) return false;
          if (f.min !== '' && f.min != null && n < Number(f.min)) return false;
          if (f.max !== '' && f.max != null && n > Number(f.max)) return false;
        }
      }
      return true;
    });
  }, [rows, filters, columns]);

  const sortedFilteredRows = useMemo(() => {
    const copy = [...filteredRows];
    copy.sort((a, b) => new Date(a.values.tanggal) - new Date(b.values.tanggal));
    return copy;
  }, [filteredRows]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch('/api/data', { cache: 'no-store' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memuat data.');
      setColumns(j.columns);
      setRows(j.rows);
      setError('');
      setRowForm((prev) => {
        const next = { ...prev };
        for (const c of j.columns) {
          if (!(c.id in next)) next[c.id] = c.type === 'tanggal' ? nowInput() : '';
        }
        return next;
      });
      setChartY((prev) => {
        const ids = j.columns.filter((c) => c.type === 'int' || c.type === 'double').map((c) => c.id);
        return prev.filter((id) => ids.includes(id));
      });
      // Buang filter yang nilainya sudah tidak ada di data (string) atau
      // kolomnya sudah dihapus (semua tipe).
      setFilters((prev) => {
        const next = {};
        for (const [k, v] of Object.entries(prev)) {
          const col = j.columns.find((c) => c.id === k);
          if (!col) continue;
          if (col.type === 'string') {
            if (!v) continue;
            if (!j.rows.some((r) => String(r.values[k] ?? '') === v)) continue;
            next[k] = v;
          } else if (v && typeof v === 'object' && Object.values(v).some((x) => x !== '' && x != null)) {
            next[k] = v;
          }
        }
        return next;
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Poll status prediksi selama masih berjalan.
  useEffect(() => {
    if (!job || (job.status !== 'pending' && job.status !== 'processing')) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/predict?id=${job.id}`, { cache: 'no-store' });
        const j = await res.json();
        if (!res.ok) return;
        if (!j.job) { setJob(null); return; }
        setJob(j.job);
        if (j.job.status === 'done') setResult(j.result);
        if (j.job.status === 'error') setPredMsg(j.job.error || 'Prediksi gagal.');
      } catch (e) { /* coba lagi di interval berikut */ }
    }, 3000);
    return () => clearInterval(t);
  }, [job]);

  async function tambahKolom(e) {
    e.preventDefault();
    setColBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/columns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: colName, type: colType }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menambah kolom.');
      setColumns(j.columns);
      setRows(j.rows);
      setColName('');
      setMsg(`Kolom "${j.added.name}" (${j.added.type}) ditambahkan. Baris lama diisi ${j.added.type === 'string' ? 'kosong' : '0'}.`);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setColBusy(false);
    }
  }

  async function tambahRow(e) {
    e.preventDefault();
    setRowBusy(true);
    setMsg('');
    try {
      const values = {};
      for (const c of columns) {
        if (c.type === 'tanggal') {
          values.tanggal = rowForm.tanggal ? new Date(rowForm.tanggal).toISOString() : new Date().toISOString();
        } else {
          values[c.id] = rowForm[c.id] ?? '';
        }
      }
      const res = await fetch('/api/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menambah baris.');
      setRows(j.rows);
      setRowForm((prev) => ({ ...prev, tanggal: nowInput() }));
      setMsg('Baris masuk ke tabel.');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setRowBusy(false);
    }
  }

  async function hapusRow(id) {
    if (!confirm('Hapus baris ini?')) return;
    const res = await fetch(`/api/rows?id=${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (res.ok) setRows(j.rows);
    else setMsg(j.error || 'Gagal menghapus baris.');
  }

  async function hapusKolom(col) {
    if (!confirm(`Hapus kolom "${col.name}"? Semua data di kolom ini ikut terhapus.`)) return;
    setDelBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/columns?id=${col.id}`, { method: 'DELETE' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menghapus kolom.');
      setColumns(j.columns);
      setRows(j.rows);
      setChartY((prev) => prev.filter((id) => id !== col.id));
      setPredCols((prev) => prev.filter((id) => id !== col.id));
      setRowForm((prev) => {
        const next = { ...prev };
        delete next[col.id];
        return next;
      });
      setDelColId('');
      setFilters((prev) => {
        const next = { ...prev };
        delete next[col.id];
        return next;
      });
      if (chartX === col.id) setChartX('tanggal');
      if (result && result.columns && result.columns[col.id]) {
        setResult(null);
        setJob(null);
      }
      setMsg(`Kolom "${col.name}" dihapus.`);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setDelBusy(false);
    }
  }

  async function isiContoh() {
    setSampleBusy(true);
    setMsg('');
    try {
      let cols = columns;
      let jumlahId = cols.find((c) => c.type === 'int' || c.type === 'double')?.id;
      if (!jumlahId) {
        const r = await fetch('/api/columns', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Jumlah Barang', type: 'int' }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Gagal membuat kolom contoh.');
        cols = j.columns;
        jumlahId = j.added.id;
      }
      const base = new Date();
      base.setHours(10, 0, 0, 0);
      for (let i = 13; i >= 0; i--) {
        const d = new Date(base);
        d.setDate(d.getDate() - i);
        const dow = d.getDay();
        const weekend = dow === 0 || dow === 6;
        const val = Math.round(110 + (weekend ? -25 : 25) + 18 * Math.sin(i / 2.2) + (i % 3) * 7);
        await fetch('/api/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: { tanggal: d.toISOString(), [jumlahId]: val } }),
        });
      }
      await loadData();
      setMsg('14 baris contoh ditambahkan (14 hari terakhir, Jumlah Barang).');
    } catch (err) {
      setMsg(err.message);
    } finally {
      setSampleBusy(false);
    }
  }

  async function jalankanPrediksi(e) {
    e.preventDefault();
    setPredBusy(true);
    setPredMsg('');
    setResult(null);
    try {
      const res = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          columns: predScope === 'all' ? 'all' : predCols,
          horizon,
          filters: buildJobFilters(),
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal memulai prediksi.');
      setJob(j.job);
      setPredMsg('Prediksi dikirim ke worker TimesFM, mohon tunggu…');
    } catch (err) {
      setPredMsg(err.message);
    } finally {
      setPredBusy(false);
    }
  }

  const sortedRows = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => new Date(a.values.tanggal) - new Date(b.values.tanggal));
    return copy;
  }, [rows]);

  const chartData = useMemo(() => {
    if (chartY.length === 0) return [];
    if (chartX === 'tanggal') {
      return sortedFilteredRows.map((r) => {
        const p = { x: fmtTick(r.values.tanggal), full: r.values.tanggal };
        for (const id of chartY) p[id] = r.values[id];
        return p;
      });
    }
    const copy = [...filteredRows].sort((a, b) => (a.values[chartX] ?? 0) - (b.values[chartX] ?? 0));
    return copy.map((r) => {
      const p = { x: r.values[chartX], full: r.values.tanggal };
      for (const id of chartY) p[id] = r.values[id];
      return p;
    });
  }, [sortedFilteredRows, filteredRows, chartX, chartY]);

  // Kolom hasil prediksi yang masih ada di skema (kolom yang sudah dihapus disaring).
  const predColIds = useMemo(() => {
    if (!result) return [];
    return Object.keys(result.columns).filter((id) => columns.some((c) => c.id === id));
  }, [result, columns]);

  const forecastChart = useMemo(() => {
    if (!result || predColIds.length === 0) return [];
    const pts = sortedFilteredRows.map((r) => {
      const p = { t: fmtTick(r.values.tanggal), full: r.values.tanggal, _sort: new Date(r.values.tanggal).getTime() };
      for (const id of predColIds) p[id] = r.values[id];
      return p;
    });
    const first = result.columns[predColIds[0]];
    if (!first) return pts;
    first.dates.forEach((iso, i) => {
      const p = { t: fmtTick(iso), full: iso, _sort: new Date(iso).getTime() };
      for (const id of predColIds) p[`${id}_pred`] = result.columns[id].values[i];
      pts.push(p);
    });
    pts.sort((a, b) => a._sort - b._sort);
    return pts;
  }, [result, sortedFilteredRows, predColIds]);

  function toggleY(id) {
    setChartY((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // Titik yang diklik di grafik — ditampilkan sebagai kotak detail di bawah grafik.
  const [selected, setSelected] = useState(null);

  function handlePointClick(state, chart) {
    if (!state || !state.activePayload || state.activePayload.length === 0) return;
    const first = state.activePayload[0].payload;
    setSelected({
      chart,
      title: first.full ? fmtDate(first.full) : state.activeLabel,
      lines: state.activePayload
        .filter((p) => p.value !== undefined && p.value !== null)
        .map((p) => ({ name: p.name, value: p.value })),
    });
  }

  function selectedBox(chart) {
    if (!selected || selected.chart !== chart) return null;
    return (
      <div className="msg" style={{ background: '#eaf3fb', borderRadius: 8, padding: '10px 12px' }}>
        <strong>{selected.title}</strong>
        {selected.lines.map((l) => (
          <div key={l.name}>{l.name}: {fmtNum(l.value)}</div>
        ))}
        <button className="ghost" style={{ marginTop: 6, padding: '4px 10px', fontSize: 12 }} onClick={() => setSelected(null)}>Tutup</button>
      </div>
    );
  }

  // Ubah satu filter rentang (tanggal/angka); entri dihapus kalau kosong semua.
  function setFilterValue(colId, patch) {
    setFilters((p) => {
      const cur = p[colId];
      const base = cur && typeof cur === 'object' ? cur : {};
      const next = { ...base, ...patch };
      const hasValue = Object.values(next).some((v) => v !== '' && v !== null && v !== undefined);
      const out = { ...p };
      if (hasValue) out[colId] = next;
      else delete out[colId];
      return out;
    });
  }

  // Kontrol filter per kolom: string = dropdown nilai unik, tanggal = rentang
  // tanggal, int/double = rentang angka.
  function filterControl(c) {
    const f = filters[c.id];
    if (c.type === 'string') {
      return (
        <div className="field" style={{ flex: '0 0 200px' }} key={c.id}>
          <label>{c.name}</label>
          <select value={typeof f === 'string' ? f : ''} onChange={(e) => setFilters((p) => ({ ...p, [c.id]: e.target.value }))}>
            <option value="">Semua {c.name}</option>
            {filterOptions(c.id).map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      );
    }
    if (c.type === 'tanggal') {
      const from = (f && f.from) || '';
      const to = (f && f.to) || '';
      return (
        <div className="field" style={{ flex: '0 0 320px' }} key={c.id}>
          <label>{c.name} (rentang tanggal)</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input type="date" value={from} onChange={(e) => setFilterValue(c.id, { from: e.target.value })} />
            <input type="date" value={to} onChange={(e) => setFilterValue(c.id, { to: e.target.value })} />
          </div>
        </div>
      );
    }
    const min = (f && f.min) ?? '';
    const max = (f && f.max) ?? '';
    return (
      <div className="field" style={{ flex: '0 0 240px' }} key={c.id}>
        <label>{c.name} (rentang angka)</label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" step="any" placeholder="Min" value={min} onChange={(e) => setFilterValue(c.id, { min: e.target.value })} />
          <input type="number" step="any" placeholder="Maks" value={max} onChange={(e) => setFilterValue(c.id, { max: e.target.value })} />
        </div>
      </div>
    );
  }

  // Filter untuk dikirim ke API prediksi (tanggal jadi ISO lengkap).
  function buildJobFilters() {
    const out = {};
    for (const [k, f] of Object.entries(filters)) {
      if (f === '' || f == null) continue;
      const col = columns.find((c) => c.id === k);
      if (!col) continue;
      if (col.type === 'string') {
        out[k] = f;
      } else if (col.type === 'tanggal') {
        const o = {};
        if (f.from) o.from = `${f.from}T00:00:00.000Z`;
        if (f.to) o.to = `${f.to}T23:59:59.999Z`;
        if (Object.keys(o).length) out[k] = o;
      } else {
        const o = {};
        if (f.min !== '' && f.min != null) o.min = Number(f.min);
        if (f.max !== '' && f.max != null) o.max = Number(f.max);
        if (Object.keys(o).length) out[k] = o;
      }
    }
    return out;
  }

  // Tampilkan satu filter terpakai di baris meta hasil prediksi.
  function fmtFilter(k, v) {
    const col = columns.find((c) => c.id === k);
    const name = col?.name || k;
    if (typeof v === 'string') return `${name} = ${v}`;
    if (col?.type === 'tanggal') {
      const parts = [];
      if (v.from) parts.push(`dari ${fmtDate(v.from)}`);
      if (v.to) parts.push(`sampai ${fmtDate(v.to)}`);
      return `${name} ${parts.join(' ')}`;
    }
    const parts = [];
    if (v.min != null) parts.push(`≥ ${fmtNum(v.min)}`);
    if (v.max != null) parts.push(`≤ ${fmtNum(v.max)}`);
    return `${name} ${parts.join(' ')}`;
  }

  return (
    <>
      <header className="topbar">
        <h1>Logi<span>Track</span></h1>
        <p>Dashboard pelacakan logistik — tabel dinamis, grafik &amp; prediksi TimesFM</p>
      </header>
      <main>
        {loading && <div className="card"><p className="empty">Memuat data…</p></div>}
        {error && (
          <div className="card">
            <p className="msg err">{error}</p>
            <p className="legend">Pastikan KV (Upstash) sudah terhubung ke proyek Vercel ini, lalu muat ulang halaman.</p>
          </div>
        )}
        {!loading && !error && (
          <>
            <div className="card">
              <h2>Ringkasan</h2>
              <p className="sub">Kolom tanggal/waktu adalah feature (sumbu waktu). Kolom angka (int/double) adalah label yang bisa digrafik dan diprediksi. Semua kolom bisa difilter: tanggal pakai rentang tanggal, angka pakai rentang angka, teks pakai pilihan nilai.</p>
              <span className="pill">{columns.length} kolom</span>{' '}
              <span className="pill">{rows.length} baris</span>{' '}
              {job && <span className={`pill ${job.status === 'done' ? 'ok' : job.status === 'error' ? 'err' : 'warn'}`}>Prediksi: {job.status}</span>}
            </div>

            <div className="card">
              <h2>Filter Data</h2>
              <p className="sub">Filter berlaku untuk tabel, grafik, dan prediksi. Tanggal pakai rentang tanggal, angka pakai rentang angka, teks pakai pilihan nilai dari kolom.</p>
              {columns.length === 0 ? (
                <p className="empty">Belum ada kolom.</p>
              ) : (
                <div className="row">
                  {columns.map((c) => filterControl(c))}
                </div>
              )}
              <div className="row" style={{ marginTop: 12 }}>
                <button className="ghost" onClick={() => setFilters({})} disabled={Object.keys(filters).length === 0}>Reset filter</button>
                <span className="legend">Menampilkan {filteredRows.length} dari {rows.length} baris.</span>
              </div>
            </div>

            <div className="card">
              <h2>Tabel Data</h2>
              <p className="sub">Baris terbaru ada di bawah. Tambah kolom baru: baris lama otomatis terisi 0 (int/double) atau kosong (string).</p>
              {rows.length === 0 ? (
                <p className="empty">Belum ada baris. Tambahkan lewat form di bawah, atau isi data contoh untuk mencoba grafik &amp; prediksi.</p>
              ) : sortedFilteredRows.length === 0 ? (
                <p className="empty">Tidak ada baris yang cocok dengan filter. Ubah atau reset filter di atas.</p>
              ) : (
                <div className="tablewrap">
                  <table>
                    <thead>
                      <tr>
                        {columns.map((c) => (
                          <th key={c.id} className={c.type === 'int' || c.type === 'double' ? 'num' : ''}>
                            {c.name} <span style={{ fontWeight: 400 }}>({c.type})</span>
                            {c.type !== 'tanggal' && (
                              <button
                                className="danger"
                                style={{ marginLeft: 8, padding: '2px 8px', fontSize: 12 }}
                                onClick={() => hapusKolom(c)}
                                title={`Hapus kolom ${c.name}`}
                              >
                                Hapus
                              </button>
                            )}
                          </th>
                        ))}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedFilteredRows.map((r) => (
                        <tr key={r.id}>
                          {columns.map((c) => (
                            <td key={c.id} className={c.type === 'int' || c.type === 'double' ? 'num' : ''}>
                              {c.type === 'tanggal' ? fmtDate(r.values.tanggal) : c.type === 'string' ? (r.values[c.id] ?? '') : fmtNum(r.values[c.id])}
                            </td>
                          ))}
                          <td><button className="danger" onClick={() => hapusRow(r.id)}>Hapus</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <div style={{ marginTop: 12 }} className="row">
                <button className="ghost" onClick={isiContoh} disabled={sampleBusy}>
                  {sampleBusy ? 'Mengisi…' : 'Isi data contoh (14 hari)'}
                </button>
                <button className="ghost" onClick={loadData}>Muat ulang</button>
              </div>
            </div>

            <div className="card">
              <h2>Tambah Kolom</h2>
              <p className="sub">Kolom baru langsung muncul di tabel paling atas dan di form tambah baris.</p>
              <form onSubmit={tambahKolom} className="row">
                <div className="field">
                  <label>Nama kolom</label>
                  <input value={colName} onChange={(e) => setColName(e.target.value)} placeholder="mis. Jumlah Barang" />
                </div>
                <div className="field" style={{ flex: '0 0 160px' }}>
                  <label>Tipe data</label>
                  <select value={colType} onChange={(e) => setColType(e.target.value)}>
                    <option value="int">int (bilangan bulat)</option>
                    <option value="double">double (desimal)</option>
                    <option value="string">string (teks)</option>
                  </select>
                </div>
                <button type="submit" disabled={colBusy}>{colBusy ? 'Menambah…' : 'Tambah kolom'}</button>
              </form>
              <div style={{ marginTop: 14 }}>
                <p className="sub" style={{ marginBottom: 6 }}>Hapus kolom — kolom Tanggal tidak bisa dihapus. Data di kolom yang dihapus ikut terhapus.</p>
                <div className="row">
                  <div className="field" style={{ flex: '0 0 240px' }}>
                    <select value={delColId} onChange={(e) => setDelColId(e.target.value)}>
                      <option value="">Pilih kolom…</option>
                      {columns.filter((c) => c.type !== 'tanggal').map((c) => (
                        <option key={c.id} value={c.id}>{c.name} ({c.type})</option>
                      ))}
                    </select>
                  </div>
                  <button
                    className="danger"
                    style={{ padding: '10px 18px', fontSize: 14 }}
                    disabled={!delColId || delBusy}
                    onClick={() => {
                      const col = columns.find((c) => c.id === delColId);
                      if (col) hapusKolom(col);
                    }}
                  >
                    {delBusy ? 'Menghapus…' : 'Hapus kolom'}
                  </button>
                </div>
              </div>
            </div>

            <div className="card">
              <h2>Tambah Baris</h2>
              <p className="sub">Tanggal defaultnya tanggal &amp; jam sekarang — bisa diubah. Klik Masukan, data langsung masuk ke tabel.</p>
              <form onSubmit={tambahRow} className="row">
                {columns.map((c) => (
                  <div className="field" key={c.id}>
                    <label>{c.name} <span className="type">({c.type})</span></label>
                    {c.type === 'tanggal' ? (
                      <input
                        type="datetime-local"
                        value={rowForm.tanggal || ''}
                        onChange={(e) => setRowForm((p) => ({ ...p, tanggal: e.target.value }))}
                      />
                    ) : c.type === 'string' ? (
                      <input
                        type="text"
                        value={rowForm[c.id] ?? ''}
                        onChange={(e) => setRowForm((p) => ({ ...p, [c.id]: e.target.value }))}
                        placeholder="teks"
                      />
                    ) : (
                      <input
                        type="number"
                        step={c.type === 'int' ? 1 : 'any'}
                        value={rowForm[c.id] ?? ''}
                        onChange={(e) => setRowForm((p) => ({ ...p, [c.id]: e.target.value }))}
                        placeholder="0"
                      />
                    )}
                  </div>
                ))}
                <button type="submit" className="primary" disabled={rowBusy}>{rowBusy ? 'Memasukkan…' : 'Masukan'}</button>
              </form>
              {msg && <p className="msg">{msg}</p>}
            </div>

            <div className="card">
              <h2>Grafik</h2>
              <p className="sub">Pilih sumbu X dan kolom Y yang mau ditampilkan. Bisa juga plot semua kolom angka sekaligus dengan X = tanggal. Klik titik di grafik untuk melihat detail tanggal &amp; jam dan nilainya.</p>
              <div className="row">
                <div className="field" style={{ flex: '0 0 200px' }}>
                  <label>Sumbu X</label>
                  <select value={chartX} onChange={(e) => setChartX(e.target.value)}>
                    <option value="tanggal">Tanggal</option>
                    {numericCols.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Sumbu Y (kolom angka)</label>
                  <div className="checks">
                    {numericCols.length === 0 && <span className="legend">Belum ada kolom angka.</span>}
                    {numericCols.map((c) => (
                      <label key={c.id}>
                        <input type="checkbox" checked={chartY.includes(c.id)} onChange={() => toggleY(c.id)} />
                        {c.name}
                      </label>
                    ))}
                  </div>
                </div>
                <button className="ghost" onClick={() => setChartY(numericCols.map((c) => c.id))} disabled={numericCols.length === 0}>
                  Semua kolom
                </button>
              </div>
              {chartData.length === 0 ? (
                <p className="empty">Pilih minimal satu kolom Y untuk menampilkan grafik.</p>
              ) : (
                <div style={{ height: 320, marginTop: 12 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 8 }} onClick={(s) => handlePointClick(s, 'main')}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="x" tick={{ fontSize: 12 }} />
                      <YAxis tick={{ fontSize: 12 }} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      {chartY.map((id, i) => (
                        <Line
                          key={id}
                          type="monotone"
                          dataKey={id}
                          name={columns.find((c) => c.id === id)?.name || id}
                          stroke={COLORS[i % COLORS.length]}
                          strokeWidth={2}
                          dot={false}
                        />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {selectedBox('main')}
            </div>

            <div className="card">
              <h2>Prediksi ke Depan (TimesFM)</h2>
              <p className="sub">Feature: kolom tanggal/waktu. Label: kolom angka yang dipilih. Atur mau berapa data ke depan yang diprediksi.</p>
              <form onSubmit={jalankanPrediksi} className="row">
                <div className="field" style={{ flex: '0 0 220px' }}>
                  <label>Kolom yang diprediksi</label>
                  <select value={predScope} onChange={(e) => setPredScope(e.target.value)}>
                    <option value="all">Semua kolom angka</option>
                    <option value="pick">Pilih kolom…</option>
                  </select>
                </div>
                {predScope === 'pick' && (
                  <div className="field">
                    <label>Pilih kolom</label>
                    <div className="checks">
                      {numericCols.map((c) => (
                        <label key={c.id}>
                          <input
                            type="checkbox"
                            checked={predCols.includes(c.id)}
                            onChange={() => setPredCols((p) => (p.includes(c.id) ? p.filter((x) => x !== c.id) : [...p, c.id]))}
                          />
                          {c.name}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="field" style={{ flex: '0 0 140px' }}>
                  <label>Jumlah prediksi</label>
                  <input type="number" min={1} max={60} value={horizon} onChange={(e) => setHorizon(e.target.value)} />
                </div>
                <button type="submit" className="primary" disabled={predBusy || numericCols.length === 0}>
                  {predBusy ? 'Mengirim…' : 'Jalankan prediksi'}
                </button>
              </form>
              {predMsg && <p className="msg">{predMsg}</p>}
              {job && job.status === 'error' && <p className="msg err">{job.error}</p>}
              {result && predColIds.length === 0 && (
                <p className="legend">Hasil prediksi ini memakai kolom yang sudah dihapus — jalankan prediksi lagi.</p>
              )}
              {result && predColIds.length > 0 && (
                <>
                  {result.meta?.warning && <p className="msg">{result.meta.warning}</p>}
                  {Object.keys(result.meta?.skipped || {}).length > 0 && (
                    <p className="legend">Dilewati: {Object.entries(result.meta.skipped).map(([k, v]) => `${columns.find((c) => c.id === k)?.name || k} (${v})`).join('; ')}</p>
                  )}
                  <div style={{ height: 320, marginTop: 12 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={forecastChart} margin={{ top: 8, right: 16, bottom: 8, left: 8 }} onClick={(s) => handlePointClick(s, 'forecast')}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="t" tick={{ fontSize: 12 }} />
                        <YAxis tick={{ fontSize: 12 }} />
                        <Tooltip content={<ChartTooltip />} />
                        <Legend />
                        {predColIds.map((id, i) => (
                          <Line key={id} type="monotone" dataKey={id} name={`${columns.find((c) => c.id === id)?.name || id} (aktual)`} stroke={COLORS[i % COLORS.length]} strokeWidth={2} dot={false} connectNulls={false} />
                        ))}
                        {predColIds.map((id, i) => (
                          <Line key={`${id}_pred`} type="monotone" dataKey={`${id}_pred`} name={`${columns.find((c) => c.id === id)?.name || id} (prediksi)`} stroke={COLORS[i % COLORS.length]} strokeWidth={2} strokeDasharray="6 4" dot={false} connectNulls />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  {selectedBox('forecast')}
                  <div className="tablewrap" style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Tanggal prediksi</th>
                          {predColIds.map((id) => (
                            <th key={id} className="num">{columns.find((c) => c.id === id)?.name || id}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {result.columns[predColIds[0]].dates.map((iso, i) => (
                          <tr key={iso}>
                            <td>{fmtDate(iso)}</td>
                            {predColIds.map((id) => (
                              <td key={id} className="num">{fmtNum(result.columns[id].values[i])}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="legend">Diprediksi {result.at ? `pada ${fmtDate(result.at)}` : ''} · {result.meta?.rows_used} baris dipakai{result.meta?.rows_total ? ` dari ${result.meta.rows_total}` : ''} · garis putus-putus = prediksi.</p>
                  {result.meta?.filters && Object.keys(result.meta.filters).length > 0 && (
                    <p className="legend">Filter: {Object.entries(result.meta.filters).map(([k, v]) => fmtFilter(k, v)).join('; ')}</p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </main>
      <footer>LogiTrack · data tersimpan di Upstash KV · prediksi oleh TimesFM 3.0 (Google) di sandbox</footer>
    </>
  );
}
