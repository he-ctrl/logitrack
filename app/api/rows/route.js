import { NextResponse } from 'next/server';
import { getData, saveRows } from '../kv';

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

export async function POST(req) {
  try {
    const body = await req.json();
    const input = body.values || {};
    const { columns, rows } = await getData();
    const values = {};
    for (const col of columns) {
      if (col.type === 'tanggal') {
        const raw = input.tanggal || new Date().toISOString();
        const d = new Date(raw);
        if (Number.isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Tanggal tidak valid.' }, { status: 400 });
        }
        values.tanggal = d.toISOString();
      } else {
        values[col.id] = cleanValue(col, input[col.id]);
      }
    }
    const row = { id: `r_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, values };
    const newRows = [...rows, row];
    await saveRows(newRows);
    return NextResponse.json({ row, rows: newRows });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
}

export async function DELETE(req) {
  try {
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
