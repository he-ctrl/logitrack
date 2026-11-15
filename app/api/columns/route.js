import { NextResponse } from 'next/server';
import { getData, saveSchema, saveRows, getJob, clearPredictJob } from '../kv';

const TYPES = { string: '', int: 0, double: 0 };

export async function POST(req) {
  try {
    const body = await req.json();
    const name = String(body.name || '').trim();
    const type = String(body.type || '');
    if (!name) return NextResponse.json({ error: 'Nama kolom wajib diisi.' }, { status: 400 });
    if (name.length > 40) return NextResponse.json({ error: 'Nama kolom maksimal 40 karakter.' }, { status: 400 });
    if (!(type in TYPES)) return NextResponse.json({ error: 'Tipe harus string, int, atau double.' }, { status: 400 });

    const { columns, rows } = await getData();
    if (columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: `Kolom "${name}" sudah ada.` }, { status: 400 });
    }
    const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const col = { id, name, type };
    const newColumns = [...columns, col];
    // Baris yang sudah ada mendapat nilai default kolom baru (0 untuk int/double, '' untuk string).
    const def = TYPES[type];
    const newRows = rows.map((r) => ({
      ...r,
      values: { ...r.values, [id]: def },
    }));
    await saveSchema(newColumns);
    await saveRows(newRows);
    return NextResponse.json({ columns: newColumns, rows: newRows, added: col });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id kolom wajib diisi.' }, { status: 400 });

    const { columns, rows } = await getData();
    const col = columns.find((c) => c.id === id);
    if (!col) return NextResponse.json({ error: 'Kolom tidak ditemukan.' }, { status: 404 });
    if (col.type === 'tanggal') {
      return NextResponse.json({ error: 'Kolom Tanggal tidak bisa dihapus.' }, { status: 400 });
    }
    const newColumns = columns.filter((c) => c.id !== id);
    // Nilai kolom yang dihapus ikut dibuang dari semua baris.
    const newRows = rows.map((r) => {
      const values = { ...r.values };
      delete values[id];
      return { ...r, values };
    });
    await saveSchema(newColumns);
    await saveRows(newRows);
    // Hapus hasil prediksi yang memakai kolom ini supaya tidak tampil usang.
    const job = await getJob();
    if (job && (job.columns === 'all' || (Array.isArray(job.columns) && job.columns.includes(id)))) {
      await clearPredictJob();
    }
    return NextResponse.json({ columns: newColumns, rows: newRows, deleted: col });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
