import { NextResponse } from 'next/server';
import { getData, saveSchema, saveRows, getJob, clearPredictJob, getSession, computeFormulas, getAggregates, recomputeAllRows } from '../kv';
import { validateFormula, formulaRefIds } from '../formula';
import { aggregateRefIds } from '../../lib/aggregate';

const TYPES = { string: '', int: 0, double: 0, rumus: null, selection: '' };

async function requireLogistik(req) {
  const sess = await getSession(req);
  if (!sess) return { error: NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 }) };
  if (sess.role !== 'logistik') {
    return { error: NextResponse.json({ error: 'Fitur ini hanya untuk role logistik.' }, { status: 403 }) };
  }
  return { sess };
}

export async function POST(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const body = await req.json();
    const name = String(body.name || '').trim();
    const type = String(body.type || '');
    if (!name) return NextResponse.json({ error: 'Nama kolom wajib diisi.' }, { status: 400 });
    if (name.length > 40) return NextResponse.json({ error: 'Nama kolom maksimal 40 karakter.' }, { status: 400 });
    if (!(type in TYPES)) return NextResponse.json({ error: 'Tipe harus string, int, double, selection, atau rumus.' }, { status: 400 });

    const { columns, rows } = await getData();
    if (columns.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      return NextResponse.json({ error: `Kolom "${name}" sudah ada.` }, { status: 400 });
    }
    const aggregates = await getAggregates();
    const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const col = { id, name, type };
    if (type === 'rumus') {
      const formula = String(body.formula || '').trim();
      const check = validateFormula(formula, columns, aggregates);
      if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
      col.formula = formula;
    }
    if (type === 'selection') {
      const rawOpts = Array.isArray(body.options) ? body.options : [];
      if (rawOpts.length < 1 || rawOpts.length > 20) {
        return NextResponse.json({ error: 'Kolom selection butuh 1–20 pilihan.' }, { status: 400 });
      }
      const seen = new Set();
      const options = [];
      for (const o of rawOpts) {
        const value = String(o?.value || '').trim();
        const color = String(o?.color || '').trim();
        if (!value) return NextResponse.json({ error: 'Setiap pilihan selection wajib punya nama.' }, { status: 400 });
        if (value.length > 40) return NextResponse.json({ error: 'Nama pilihan maksimal 40 karakter.' }, { status: 400 });
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
          return NextResponse.json({ error: `Warna pilihan "${value}" harus format hex (#rrggbb).` }, { status: 400 });
        }
        if (seen.has(value.toLowerCase())) {
          return NextResponse.json({ error: `Pilihan "${value}" duplikat.` }, { status: 400 });
        }
        seen.add(value.toLowerCase());
        options.push({ value, color: color.toLowerCase() });
      }
      col.options = options;
    }
    const newColumns = [...columns, col];
    // Baris yang sudah ada: kolom biasa dapat nilai default, kolom rumus
    // langsung dihitung dari nilai baris itu.
    let newRows = rows.map((r) => ({
      ...r,
      values: { ...r.values, [id]: TYPES[type] },
    }));
    if (type === 'rumus') {
      // Rumus baru bisa memakai [Nama Variabel] — hitung ulang semua baris
      // dengan variabel tersedia.
      newRows = recomputeAllRows(newColumns, newRows, aggregates);
    }
    await saveSchema(newColumns);
    await saveRows(newRows);
    return NextResponse.json({ columns: newColumns, rows: newRows, added: col });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Ubah rumus sebuah kolom rumus, lalu hitung ulang semua baris.
export async function PUT(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const body = await req.json();
    const id = body.id;
    const formula = String(body.formula || '').trim();
    if (!id) return NextResponse.json({ error: 'id kolom wajib diisi.' }, { status: 400 });
    const { columns, rows } = await getData();
    const col = columns.find((c) => c.id === id);
    if (!col) return NextResponse.json({ error: 'Kolom tidak ditemukan.' }, { status: 404 });
    if (col.type !== 'rumus') {
      return NextResponse.json({ error: 'Hanya kolom rumus yang rumusnya bisa diubah.' }, { status: 400 });
    }
    const others = columns.filter((c) => c.id !== id);
    const aggregates = await getAggregates();
    const check = validateFormula(formula, others, aggregates);
    if (check.error) return NextResponse.json({ error: check.error }, { status: 400 });
    const newColumns = columns.map((c) => (c.id === id ? { ...c, formula } : c));
    const newRows = recomputeAllRows(newColumns, rows, aggregates);
    await saveSchema(newColumns);
    await saveRows(newRows);
    return NextResponse.json({ columns: newColumns, rows: newRows, updated: { ...col, formula } });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function DELETE(req) {
  try {
    const auth = await requireLogistik(req);
    if (auth.error) return auth.error;
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id kolom wajib diisi.' }, { status: 400 });

    const { columns, rows } = await getData();
    const col = columns.find((c) => c.id === id);
    if (!col) return NextResponse.json({ error: 'Kolom tidak ditemukan.' }, { status: 404 });
    if (col.type === 'tanggal') {
      return NextResponse.json({ error: 'Kolom Tanggal tidak bisa dihapus.' }, { status: 400 });
    }
    // Kolom yang dipakai rumus lain tidak boleh dihapus (rumusnya akan rusak).
    const users = columns.filter(
      (c) => c.type === 'rumus' && c.formula && formulaRefIds(c.formula, columns).includes(id)
    );
    if (users.length > 0) {
      return NextResponse.json(
        {
          error: `Kolom "${col.name}" dipakai oleh rumus kolom ${users.map((c) => `"${c.name}"`).join(', ')}. Ubah dulu rumus kolom itu, baru hapus kolom ini.`,
        },
        { status: 400 }
      );
    }
    // Kolom yang dipakai variabel juga tidak boleh dihapus.
    const aggregates = await getAggregates();
    const varUsers = aggregates.filter((a) => aggregateRefIds(a.formula, columns, aggregates).includes(id));
    if (varUsers.length > 0) {
      return NextResponse.json(
        {
          error: `Kolom "${col.name}" dipakai oleh variabel ${varUsers.map((a) => `"${a.name}"`).join(', ')}. Hapus/ubah dulu variabel itu, baru hapus kolom ini.`,
        },
        { status: 400 }
      );
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
