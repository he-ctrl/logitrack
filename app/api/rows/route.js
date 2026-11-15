import { NextResponse } from 'next/server';
import { getData, saveRows, getSession, computeFormulas, getAggregates, recomputeAllRows, computeVariables } from '../kv';

function cleanValue(col, raw) {
  if (col.type === 'string') return String(raw ?? '');
  if (col.type === 'selection') {
    const v = String(raw ?? '');
    if (v === '') return '';
    const opts = (col.options || []).map((o) => o.value);
    if (!opts.includes(v)) {
      throw new Error(`Kolom "${col.name}" harus salah satu pilihan: ${opts.join(', ')}.`);
    }
    return v;
  }
  if (col.type === 'int') {
    const n = Number(raw);
    if (!Number.isInteger(n)) throw new Error(`Kolom "${col.name}" harus bilangan bulat (int).`);
    return n;
  }
  if (col.type === 'double') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new Error(`Kolom "${col.name}" harus angka (double).`);
    return n;
  }
  return raw;
}

async function requireLogistik(req) {
  const sess = await getSession(req);
  if (!sess) return { error: NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 }) };
  if (sess.role !== 'logistik') {
    return { error: NextResponse.json({ error: 'Fitur ini hanya untuk role logistik.' }, { status: 403 }) };
  }
  return { sess };
}

// Nilai kolom biasa dari input (tanpa rumus); kolom rumus selalu dihitung
// server dari nilai baris itu — plus [Nama Variabel] bila ada.
function cleanBaseValues(columns, input) {
  const values = {};
  for (const col of columns) {
    if (col.type === 'tanggal') {
      const raw = input.tanggal || new Date().toISOString();
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) throw new Error('Tanggal tidak valid.');
      values.tanggal = d.toISOString();
    } else if (col.type !== 'rumus') {
      values[col.id] = cleanValue(col, input[col.id]);
    }
  }
  return values;
}

function buildValues(columns, input, resolveVar, varNames = []) {
  const values = cleanBaseValues(columns, input);
  const computed = computeFormulas(columns, values, resolveVar, varNames);
  return computed;
}

// Variabel untuk tabel setelah baris baru/ubah masuk — dipakai supaya rumus
// kolom yang memakai [Nama Variabel] langsung terhitung benar (tanpa
// peringatan palsu) saat baris disimpan.
function provisionalVars(columns, rows, newValues, replaceIdx, aggregates) {
  const provisional = rows.map((r, i) => (i === replaceIdx ? { ...r, values: newValues } : r));
  if (replaceIdx === -1) provisional.push({ id: 'tmp', values: newValues });
  return computeVariables(columns, provisional, aggregates);
}

export async function POST(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const body = await req.json();
    const input = body.values || {};
    const { columns, rows } = await getData();
    const aggregates = await getAggregates();
    const base = cleanBaseValues(columns, input);
    const vars = provisionalVars(columns, rows, base, -1, aggregates);
    const computed = buildValues(columns, input, (name) => vars.get(String(name).toLowerCase()) ?? null, aggregates.map((a) => a.name));
    const row = { id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, values: computed.values };
    // Hitung ulang semua baris: kolom rumus yang memakai [Nama Variabel]
    // bergantung pada seluruh tabel, jadi baris lama ikut berubah nilainya.
    const newRows = recomputeAllRows(columns, [...rows, row], aggregates);
    await saveRows(newRows);
    return NextResponse.json({ row: newRows[newRows.length - 1], rows: newRows, formulaWarnings: computed.errors });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

// Edit baris (role logistik): nilai baru + hitung ulang semua kolom rumus.
export async function PUT(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const body = await req.json();
    const id = body.id;
    const input = body.values || {};
    if (!id) return NextResponse.json({ error: 'id baris wajib diisi.' }, { status: 400 });
    const { columns, rows } = await getData();
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return NextResponse.json({ error: 'Baris tidak ditemukan.' }, { status: 404 });
    const aggregates = await getAggregates();
    const base = cleanBaseValues(columns, input);
    const vars = provisionalVars(columns, rows, base, idx, aggregates);
    const computed = buildValues(columns, input, (name) => vars.get(String(name).toLowerCase()) ?? null, aggregates.map((a) => a.name));
    const updated = rows.map((r, i) => (i === idx ? { ...r, values: computed.values } : r));
    const newRows = recomputeAllRows(columns, updated, aggregates);
    await saveRows(newRows);
    return NextResponse.json({ row: newRows[idx], rows: newRows, formulaWarnings: computed.errors });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id baris wajib diisi.' }, { status: 400 });
    const { columns, rows } = await getData();
    const filtered = rows.filter((r) => r.id !== id);
    if (filtered.length === rows.length) {
      return NextResponse.json({ error: 'Baris tidak ditemukan.' }, { status: 404 });
    }
    const aggregates = await getAggregates();
    const newRows = recomputeAllRows(columns, filtered, aggregates);
    await saveRows(newRows);
    return NextResponse.json({ rows: newRows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
