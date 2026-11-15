import { NextResponse } from 'next/server';
import { getData, saveRows, getSession, computeFormulas } from '../kv';

function cleanValue(col, raw) {
  if (col.type === 'string') return String(raw ?? '');
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

// Nilai kolom biasa dari input; kolom rumus selalu dihitung server.
function buildValues(columns, input) {
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
  const computed = computeFormulas(columns, values);
  return computed;
}

export async function POST(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const body = await req.json();
    const input = body.values || {};
    const { columns, rows } = await getData();
    const computed = buildValues(columns, input);
    const row = { id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, values: computed.values };
    const newRows = [...rows, row];
    await saveRows(newRows);
    return NextResponse.json({ row, rows: newRows, formulaWarnings: computed.errors });
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
    const computed = buildValues(columns, input);
    const newRows = rows.map((r, i) => (i === idx ? { ...r, values: computed.values } : r));
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
    const { rows } = await getData();
    const newRows = rows.filter((r) => r.id !== id);
    if (newRows.length === rows.length) {
      return NextResponse.json({ error: 'Baris tidak ditemukan.' }, { status: 404 });
    }
    await saveRows(newRows);
    return NextResponse.json({ rows: newRows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
