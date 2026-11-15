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

import { evalAggregate } from './lib/aggregate';
import { evalFormula } from './lib/formula';

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

// Palet warna pilihan kolom selection (dipakai juga sebagai warna default).
const SELECTION_COLORS = [
  { key: 'hijau', bg: '#1e8449' },
  { key: 'merah', bg: '#c0392b' },
  { key: 'biru', bg: '#2e86c1' },
  { key: 'kuning', bg: '#b7950b' },
  { key: 'ungu', bg: '#8e44ad' },
  { key: 'oranye', bg: '#d35400' },
  { key: 'pink', bg: '#c2185b' },
  { key: 'abu', bg: '#5d6d7e' },
];

// Warna teks kontras (hitam/putih) berdasarkan kecerahan latar.
function textOn(bg) {
  const m = /^#([0-9a-f]{6})$/i.exec(bg || '');
  if (!m) return '#fff';
  const r = parseInt(m[1].slice(0, 2), 16);
  const g = parseInt(m[1].slice(2, 4), 16);
  const b = parseInt(m[1].slice(4, 6), 16);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.6 ? '#1f2a36' : '#ffffff';
}

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

// Rumus panjang dipotong pakai "…" — hover (title) menampilkan lengkapnya,
// ketuk/klik juga bisa membuka-menutup lengkapnya (buat layar sentuh).
function FormulaText({ text, max = 40 }) {
  const [open, setOpen] = useState(false);
  if (!text || text.length <= max) return <span>{text}</span>;
  return (
    <span
      title={text}
      onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
      style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
    >
      {open ? text : `${text.slice(0, max)}…`}
    </span>
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
  const [autofillNote, setAutofillNote] = useState('');

  const [pwOld, setPwOld] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [pwMsg, setPwMsg] = useState('');
  const [pwBusy, setPwBusy] = useState(false);

  const [selOptions, setSelOptions] = useState([
    { value: 'in', color: '#1e8449' },
    { value: 'out', color: '#c0392b' },
  ]);
  const [aggFormula, setAggFormula] = useState('');
  const [aggName, setAggName] = useState('');
  const [savedAggs, setSavedAggs] = useState([]);
  const [aggBusy, setAggBusy] = useState(false);
  const [aggMsg, setAggMsg] = useState('');
  const [varName, setVarName] = useState('');
  const [varNumCol, setVarNumCol] = useState('');
  const [varAggFn, setVarAggFn] = useState('sum');
  const [varMsg, setVarMsg] = useState('');

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

  // Baris terakhir (tanggal terbaru) yang cocok dengan semua nilai kategori
  // yang sudah terisi di form — dipakai untuk isi otomatis.
  function latestMatchingRow(formValues) {
    const filled = columns.filter((c) => (c.type === 'string' || c.type === 'selection') && (formValues[c.id] ?? '') !== '');
    if (filled.length === 0) return null;
    const matches = rows.filter((r) =>
      filled.every((c) => String(r.values[c.id] ?? '') === String(formValues[c.id] ?? ''))
    );
    if (matches.length === 0) return null;
    matches.sort((a, b) => new Date(b.values.tanggal) - new Date(a.values.tanggal));
    return matches[0];
  }

  // Saat nilai string di form berubah: cari baris terakhir yang cocok,
  // lalu isi semua input lain dari baris itu (tanggal & rumus tidak ikut).
  function handleStringInput(c, value, form, setForm) {
    const next = { ...form, [c.id]: value };
    setForm(next);
    if (!value) { setAutofillNote(''); return; }
    const match = latestMatchingRow(next);
    if (!match) { setAutofillNote(''); return; }
    const filled = {};
    for (const col of columns) {
      if (col.type === 'tanggal' || col.type === 'rumus' || col.id === c.id) continue;
      const v = match.values[col.id];
      if (v !== undefined && v !== null && v !== '') filled[col.id] = v;
    }
    if (Object.keys(filled).length > 0) {
      setForm((p) => ({ ...p, ...filled }));
      setAutofillNote(`Diisi otomatis dari baris terakhir ${c.name} = "${value}" (${fmtDate(match.values.tanggal)}).`);
    } else {
      setAutofillNote('');
    }
  }

  // Ringkasan filter yang sedang aktif, untuk info di grafik & prediksi.
  function activeFilterSummary() {
    const parts = [];
    for (const [k, v] of Object.entries(filters)) {
      if (v === '' || v == null) continue;
      if (typeof v === 'object' && !Object.values(v).some((x) => x !== '' && x != null)) continue;
      parts.push(fmtFilter(k, v));
    }
    return parts.length > 0 ? parts.join(' · ') : 'Semua data (tanpa filter)';
  }

  // Baris yang lolos semua filter yang aktif (berlaku untuk tabel, grafik & prediksi).
  // string = cocok persis, tanggal = rentang tanggal, int/double/rumus = rentang angka.
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      for (const [k, f] of Object.entries(filters)) {
        if (f === '' || f == null) continue;
        const col = columns.find((c) => c.id === k);
        if (!col) continue;
        if (col.type === 'string' || col.type === 'selection') {
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

  // Nilai variabel dihitung dari BARIS YANG TAMPIL di tabel (filter aktif),
  // bukan seluruh data — kalau tabel difilter, nilai variabel ikut berubah.
  const aggValues = useMemo(() => {
    const out = {};
    for (const a of savedAggs) {
      out[a.id] = evalAggregate(a.formula, columns, sortedFilteredRows, savedAggs);
    }
    return out;
  }, [savedAggs, columns, sortedFilteredRows]);

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
        await loadAggs();
      }
    } catch (e) { /* belum login */ }
    setAuthChecked(true);
  }, [loadData]);

  const loadAggs = useCallback(async () => {
    try {
      const res = await fetch('/api/aggregates', { cache: 'no-store' });
      const j = await res.json();
      if (res.ok) setSavedAggs(j.aggregates || []);
    } catch (e) { /* abaikan */ }
  }, []);

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
      await loadAggs();
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
        body: JSON.stringify({ name: colName, type: colType, formula: colType === 'rumus' ? formulaText : undefined, options: colType === 'selection' ? selOptions : undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menambah kolom.');
      setColumns(j.columns);
      setRows(j.rows);
      setColName('');
      setFormulaText('');
      setSelOptions([
        { value: 'in', color: '#1e8449' },
        { value: 'out', color: '#c0392b' },
      ]);
      setMsg(
        colType === 'rumus'
          ? `Kolom rumus "${j.added.name}" ditambahkan (= ${j.added.formula}). Nilainya terhitung otomatis di semua baris.`
          : colType === 'selection'
            ? `Kolom selection "${j.added.name}" ditambahkan dengan ${j.added.options.length} pilihan (${j.added.options.map((o) => o.value).join(', ')}).`
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
      setAutofillNote('');
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
    setAutofillNote('');
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
      setAutofillNote('');
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

  async function simpanAggregate(e) {
    e.preventDefault();
    setAggBusy(true);
    setAggMsg('');
    try {
      const res = await fetch('/api/aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: aggName, formula: aggFormula }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan rumus.');
      setSavedAggs(j.aggregates);
      setAggName('');
      setAggMsg(`Variabel "${j.added.name}" disimpan.`);
    } catch (err) {
      setAggMsg(err.message);
    } finally {
      setAggBusy(false);
    }
  }

  async function hapusAggregate(id) {
    if (!confirm('Hapus variabel ini?')) return;
    const res = await fetch(`/api/aggregates?id=${id}`, { method: 'DELETE' });
    const j = await res.json();
    if (res.ok) setSavedAggs(j.aggregates);
    else setAggMsg(j.error || 'Gagal menghapus variabel.');
  }

  // Nama kolom untuk rumus: pakai [Nama] bila mengandung spasi/tanda.
  function bracketName(n) {
    return /[\s\[\]]/.test(n) ? `[${n}]` : n;
  }

  // Susun rumus variabel dari filter yang sedang aktif: agregat atas kolom
  // angka, dengan kondisi nilai:kolom dari filter teks/selection yang terisi.
  // Contoh: sum([jumlah][Bawang merah:Jenis barang; in:Arus]).
  function composeVarFormula(aggFn, numColId) {
    const numCol = columns.find((c) => c.id === numColId);
    if (!numCol) return '';
    const conds = [];
    for (const c of columns) {
      const f = filters[c.id];
      if ((c.type === 'string' || c.type === 'selection') && typeof f === 'string' && f) {
        conds.push(`${f}:${bracketName(c.name)}`);
      }
    }
    const colPart = bracketName(numCol.name);
    return conds.length ? `${aggFn}(${colPart}[${conds.join('; ')}])` : `${aggFn}(${colPart})`;
  }

  // Jadikan filter yang sedang aktif sebagai variabel tersimpan.
  async function simpanVariabelDariFilter(e) {
    e.preventDefault();
    const formula = composeVarFormula(varAggFn, varNumCol);
    if (!formula) { setVarMsg('Pilih dulu kolom angka untuk variabel ini.'); return; }
    setAggBusy(true);
    setVarMsg('');
    try {
      const res = await fetch('/api/aggregates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: varName, formula }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Gagal menyimpan variabel.');
      setSavedAggs(j.aggregates);
      setVarName('');
      setVarMsg(`Variabel "${j.added.name}" disimpan: ${j.added.formula}`);
    } catch (err) {
      setVarMsg(err.message);
    } finally {
      setAggBusy(false);
    }
  }

  const chartData = useMemo(() => {
    if (chartY.length === 0) return [];
    if (chartX === 'tanggal') {
      return sortedFilteredRows.map((r) => {
        const p = { x: fmtTick(r.values.tanggal), full: r.values.tanggal };
        for (const id of chartY) {
          const col = columns.find((cc) => cc.id === id);
          const dv = col ? displayNum(col, r) : undefined;
          p[id] = dv === undefined ? r.values[id] : dv;
        }
        return p;
      });
    }
    const copy = [...filteredRows].sort((a, b) => (a.values[chartX] ?? 0) - (b.values[chartX] ?? 0));
    return copy.map((r) => {
      const p = { x: r.values[chartX], full: r.values.tanggal };
      for (const id of chartY) {
        const col = columns.find((cc) => cc.id === id);
        const dv = col ? displayNum(col, r) : undefined;
        p[id] = dv === undefined ? r.values[id] : dv;
      }
      return p;
    });
  }, [sortedFilteredRows, filteredRows, chartX, chartY, columns, aggValues]);

  // Kolom hasil prediksi yang masih ada di skema (kolom yang sudah dihapus disaring).
  const predColIds = useMemo(() => {
    if (!result) return [];
    return Object.keys(result.columns).filter((id) => columns.some((c) => c.id === id));
  }, [result, columns]);

  const forecastChart = useMemo(() => {
    if (!result || predColIds.length === 0) return [];
    const pts = sortedFilteredRows.map((r) => {
      const p = { t: fmtTick(r.values.tanggal), full: r.values.tanggal, _sort: new Date(r.values.tanggal).getTime() };
      for (const id of predColIds) {
        const col = columns.find((cc) => cc.id === id);
        const dv = col ? displayNum(col, r) : undefined;
        p[id] = dv === undefined ? r.values[id] : dv;
      }
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
  }, [result, sortedFilteredRows, predColIds, columns, aggValues]);

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

  // Kontrol filter per kolom: string/selection = dropdown nilai,
  // tanggal = rentang tanggal, int/double/rumus = rentang angka.
  function filterControl(c) {
    const f = filters[c.id];
    if (c.type === 'selection') {
      const opts = (c.options || []).map((o) => o.value);
      return (
        <div className="field" style={{ flex: '0 0 200px' }} key={c.id}>
          <label>{c.name}</label>
          <select value={typeof f === 'string' ? f : ''} onChange={(e) => setFilters((p) => ({ ...p, [c.id]: e.target.value }))}>
            <option value="">Semua {c.name}</option>
            {opts.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </select>
        </div>
      );
    }
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
  // String: saran dropdown dari nilai yang sudah ada + isi otomatis dari
  // baris terakhir yang cocok (listPrefix membedakan datalist form tambah/edit).
  function rowField(c, form, setForm, listPrefix = 'add') {
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
            list={`dl-${listPrefix}-${c.id}`}
            value={form[c.id] ?? ''}
            onChange={(e) => handleStringInput(c, e.target.value, form, setForm)}
            placeholder="pilih dari saran atau ketik baru"
          />
          <datalist id={`dl-${listPrefix}-${c.id}`}>
            {filterOptions(c.id).map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
      );
    }
    if (c.type === 'selection') {
      const opts = c.options || [];
      return (
        <div className="field" key={c.id}>
          <label>{c.name} <span className="type">({c.type})</span></label>
          <select value={form[c.id] ?? ''} onChange={(e) => handleStringInput(c, e.target.value, form, setForm)}>
            <option value="">— pilih —</option>
            {opts.map((o) => (
              <option key={o.value} value={o.value}>{o.value}</option>
            ))}
          </select>
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

  function numOrNull(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // Apakah rumus kolom ini merujuk ke sebuah variabel — langsung, atau
  // lewat kolom rumus lain (mis. [Sisa Gudang] * 2, padahal Sisa Gudang
  // sendiri = [Stok Bawang])? Dicek transitif supaya nilai tampilannya
  // ikut filter tabel di semua rantai.
  function formulaUsesVariable(formula, seen = new Set()) {
    const names = [...String(formula || '').matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());
    for (const n of names) {
      if (savedAggs.some((a) => a.name.toLowerCase() === n)) return true;
      const col = columns.find((cc) => cc.name.toLowerCase() === n);
      if (col && col.type === 'rumus' && col.formula && !seen.has(col.id)) {
        seen.add(col.id);
        if (formulaUsesVariable(col.formula, seen)) return true;
      }
    }
    return false;
  }

  // Nilai rumus per-baris untuk tampilan: kolom angka dibaca dari baris,
  // variabel dibaca dari aggValues (baris yang tampil). Dipakai tabel,
  // grafik, dan unduhan supaya konsisten dengan kartu Variabel.
  // Kembalian undefined = rumus tidak memakai variabel, pakai nilai tersimpan.
  function displayNum(c, r, seen = new Set()) {
    if (c.type !== 'rumus' || !c.formula || !formulaUsesVariable(c.formula)) return undefined;
    // Rumus yang memakai sum/avg/... dihitung server atas SEMUA baris —
    // jangan timpa dengan hitung klien (klien tidak punya konteks tabelnya),
    // pakai nilai tersimpan saja.
    if (/\b(sum|avg|average|median|count|min|max)\s*\(/i.test(c.formula)) return undefined;
    if (seen.has(c.id)) return null;
    seen.add(c.id);
    const res = evalFormula(c.formula, (name) => {
      const key = name.toLowerCase();
      const col = columns.find((cc) => cc.name.toLowerCase() === key);
      if (col) {
        if (col.type === 'rumus' && col.formula) {
          const v = displayNum(col, r, seen);
          return v === undefined ? numOrNull(r.values[col.id]) : v;
        }
        return numOrNull(r.values[col.id]);
      }
      const agg = savedAggs.find((a) => a.name.toLowerCase() === key);
      if (agg) {
        const v = aggValues[agg.id];
        return v && !v.error && typeof v.value === 'number' ? v.value : null;
      }
      return null;
    }, [...columns.map((cc) => cc.name), ...savedAggs.map((a) => a.name)]);
    return res.error ? null : res.value;
  }

  function cellValue(c, r) {
    if (c.type === 'tanggal') return fmtDate(r.values.tanggal);
    if (c.type === 'selection') {
      const v = r.values[c.id] ?? '';
      if (!v) return '';
      const opt = (c.options || []).find((o) => o.value === v);
      const bg = opt?.color || '#5d6d7e';
      return (
        <span style={{ display: 'inline-block', background: bg, color: textOn(bg), borderRadius: 999, padding: '2px 10px', fontSize: 12, fontWeight: 600 }}>{v}</span>
      );
    }
    if (c.type === 'string') return r.values[c.id] ?? '';
    if (c.type === 'rumus' && c.formula) {
      const v = displayNum(c, r);
      if (v !== undefined) return fmtNum(v);
    }
    return fmtNum(r.values[c.id]);
  }

  // Nilai mentah satu sel untuk unduhan (angka tetap angka supaya bisa
  // dijumlah di Excel; tanggal jadi teks tanggal + jam).
  function rawCell(c, r) {
    if (c.type === 'tanggal') return fmtDate(r.values.tanggal);
    if (c.type === 'string') return r.values[c.id] ?? '';
    if (c.type === 'rumus' && c.formula) {
      const v = displayNum(c, r);
      if (v !== undefined) return v === null ? '' : v;
    }
    const v = r.values[c.id];
    return v === null || v === undefined ? '' : v;
  }

  // Tangkap grafik (SVG Recharts) jadi gambar PNG untuk PDF.
  async function captureChartImage() {
    try {
      const svg = document.querySelector('.recharts-wrapper svg');
      if (!svg) return null;
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      const xml = new XMLSerializer().serializeToString(clone);
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      const w = svg.clientWidth || 800;
      const h = svg.clientHeight || 320;
      const canvas = document.createElement('canvas');
      canvas.width = w * 2;
      canvas.height = h * 2;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return canvas.toDataURL('image/png');
    } catch (e) {
      return null;
    }
  }

  async function downloadTable(format) {
    const dl = await import('./lib/download');
    const headers = ['No', ...columns.map((c) => c.name)];
    const rows = sortedFilteredRows.map((r, i) => [i + 1, ...columns.map((c) => rawCell(c, r))]);
    const name = `logitrack-tabel-${dl.stamp()}`;
    if (format === 'csv') dl.downloadFile(`${name}.csv`, dl.buildCSV(headers, rows), 'text/csv;charset=utf-8');
    else if (format === 'xlsx') dl.downloadFile(`${name}.xlsx`, dl.buildExcel(headers, rows, 'Tabel'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else dl.downloadFile(`${name}.pdf`, dl.buildPDF('LogiTrack — Tabel Data', `Filter: ${activeFilterSummary()} · Menampilkan ${sortedFilteredRows.length} dari ${rows.length} baris`, headers, rows, null), 'application/pdf');
  }

  async function downloadChart(format) {
    const dl = await import('./lib/download');
    const xName = chartX === 'tanggal' ? 'Tanggal' : columns.find((c) => c.id === chartX)?.name || chartX;
    const headers = [xName, ...chartY.map((id) => columns.find((c) => c.id === id)?.name || id)];
    const rows = chartData.map((p) => [p.x, ...chartY.map((id) => (p[id] === null || p[id] === undefined ? '' : p[id]))]);
    const name = `logitrack-grafik-${dl.stamp()}`;
    const sub = `Filter: ${activeFilterSummary()} · X: ${xName} · Y: ${chartY.map((id) => columns.find((c) => c.id === id)?.name || id).join(', ') || '—'}`;
    if (format === 'csv') dl.downloadFile(`${name}.csv`, dl.buildCSV(headers, rows), 'text/csv;charset=utf-8');
    else if (format === 'xlsx') dl.downloadFile(`${name}.xlsx`, dl.buildExcel(headers, rows, 'Grafik'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else {
      const img = await captureChartImage();
      dl.downloadFile(`${name}.pdf`, dl.buildPDF('LogiTrack — Grafik', sub, headers, rows, img), 'application/pdf');
    }
  }

  async function downloadPrediction(format) {
    if (!result || predColIds.length === 0) return;
    const dl = await import('./lib/download');
    const headers = ['Tanggal'];
    for (const id of predColIds) {
      const nm = columns.find((c) => c.id === id)?.name || id;
      headers.push(nm, `${nm} (q10)`, `${nm} (q90)`);
    }
    const rows = result.columns[predColIds[0]].dates.map((iso, i) => {
      const r = [fmtDate(iso)];
      for (const id of predColIds) {
        r.push(result.columns[id].values[i] ?? '', result.columns[id].q10?.[i] ?? '', result.columns[id].q90?.[i] ?? '');
      }
      return r;
    });
    const name = `logitrack-prediksi-${dl.stamp()}`;
    const filt = result.meta?.filters && Object.keys(result.meta.filters).length > 0
      ? Object.entries(result.meta.filters).map(([k, v]) => fmtFilter(k, v)).join(' · ')
      : 'Semua data (tanpa filter)';
    const sub = `Filter: ${filt} · ${result.meta?.rows_used ?? ''} baris dipakai · Horizon ${result.horizon} · Diprediksi ${result.at ? fmtDate(result.at) : ''}`;
    if (format === 'csv') dl.downloadFile(`${name}.csv`, dl.buildCSV(headers, rows), 'text/csv;charset=utf-8');
    else if (format === 'xlsx') dl.downloadFile(`${name}.xlsx`, dl.buildExcel(headers, rows, 'Prediksi'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    else {
      const img = await captureChartImage();
      dl.downloadFile(`${name}.pdf`, dl.buildPDF('LogiTrack — Hasil Prediksi', sub, headers, rows, img), 'application/pdf');
    }
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
                      {columns.map((c) => rowField(c, editingRow.values, (updater) => setEditingRow((prev) => ({ ...prev, values: typeof updater === 'function' ? updater(prev.values) : updater })), 'edit'))}
                    </div>
                    {autofillNote && <p className="msg">{autofillNote}</p>}
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
                          <th style={{ width: 44 }}>No</th>
                          {columns.map((c) => (
                            <th key={c.id} className={isNumeric(c) ? 'num' : ''}>
                              {c.name} <span style={{ fontWeight: 400 }}>({c.type}{c.type === 'rumus' ? <> = <FormulaText text={c.formula} /></> : ''})</span>
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
                        {sortedFilteredRows.map((r, i) => (
                          <tr key={r.id}>
                            <td className="num">{i + 1}</td>
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
                <div style={{ marginTop: 12 }} className="row">
                  <span className="legend">Unduh tabel (data yang tampil, termasuk filter):</span>
                  <button className="ghost" onClick={() => downloadTable('csv')} disabled={sortedFilteredRows.length === 0}>CSV</button>
                  <button className="ghost" onClick={() => downloadTable('xlsx')} disabled={sortedFilteredRows.length === 0}>Excel</button>
                  <button className="ghost" onClick={() => downloadTable('pdf')} disabled={sortedFilteredRows.length === 0}>PDF</button>
                </div>
                <div className="card" style={{ marginTop: 14, background: '#f7f9fb' }}>
                  <h2 style={{ fontSize: 16 }}>Variabel</h2>
                  <p className="sub">Variabel dihitung dari <b>baris yang tampil di tabel</b> — kalau tabel difilter, nilainya ikut berubah. Cocok untuk stok gudang: mis. <b>Stok Bawang = [Bawang In] - [Bawang Out]</b>. Variabel bisa dipakai di rumus variabel lain dan di kolom rumus per-baris dengan <b>[Nama Variabel]</b>. Template kondisi: <b>Kolom[nilai:Kolom]</b> — mis. <b>sum([jumlah][Bawang merah:Jenis barang; in:Arus])</b>. Nama variabel/kolom boleh diketik langsung tanpa [ ], mis. ketik <b>Wortel stok</b> saja — atau ketuk tag di bawah. Ada <b>IF</b>: <b>IF([Stok Bawang] &gt; 10, [Stok Bawang], 0)</b> — IF di variabel menghitung dari semua baris yang tampil, bisa bersarang, plus AND/OR/NOT.</p>
                  <form onSubmit={simpanAggregate} className="row">
                    <div className="field" style={{ flex: '0 0 200px' }}>
                      <label>Nama variabel</label>
                      <input value={aggName} onChange={(e) => setAggName(e.target.value)} placeholder="mis. Stok Bawang" />
                    </div>
                    <div className="field" style={{ flex: '1 1 320px' }}>
                      <label>Rumus</label>
                      <input value={aggFormula} onChange={(e) => setAggFormula(e.target.value)} placeholder="sum([jumlah][Bawang merah:Jenis barang; in:Arus]) - sum([jumlah][Bawang merah:Jenis barang; out:Arus])" />
                    </div>
                    <button type="submit" className="primary" disabled={aggBusy || !aggName.trim() || !aggFormula.trim()}>{aggBusy ? 'Menyimpan…' : 'Simpan variabel'}</button>
                  </form>
                  <p className="legend" style={{ marginTop: 8 }}>Ketuk tag untuk menyisipkan ke rumus:</p>
                  <div style={{ marginTop: 4 }}>
                    <button type="button" className="chip" onClick={() => setAggFormula((p) => `${p}IF(, , )`)} title="IF(kondisi, jika benar, jika salah) — bisa bersarang">IF(...)</button>
                    {savedAggs.map((a) => (
                      <button key={a.id} type="button" className="chip" onClick={() => setAggFormula((p) => `${p}[${a.name}]`)} title={`Variabel: ${a.formula}`}>{a.name} (variabel)</button>
                    ))}
                    {numericCols.map((c) => (
                      <button key={c.id} type="button" className="chip" onClick={() => setAggFormula((p) => `${p}sum([${c.name}])`)} title={`Jumlah kolom ${c.name}`}>sum({c.name})</button>
                    ))}
                    {savedAggs.length === 0 && numericCols.length === 0 && <span className="legend">Belum ada variabel atau kolom angka.</span>}
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <span className="legend">Atau isi rumus dari filter yang sedang aktif:</span>
                    <select value={varNumCol} onChange={(e) => setVarNumCol(e.target.value)} style={{ flex: '0 0 180px' }}>
                      <option value="">Pilih kolom angka…</option>
                      {numericCols.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                    <select value={varAggFn} onChange={(e) => setVarAggFn(e.target.value)} style={{ flex: '0 0 120px' }}>
                      <option value="sum">sum</option>
                      <option value="avg">avg</option>
                      <option value="median">median</option>
                      <option value="count">count</option>
                      <option value="min">min</option>
                      <option value="max">max</option>
                    </select>
                    <button type="button" className="ghost" onClick={() => setAggFormula(composeVarFormula(varAggFn, varNumCol))} disabled={!varNumCol}>Isi dari filter</button>
                  </div>
                  {aggFormula.trim() && (() => {
                    const res = evalAggregate(aggFormula, columns, sortedFilteredRows, savedAggs);
                    return res.error
                      ? <p className="msg err">{res.error}</p>
                      : <p className="msg">Hasil sekarang (baris yang tampil): <b>{fmtNum(Math.round(res.value * 100) / 100)}</b></p>;
                  })()}
                  {aggMsg && <p className="msg">{aggMsg}</p>}
                  {savedAggs.length > 0 && (
                    <div className="tablewrap" style={{ marginTop: 12 }}>
                      <table>
                        <thead><tr><th>Nama</th><th>Rumus</th><th className="num">Nilai (baris yang tampil)</th><th></th></tr></thead>
                        <tbody>
                          {savedAggs.map((a) => {
                            const res = aggValues[a.id] || { value: null, error: null };
                            return (
                              <tr key={a.id}>
                                <td>{a.name}</td>
                                <td><code><FormulaText text={a.formula} /></code></td>
                                <td className="num">{res.error ? <span style={{ color: '#c0392b' }}>{res.error}</span> : <b>{fmtNum(Math.round(res.value * 100) / 100)}</b>}</td>
                                <td><button className="danger" onClick={() => hapusAggregate(a.id)}>Hapus</button></td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                {msg && <p className="msg">{msg}</p>}
              </div>
            )}

            {view === 'filter' && (
              <div className="card">
                <h2>Filter Data</h2>
                <p className="sub">Filter berlaku untuk tabel, grafik, prediksi, dan variabel. Tanggal pakai rentang tanggal, angka pakai rentang angka, teks pakai pilihan nilai dari kolom.</p>
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
                <div className="card" style={{ marginTop: 14, background: '#f7f9fb' }}>
                  <h2 style={{ fontSize: 16 }}>Jadikan Variabel</h2>
                  <p className="sub">Simpan filter yang sedang aktif sebagai variabel stok — mis. filter Jenis barang = Bawang merah + Arus = in, kolom jumlah, sum → variabel &quot;Bawang In&quot;. Nilai variabel dihitung dari baris yang tampil di tabel, jadi ikut berubah kalau filternya diubah nanti. Variabel bisa dipakai di rumus lain dengan [Nama Variabel].</p>
                  <form onSubmit={simpanVariabelDariFilter} className="row">
                    <div className="field" style={{ flex: '0 0 200px' }}>
                      <label>Nama variabel</label>
                      <input value={varName} onChange={(e) => setVarName(e.target.value)} placeholder="mis. Bawang In" />
                    </div>
                    <div className="field" style={{ flex: '0 0 180px' }}>
                      <label>Kolom angka</label>
                      <select value={varNumCol} onChange={(e) => setVarNumCol(e.target.value)}>
                        <option value="">Pilih kolom…</option>
                        {numericCols.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field" style={{ flex: '0 0 120px' }}>
                      <label>Fungsi</label>
                      <select value={varAggFn} onChange={(e) => setVarAggFn(e.target.value)}>
                        <option value="sum">sum</option>
                        <option value="avg">avg</option>
                        <option value="median">median</option>
                        <option value="count">count</option>
                        <option value="min">min</option>
                        <option value="max">max</option>
                      </select>
                    </div>
                    <button type="submit" className="primary" disabled={aggBusy || !varName.trim() || !varNumCol}>Simpan sebagai variabel</button>
                  </form>
                  {varNumCol && <p className="legend">Rumus yang akan disimpan: <code>{composeVarFormula(varAggFn, varNumCol)}</code></p>}
                  {varMsg && <p className="msg">{varMsg}</p>}
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
                <p className="legend" style={{ marginTop: 10 }}>
                  Grafik ini dari filter: <b>{activeFilterSummary()}</b>
                  {chartY.length > 0 && <> · X: {chartX === 'tanggal' ? 'Tanggal' : columns.find((c) => c.id === chartX)?.name} · Y: {chartY.map((id) => columns.find((c) => c.id === id)?.name).join(', ')}</>}
                  {' '}· {sortedFilteredRows.length} baris ditampilkan.
                </p>
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
                {chartData.length > 0 && (
                  <div style={{ marginTop: 12 }} className="row">
                    <span className="legend">Unduh data grafik:</span>
                    <button className="ghost" onClick={() => downloadChart('csv')}>CSV</button>
                    <button className="ghost" onClick={() => downloadChart('xlsx')}>Excel</button>
                    <button className="ghost" onClick={() => downloadChart('pdf')}>PDF (dengan gambar grafik)</button>
                  </div>
                )}
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
                <p className="legend" style={{ marginTop: 10 }}>
                  Prediksi ini memakai filter: <b>{activeFilterSummary()}</b> · {filteredRows.length} baris tersedia untuk prediksi.
                </p>
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
                      <p className="legend">Filter hasil prediksi ini: {Object.entries(result.meta.filters).map(([k, v]) => fmtFilter(k, v)).join('; ')}</p>
                    )}
                    <div style={{ marginTop: 12 }} className="row">
                      <span className="legend">Unduh hasil prediksi:</span>
                      <button className="ghost" onClick={() => downloadPrediction('csv')}>CSV</button>
                      <button className="ghost" onClick={() => downloadPrediction('xlsx')}>Excel</button>
                      <button className="ghost" onClick={() => downloadPrediction('pdf')}>PDF (dengan gambar grafik)</button>
                    </div>
                  </>
                )}
              </div>
            )}

            {view === 'input' && isLogistik && (
              <div className="card">
                <h2>Tambah Baris</h2>
                <p className="sub">Tanggal defaultnya tanggal &amp; jam sekarang — bisa diubah. Klik Masukan, data langsung masuk ke tabel. Kolom rumus terisi otomatis dari rumusnya, tidak perlu diisi. Untuk kolom teks, pilih dari saran dropdown — input lain otomatis terisi dari baris terakhir dengan nilai teks itu.</p>
                <form onSubmit={tambahRow} className="row">
                  {columns.map((c) => rowField(c, rowForm, setRowForm, 'add'))}
                  <button type="submit" className="primary" disabled={rowBusy}>{rowBusy ? 'Memasukkan…' : 'Masukan'}</button>
                </form>
                {autofillNote && <p className="msg">{autofillNote}</p>}
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
                        <option value="selection">selection (pilihan + warna)</option>
                        <option value="rumus">rumus (hitung otomatis)</option>
                      </select>
                    </div>
                    <button type="submit" disabled={colBusy}>{colBusy ? 'Menambah…' : 'Tambah kolom'}</button>
                  </form>
                  {colType === 'selection' && (
                    <div style={{ marginTop: 14 }}>
                      <p className="legend" style={{ marginTop: 8 }}>Pilihan + warna untuk kolom ini (mis. in = hijau, out = merah). Saat input baris, kolom ini jadi dropdown dan nilainya tampil berwarna di tabel.</p>
                      {selOptions.map((o, idx) => (
                        <div className="row" key={idx} style={{ marginBottom: 8 }}>
                          <div className="field" style={{ flex: '1 1 200px' }}>
                            <label>Pilihan {idx + 1}</label>
                            <input
                              value={o.value}
                              onChange={(e) => setSelOptions((p) => p.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)))}
                              placeholder="mis. in"
                            />
                          </div>
                          <div className="field" style={{ flex: '0 0 90px' }}>
                            <label>Warna</label>
                            <input
                              type="color"
                              value={o.color}
                              onChange={(e) => setSelOptions((p) => p.map((x, i) => (i === idx ? { ...x, color: e.target.value } : x)))}
                              style={{ height: 38, padding: 2 }}
                            />
                          </div>
                          <button type="button" className="ghost" onClick={() => setSelOptions((p) => p.filter((_, i) => i !== idx))} disabled={selOptions.length <= 1}>Hapus</button>
                        </div>
                      ))}
                      <button type="button" className="ghost" onClick={() => setSelOptions((p) => [...p, { value: '', color: SELECTION_COLORS[p.length % SELECTION_COLORS.length].bg }])} disabled={selOptions.length >= 20}>+ Tambah pilihan</button>
                    </div>
                  )}
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
                      <p className="legend" style={{ marginTop: 8 }}>Klik kolom di bawah untuk memasukkannya ke rumus. Bisa juga memakai variabel stok dengan <b>[Nama Variabel]</b> — mis. kolom &quot;Sisa Gudang&quot; = <b>[Stok Bawang]</b>. Nama boleh juga diketik langsung tanpa [ ], mis. ketik <b>Wortel stok</b> saja. Ada <b>IF</b> ala Excel: <b>IF([Stok Bawang] &gt; 0, [Stok Bawang], 0)</b> — kondisi di IF memakai baris itu sendiri, bisa bersarang, plus AND/OR/NOT. Ada <b>STOK</b> buat stok berjalan per barang: <b>STOK([jumlah], [Jenis barang], [Status])</b> — jumlah sampai baris ini, in nambah, out ngurangin. Ada <b>sum/avg/count/min/max</b> atas semua baris: <b>sum([jumlah][INI:Jenis barang; in:Status])</b> — total barang yang sama dengan baris ini dan statusnya in; INI = nilai kolom dari baris itu sendiri.</p>
                      <div>
                        <button type="button" className="chip" onClick={() => setFormulaText((p) => `${p}IF(, , )`)} title="IF(kondisi, jika benar, jika salah) — bisa bersarang">IF(...)</button>
                        <button type="button" className="chip" onClick={() => setFormulaText((p) => `${p}STOK(, , )`)} title="STOK([jumlah], [Jenis barang], [Status]) — stok berjalan per barang sampai baris ini">STOK(...)</button>
                        <button type="button" className="chip" onClick={() => setFormulaText((p) => `${p}sum([jumlah][INI:Jenis barang; in:Status])`)} title="sum([jumlah][INI:Jenis barang; in:Status]) — total barang yang sama dengan baris ini">sum INI</button>
                        {numericCols.map((c) => (
                          <button key={c.id} type="button" className="chip" onClick={() => setFormulaText((p) => `${p}[${c.name}]`)}>{c.name}</button>
                        ))}
                        {savedAggs.map((a) => (
                          <button key={a.id} type="button" className="chip" onClick={() => setFormulaText((p) => `${p}[${a.name}]`)} title={`Variabel: ${a.formula}`}>{a.name} (variabel)</button>
                        ))}
                        {numericCols.length === 0 && savedAggs.length === 0 && <span className="legend">Belum ada kolom angka — buat dulu kolom int/double.</span>}
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
                    <p className="legend" style={{ marginTop: 8 }}>Klik kolom/variabel di bawah untuk memasukkannya ke rumus (nama boleh juga diketik langsung tanpa [ ]). Ada <b>IF</b>: <b>IF([Stok Bawang] &gt; 0, [Stok Bawang], 0)</b> — kondisi memakai baris itu sendiri, bisa bersarang. Ada <b>STOK</b>: <b>STOK([jumlah], [Jenis barang], [Status])</b> — stok berjalan per barang sampai baris ini. Ada <b>sum/avg/count/min/max</b>: <b>sum([jumlah][INI:Jenis barang; in:Status])</b> — total barang yang sama dengan baris ini.</p>
                    <div>
                      <button type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}IF(, , )`)} title="IF(kondisi, jika benar, jika salah) — bisa bersarang">IF(...)</button>
                      <button type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}STOK(, , )`)} title="STOK([jumlah], [Jenis barang], [Status]) — stok berjalan per barang sampai baris ini">STOK(...)</button>
                      <button type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}sum([jumlah][INI:Jenis barang; in:Status])`)} title="sum([jumlah][INI:Jenis barang; in:Status]) — total barang yang sama dengan baris ini">sum INI</button>
                      {numericCols.map((c) => (
                        <button key={c.id} type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}[${c.name}]`)}>{c.name}</button>
                      ))}
                      {savedAggs.map((a) => (
                        <button key={a.id} type="button" className="chip" onClick={() => setEditFormulaText((p) => `${p}[${a.name}]`)} title={`Variabel: ${a.formula}`}>{a.name} (variabel)</button>
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
