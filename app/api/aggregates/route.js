import { NextResponse } from 'next/server';
import { getData, saveRows, getAggregates, saveAggregates, getSession, recomputeAllRows } from '../kv';
import { validateAggregate } from '../../lib/aggregate';

// Variabel tersimpan (rumus agregat atas tabel, mis. Stok Bawang).
// Variabel dihitung atas SELURUH data (kondisinya ada di dalam rumusnya
// sendiri, mis. sum([jumlah][Bawang merah:Jenis barang; in:Arus])), bukan
// dari filter tampilan. Variabel bisa dipakai di rumus variabel lain dan di
// kolom rumus per-baris dengan [Nama Variabel].
// GET: daftar variabel. POST: simpan {name, formula}. DELETE ?id=: hapus.
// Ketiga aksi butuh login; boleh kedua role (logistik & supervisor) karena
// variabel hanya perhitungan laporan — tidak mengubah data.
export async function GET(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const list = await getAggregates();
    return NextResponse.json({ aggregates: list });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const body = await req.json();
    const name = String(body.name || '').trim();
    const formula = String(body.formula || '').trim();
    if (!name) return NextResponse.json({ error: 'Nama variabel wajib diisi.' }, { status: 400 });
    if (name.length > 60) return NextResponse.json({ error: 'Nama variabel maksimal 60 karakter.' }, { status: 400 });
    if (!formula) return NextResponse.json({ error: 'Rumus wajib diisi.' }, { status: 400 });
    if (formula.length > 500) return NextResponse.json({ error: 'Rumus maksimal 500 karakter.' }, { status: 400 });
    const { columns, rows } = await getData();
    const list = await getAggregates();
    if (list.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: `Variabel "${name}" sudah ada.` }, { status: 400 });
    }
    const item = { id: `a_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name, formula };
    // Sertakan kandidat supaya rujukan ke diri sendiri terdeteksi sebagai siklus.
    const check = validateAggregate(formula, columns, [...list, item]);
    if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
    const next = [...list, item];
    await saveAggregates(next);
    // Variabel baru bisa menghidupkan kolom rumus yang memakainya — hitung
    // ulang semua baris.
    const newRows = recomputeAllRows(columns, rows, next);
    await saveRows(newRows);
    return NextResponse.json({ aggregates: next, added: item });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id variabel wajib diisi.' }, { status: 400 });
    const list = await getAggregates();
    const item = list.find((a) => a.id === id);
    if (!item) return NextResponse.json({ error: 'Variabel tidak ditemukan.' }, { status: 404 });
    // Variabel yang dipakai kolom rumus tidak boleh dihapus.
    const { columns, rows } = await getData();
    const users = columns.filter((c) => {
      if (c.type !== 'rumus' || !c.formula) return false;
      const refs = [...String(c.formula).matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim().toLowerCase());
      return refs.includes(item.name.toLowerCase());
    });
    if (users.length > 0) {
      return NextResponse.json(
        {
          error: `Variabel "${item.name}" dipakai oleh kolom rumus ${users.map((c) => `"${c.name}"`).join(', ')}. Ubah dulu rumus kolom itu, baru hapus variabel ini.`,
        },
        { status: 400 }
      );
    }
    const next = list.filter((a) => a.id !== id);
    await saveAggregates(next);
    const newRows = recomputeAllRows(columns, rows, next);
    await saveRows(newRows);
    return NextResponse.json({ aggregates: next });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
