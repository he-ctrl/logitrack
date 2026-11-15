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

const VIEWS = [
  { id: 'ringkasan', label: 'Ringkasan', roles: ['logistik', 'supervisor'] },
  { id: 'tabel', label: 'Tabel', roles: ['logistik', 'supervisor'] },
  { id: 'filter', label: 'Filter Data', roles: ['logistik', 'supervisor'] },
  { id: 'grafik', label: 'Grafik', roles: ['logistik', 'supervisor'] },
  { id: 'prediksi', label: 'Prediksi', roles: ['logistik', 'supervisor'] },
  { id: 'input', label: 'Input Data', roles: ['logistik'] },
  { id: 'kolom', label: 'Kelola Kolom', roles: ['logistik'] },
];

const isNumeric = (c) => c.type === 'int' || c.type === 'double' || c.type === 'rumus';

function nowInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function toInput(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
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
  if (v === null || v === undefined) return '—';
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
  const [me, setMe] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [view, setView] = useState('ringkasan');

  const [columns, setColumns] = useState([]);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  const [colName, setColName] = useState('');
  const [colType, setColType] = useState('int');
  const [formulaText, setFormulaText] = useState('');
  const [colBusy, setColBusy] = useState(false);
  const [delColId, setDelColId] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [editFormulaId, setEditFormulaId] = useState('');
  const [editFormulaText, setEditFormulaText] = useState('');
  const [formulaBusy, setFormulaBusy] = useState(false);

  const [rowForm, setRowForm] = useState({ tanggal: nowInput() });
  const [rowBusy, setRowBusy] = useState(false);
  const [editingRow, setEditingRow] = useState(null);
  const [editBusy, setEditBusy] = useState(false);

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

  const [filters, setFilters] = useState({});
  const [selected, setSelected] = useState(null);

  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const isLogistik = me?.role === 'logistik';
  const numericCols = useMemo(() => columns.filter(isNumeric), [columns]);
  const formulaCols = useMemo(() => columns.filter((c) => c.type === 'rumus'), [columns]);
  const visibleViews = VIEWS.filter((v) => !me || v.roles.includes(me.role));

  const filterOptions = useCallback((colId) => {
    const vals = new Set();
    for (const r of rows) {
      const v = String(r.values[colId] ?? '').trim();
      if (v) vals.add(v);
    }
    return [...vals].sort((a, b) => a.localeCompare(b, 'id'));
  }, [rows]);

  // Baris yang lolos semua filter yang aktif (berlaku untuk tabel, grafik & prediksi).
  // string = cocok persis, tanggal = rentang tanggal, int/double/rumus = rentang angka.
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
      if (res.status === 401) { setMe(null); return; }
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
        const ids = j.columns.filter(isNumeric).map((c) => c.id);
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

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) {
        setMe({ username: j.username, role: j.role });
        setLoading(true);
        await loadData();
      }
    } catch (e) { /* belum login */ }
    setAuthChecked(true);
  }, [loadData]);

  useEffect(() => { checkAuth(); }, [checkAuth]);

  async function login(e) {
    e.preventDefault();
    setLoginBusy(true);
    setLoginErr('');
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Login gagal.');
      setMe({ username: j.username, role: j.role });
      setLoginPass('');
      setLoading(true);
      await loadData();
    } catch (err) {
      setLoginErr(err.message);
    } finally {
      setLoginBusy(false);
    }
  }

  async function logout() {
    await fetch('/api/auth', { method: 'DELETE' });
    setMe(null);
    setColumns([]);
    setRows([]);
    setJob(null);
    setResult(null);
    setView('ringkasan');
  }

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
        body: JSON.stringify({ name: colName, type: colType, formula: colType === 'rumus' ? formulaText : undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menambah kolom.');
      setColumns(j.columns);
      setRows(j.rows);
      setColName('');
      setFormulaText('');
      setMsg(
        colType === 'rumus'
          ? `Kolom rumus "${j.added.name}" ditambahkan (= ${j.added.formula}). Nilainya terhitung otomatis di semua baris.`
          : `Kolom "${j.added.name}" (${j.added.type}) ditambahkan. Baris lama diisi ${j.added.type === 'string' ? 'kosong' : '0'}.`
      );
    } catch (err) {
      setMsg(err.message);
    } finally {
      setColBusy(false);
    }
  }

  async function simpanRumus(e) {
    e.preventDefault();
    if (!editFormulaId) return;
    setFormulaBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/columns', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editFormulaId, formula: editFormulaText }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal mengubah rumus.');
      setColumns(j.columns);
      setRows(j.rows);
      setMsg(`Rumus kolom "${j.updated.name}" diubah dan semua baris dihitung ulang.`);
    } catch (err) {
      setMsg(err.message);
    } finally {
      setFormulaBusy(false);
    }
  }

  function collectRowValues(form) {
    const values = {};
    for (const c of columns) {
      if (c.type === 'tanggal') {
        values.tanggal = form.tanggal ? new Date(form.tanggal).toISOString() : new Date().toISOString();
      } else if (c.type !== 'rumus') {
        values[c.id] = form[c.id] ?? '';
      }
    }
    return values;
  }

  async function tambahRow(e) {
    e.preventDefault();
    setRowBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/rows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ values: collectRowValues(rowForm) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menambah baris.');
      setRows(j.rows);
      setRowForm((prev) => ({ ...prev, tanggal: nowInput() }));
      const warn = (j.formulaWarnings || []).map((w) => `${w.column}: ${w.error}`).join('; ');
      setMsg('Baris masuk ke tabel.' + (warn ? ` Perhatian rumus — ${warn}` : ''));
    } catch (err) {
      setMsg(err.message);
    } finally {
      setRowBusy(false);
    }
  }

  function startEdit(row) {
    const values = {};
    for (const c of columns) {
      if (c.type === 'tanggal') values.tanggal = toInput(row.values.tanggal);
      else if (c.type !== 'rumus') values[c.id] = row.values[c.id] ?? '';
    }
    setEditingRow({ id: row.id, values });
    setMsg('');
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!editingRow) return;
    setEditBusy(true);
    setMsg('');
    try {
      const res = await fetch('/api/rows', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editingRow.id, values: collectRowValues(editingRow.values) }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal mengubah baris.');
      setRows(j.rows);
      setEditingRow(null);
      const warn = (j.formulaWarnings || []).map((w) => `${w.column}: ${w.error}`).join('; ');
      setMsg('Baris diubah, kolom rumus dihitung ulang.' + (warn ? ` Perhatian rumus — ${warn}` : ''));
    } catch (err) {
      setMsg(err.message);
    } finally {
      setEditBusy(false);
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
        // Kirim SEMUA kolom biasa (angka lain = 0, string = kosong).
        // Kolom rumus tidak dikirim — server yang menghitungnya.
        const values = { tanggal: d.toISOString() };
        for (const c of cols) {
          if (c.type === 'tanggal' || c.type === 'rumus') continue;
          values[c.id] = c.id === jumlahId ? val : (c.type === 'string' ? '' : 0);
        }
        await fetch('/api/rows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ values }),
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

  async function gantiPassword(e) {
    e.preventDefault();
    setPwBusy(true);
    setPwMsg('');
    try {
      const res = await fetch('/api/auth', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPassword: pwOld, newPassword: pwNew }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal mengganti password.');
      setPwOld('');
      setPwNew('');
      setPwMsg('Password berhasil diganti.');
    } catch (err) {
      setPwMsg(err.message);
    } finally {
      setPwBusy(false);
    }
  }

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
  // tanggal, int/double/rumus = rentang angka.
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

  // Input untuk satu kolom di form baris (tambah & edit). Kolom rumus tidak
  // diinput — nilainya terhitung otomatis, jadi ditampilkan sebagai info.
  function rowField(c, form, setForm) {
    if (c.type === 'rumus') {
      return (
        <div className="field" key={c.id}>
          <label>{c.name} <span className="type">(rumus — otomatis)</span></label>
          <input type="text" value={c.formula || ''} disabled title="Terhitung otomatis dari rumus" />
        </div>
      );
    }
    if (c.type === 'tanggal') {
      return (
        <div className="field" key={c.id}>
          <label>{c.name} <span className="type">({c.type})</span></label>
          <input
            type="datetime-local"
            value={form.tanggal || ''}
            onChange={(e) => setForm((p) => ({ ...p, tanggal: e.target.value }))}
          />
        </div>
      );
    }
    if (c.type === 'string') {
      return (
        <div className="field" key={c.id}>
          <label>{c.name} <span className="type">({c.type})</span></label>
          <input
            type="text"
            value={form[c.id] ?? ''}
            onChange={(e) => setForm((p) => ({ ...p, [c.id]: e.target.value }))}
            placeholder="teks"
          />
        </div>
      );
    }
    return (
      <div className="field" key={c.id}>
        <label>{c.name} <span className="type">({c.type})</span></label>
        <input
          type="number"
          step={c.type === 'int' ? 1 : 'any'}
          value={form[c.id] ?? ''}
          onChange={(e) => setForm((p) => ({ ...p, [c.id]: e.target.value }))}
          placeholder="0"
        />
      </div>
    );
  }

  function cellValue(c, r) {
    if (c.type === 'tanggal') return fmtDate(r.values.tanggal);
    if (c.type === 'string') return r.values[c.id] ?? '';
    return fmtNum(r.values[c.id]);
  }

  if (!authChecked) {
    return (
      <>
        <header className="topbar"><h1>Logi<span>Track</span></h1></header>
        <main><div className="card"><p className="empty">Memuat…</p></div></main>
      </>
    );
  }

  if (!me) {
    return (
      <>
        <header className="topbar">
          <h1>Logi<span>Track</span></h1>
          <p>Dashboard pelacakan logistik — tabel dinamis, grafik &amp; prediksi TimesFM</p>
        </header>
        <main>
          <div className="card loginwrap">
            <h2>Masuk</h2>
            <p className="sub">Login untuk membuka dashboard. Role logistik bisa memakai semua fitur; supervisor hanya tabel, filter, grafik, dan prediksi.</p>
            <form onSubmit={login}>
              <div className="field" style={{ marginBottom: 10 }}>
                <label>Username</label>
                <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} placeholder="logistik / supervisor" autoComplete="username" />
              </div>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Password</label>
                <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} placeholder="password" autoComplete="current-password" />
              </div>
              <button type="submit" className="primary" disabled={loginBusy} style={{ width: '100%' }}>
                {loginBusy ? 'Memeriksa…' : 'Masuk'}
              </button>
            </form>
            {loginErr && <p className="msg err">{loginErr}</p>}
            <p className="legend" style={{ marginTop: 14 }}>
              Akun awal — logistik / logistik123 · supervisor / supervisor123. Segera ganti password setelah masuk (menu Ringkasan → Ganti Password).
            </p>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <header className="topbar">
        <h1>Logi<span>Track</span></h1>
        <p>Dashboard pelacakan logistik — tabel dinamis, grafik &amp; prediksi TimesFM</p>
      </header>
      <nav className="navbar">
        {visibleViews.map((v) => (
          <button key={v.id} className={view === v.id ? 'active' : ''} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
        <span className="spacer" />
        <span className="who"><b>{me.username}</b> · {me.role}</span>
        <button onClick={logout}>Keluar</button>
      </nav>
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
            {view === 'ringkasan' && (
              <>
                <div className="card">
                  <h2>Ringkasan</h2>
                  <p className="sub">Kolom tanggal/waktu adalah feature (sumbu waktu). Kolom angka (int/double/rumus) adalah label yang bisa digrafik dan diprediksi. Semua kolom bisa difilter: tanggal pakai rentang tanggal, angka pakai rentang angka, teks pakai pilihan nilai.</p>
                  <span className="pill">{columns.length} kolom</span>{' '}
                  <span className="pill">{rows.length} baris</span>{' '}
                  {formulaCols.length > 0 && <span className="pill">{formulaCols.length} kolom rumus</span>}{' '}
                  {job && <span className={`pill ${job.status === 'done' ? 'ok' : job.status === 'error' ? 'err' : 'warn'}`}>Prediksi: {job.status}</span>}
                  <p className="legend" style={{ marginTop: 12 }}>
                    Kamu masuk sebagai <b>{me.username}</b> (role <b>{me.role}</b>).
                    {isLogistik
                      ? ' Role logistik bisa memakai semua fitur: input & edit baris, kelola kolom, rumus, filter, grafik, dan prediksi.'
                      : ' Role supervisor hanya bisa melihat tabel, filter data, grafik, dan prediksi — tidak bisa menambah, mengubah, atau menghapus data.'}
                  </p>
                </div>
                <div className="card">
                  <h2>Ganti Password</h2>
                  <p className="sub">Ganti password akun kamu sendiri (minimal 6 karakter).</p>
                  <form onSubmit={gantiPassword} className="row">
                    <div className="field" style={{ flex: '0 0 200px' }}>
                      <label>Password lama</label>
                      <input type="password" value={pwOld} onChange={(e) => setPwOld(e.target.value)} autoComplete="current-password" />
                    </div>
                    <div className="field" style={{ flex: '0 0 200px' }}>
                      <label>Password baru</label>
                      <input type="password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} autoComplete="new-password" />
                    </div>
                    <button type="submit" disabled={pwBusy}>{pwBusy ? 'Menyimpan…' : 'Simpan password baru'}</button>
                  </form>
                  {pwMsg && <p className="msg">{pwMsg}</p>}
                </div>
              </>
            )}

            {view === 'tabel' && (
              <div className="card">
                <h2>Tabel Data</h2>
                <p className="sub">
                  {isLogistik
                    ? 'Klik Edit untuk mengubah baris (kolom rumus ikut dihitung ulang), Hapus untuk menghapus baris. Tambah kolom baru: baris lama otomatis terisi 0 (int/double) atau kosong (string).'
                    : 'Mode baca saja untuk supervisor — tabel ini tidak bisa diubah.'}
                </p>
                {editingRow && (
                  <form onSubmit={saveEdit} className="card" style={{ background: '#f7f9fb', marginBottom: 14 }}>
                    <h2 style={{ fontSize: 16 }}>Edit Baris</h2>
                    <div className="row">
                      {columns.map((c) => rowField(c, editingRow.values, (updater) => setEditingRow((prev) => ({ ...prev, values: typeof updater === 'function' ? updater(prev.values) : updater }))))}
                    </div>
                    <div className="row" style={{ marginTop: 12 }}>
                      <button type="submit" className="primary" disabled={editBusy}>{editBusy ? 'Menyimpan…' : 'Simpan perubahan'}</button>
                      <button type="button" className="ghost" onClick={() => setEditingRow(null)}>Batal</button>
                    </div>
                  </form>
                )}
                {rows.length === 0 ? (
                  <p className="empty">Belum ada baris. {isLogistik ? 'Tambahkan lewat menu Input Data, atau isi data contoh untuk mencoba grafik & prediksi.' : ''}</p>
                ) : sortedFilteredRows.length === 0 ? (
                  <p className="empty">Tidak ada baris yang cocok dengan filter. Ubah atau reset filter di menu Filter Data.</p>
                ) : (
                  <div className="tablewrap">
                    <table>
                      <thead>
                        <tr>
                          {columns.map((c) => (
                            <th key={c.id} className={isNumeric(c) ? 'num' : ''}>
                              {c.name} <span style={{ fontWeight: 400 }}>({c.type}{c.type === 'rumus' ? ` = ${c.formula}` : ''})</span>
                              {isLogistik && c.type !== 'tanggal' && (
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
                          {isLogistik && <th></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {sortedFilteredRows.map((r) => (
                          <tr key={r.id}>
                            {columns.map((c) => (
                              <td key={c.id} className={isNumeric(c) ? 'num' : ''}>{cellValue(c, r)}</td>
                            ))}
                            {isLogistik && (
                              <td style={{ whiteSpace: 'nowrap' }}>
                                <button className="ghost" style={{ padding: '4px 10px', fontSize: 13, marginRight: 6 }} onClick={() => startEdit(r)}>Edit</button>
                                <button className="danger" onClick={() => hapusRow(r.id)}>Hapus</button>
                              </td>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div style={{ marginTop: 12 }} className="row">
                  <button className="ghost" onClick={loadData}>Muat ulang</button>
                  <span className="legend">Menampilkan {sortedFilteredRows.length} dari {rows.length} baris (filter aktif dari menu Filter Data).</span>
                </div>
                {msg && <p className="msg">{msg}</p>}
              </div>
            )}

            {view === 'filter' && (
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
            )}

            {view === 'grafik' && (
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
            )}

            {view === 'prediksi' && (
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
            )}

            {view === 'input' && isLogistik && (
              <div className="card">
                <h2>Tambah Baris</h2>
                <p className="sub">Tanggal defaultnya tanggal &amp; jam sekarang — bisa diubah. Klik Masukan, data langsung masuk ke tabel. Kolom rumus terisi otomatis dari rumusnya, tidak perlu diisi.</p>
                <form onSubmit={tambahRow} className="row">
                  {columns.map((c) => rowField(c, rowForm, setRowForm))}
                  <button type="submit" className="primary" disabled={rowBusy}>{rowBusy ? 'Memasukkan…' : 'Masukan'}</button>
                </form>
                {msg && <p className="msg">{msg}</p>}
                <div style={{ marginTop: 16 }}>
                  <button className="ghost" onClick={isiContoh} disabled={sampleBusy}>
                    {sampleBusy ? 'Mengisi…' : 'Isi data contoh (14 hari)'}
                  </button>
                </div>
              </div>
            )}

            {view === 'kolom' && isLogistik && (
              <>
                <div className="card">
                  <h2>Tambah Kolom</h2>
                  <p className="sub">Kolom baru langsung muncul di tabel dan di form tambah baris. Tipe rumus: nilainya dihitung otomatis dari kolom lain setiap kali baris ditambah atau diubah.</p>
                  <form onSubmit={tambahKolom} className="row">
                    <div className="field">
                      <label>Nama kolom</label>
                      <input value={colName} onChange={(e) => setColName(e.target.value)} placeholder="mis. Total" />
                    </div>
                    <div className="field" style={{ flex: '0 0 180px' }}>
                      <label>Tipe data</label>
                      <select value={colType} onChange={(e) => setColType(e.target.value)}>
                        <option value="int">int (bilangan bulat)</option>
                        <option value="double">double (desimal)</option>
                        <option value="string">string (teks)</option>
                        <option value="rumus">rumus (hitung otomatis)</option>
                      </select>
                    </div>
                    <button type="submit" disabled={colBusy}>{colBusy ? 'Menambah…' : 'Tambah kolom'}</button>
                  </form>
                  {colType === 'rumus' && (
                    <div style={{ marginTop: 14 }}>
                      <div className="field">
                        <label>Rumus (PEMDAS: ^ lalu * / % lalu + -; pakai tanda kurung bila perlu)</label>
                        <input
                          value={formulaText}
                          onChange={(e) => setFormulaText(e.target.value)}
                          placeholder="[Harga] * [Jumlah Barang]"
                        />
                      </div>
                      <p className="legend" style={{ marginTop: 8 }}>Klik kolom di bawah untuk memasukkannya ke rumus:</p>
                      <div>
                        {numericCols.map((c) => (
                          <button key={c.id} type="button" className="chip" onClick={() => setFormulaText((p) => `${p}[${c.name}]`)}>{c.name}</button>
                        ))}
                        {numericCols.length === 0 && <span className="legend">Belum ada kolom angka — buat dulu kolom int/double.</span>}
                      </div>
                      <p className="legend">Contoh: kolom Total dari Harga dikali Jumlah Barang → <b>[Harga] * [Jumlah Barang]</b>. Operator yang bisa dipakai: + − * / % ^ dan ( ).</p>
                    </div>
                  )}
                  {msg && <p className="msg">{msg}</p>}
                </div>

                {formulaCols.length > 0 && (
                  <div className="card">
                    <h2>Ubah Rumus</h2>
                    <p className="sub">Ubah rumus kolom yang sudah ada — semua baris langsung dihitung ulang.</p>
                    <form onSubmit={simpanRumus} className="row">
                      <div className="field" style={{ flex: '0 0 200px' }}>
                        <label>Kolom rumus</label>
                        <select
                          value={editFormulaId}
                          onChange={(e) => {
                            setEditFormulaId(e.target.value);
                            const c = formulaCols.find((x) => x.id === e.target.value);
                            setEditFormulaText(c?.formula || '');
                          }}
                        >
                          <option value="">Pilih kolom…</option>
                          {formulaCols.map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div className="field">
                        <label>Rumus baru</label>
                        <input value={editFormulaText} onChange={(e) => setEditFormulaText(e.target.value)} placeholder="[Harga] * [Jumlah Barang]" />
                      </div>
                      <button type="submit" disabled={!editFormulaId || formulaBusy}>{formulaBusy ? 'Menyimpan…' : 'Simpan rumus'}</button>
                    </form>
                    <p className="legend" style={{ marginTop: 8 }}>Klik kolom di bawah untuk memasukkannya ke rumus:</p>
                    <div>
                      {numericCols.map((c) => (
                        <button key={c.id} type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}[${c.name}]`)}>{c.name}</button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="card">
                  <h2>Hapus Kolom</h2>
                  <p className="sub">Kolom Tanggal tidak bisa dihapus. Data di kolom yang dihapus ikut terhapus. Kolom yang dipakai rumus lain tidak bisa dihapus sebelum rumusnya diubah.</p>
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
                  {msg && <p className="msg">{msg}</p>}
                </div>
              </>
            )}
          </>
        )}
      </main>
      <footer>LogiTrack · data tersimpan di Upstash KV · prediksi oleh TimesFM 3.0 (Google) di sandbox</footer>
    </>
  );
}
