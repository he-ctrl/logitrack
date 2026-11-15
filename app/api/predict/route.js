import { NextResponse } from 'next/server';
import { getData, getJob, saveJob, getResult, getSession } from '../kv';

export async function POST(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const body = await req.json();
    const horizon = Math.max(1, Math.min(60, parseInt(body.horizon, 10) || 7));
    let columns = body.columns || 'all';
    const { columns: schemaCols } = await getData();
    // Filter: string = cocok persis, tanggal = rentang tanggal (from/to ISO),
    // int/double = rentang angka (min/max). Hanya yang valid diteruskan ke worker.
    const rawFilters = body.filters && typeof body.filters === 'object' && !Array.isArray(body.filters) ? body.filters : {};
    const filters = {};
    for (const [k, v] of Object.entries(rawFilters)) {
      const col = schemaCols.find((c) => c.id === k);
      if (!col) continue;
      if (col.type === 'string' || col.type === 'selection') {
        const val = String(v ?? '').trim();
        if (val) filters[k] = val;
      } else if (col.type === 'tanggal') {
        if (!v || typeof v !== 'object') continue;
        const o = {};
        if (v.from && !Number.isNaN(new Date(v.from).getTime())) o.from = new Date(v.from).toISOString();
        if (v.to && !Number.isNaN(new Date(v.to).getTime())) o.to = new Date(v.to).toISOString();
        if (Object.keys(o).length) filters[k] = o;
      } else if (col.type === 'int' || col.type === 'double' || col.type === 'rumus') {
        if (!v || typeof v !== 'object') continue;
        const o = {};
        if (v.min !== undefined && v.min !== null && v.min !== '' && Number.isFinite(Number(v.min))) o.min = Number(v.min);
        if (v.max !== undefined && v.max !== null && v.max !== '' && Number.isFinite(Number(v.max))) o.max = Number(v.max);
        if (Object.keys(o).length) filters[k] = o;
      }
    }
    const numericIds = schemaCols.filter((c) => c.type === 'int' || c.type === 'double' || c.type === 'rumus').map((c) => c.id);
    if (columns !== 'all') {
      if (!Array.isArray(columns) || columns.length === 0) {
        return NextResponse.json({ error: 'Pilih minimal satu kolom angka.' }, { status: 400 });
      }
      columns = columns.filter((id) => numericIds.includes(id));
      if (columns.length === 0) {
        return NextResponse.json({ error: 'Kolom yang dipilih bukan kolom angka (int/double).' }, { status: 400 });
      }
    } else if (numericIds.length === 0) {
      return NextResponse.json({ error: 'Belum ada kolom angka (int/double) untuk diprediksi.' }, { status: 400 });
    }

    const current = await getJob();
    if (current && (current.status === 'pending' || current.status === 'processing')) {
      return NextResponse.json({ error: 'Masih ada prediksi yang berjalan, tunggu selesai dulu.' }, { status: 409 });
    }
    const job = {
      id: `p_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      columns,
      horizon,
      filters,
      status: 'pending',
      created_at: new Date().toISOString(),
      error: null,
    };
    await saveJob(job);
    return NextResponse.json({ job });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function GET(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const job = await getJob();
    if (!job) return NextResponse.json({ job: null, result: null });
    if (id && job.id !== id) return NextResponse.json({ job, result: null });
    const result = job.status === 'done' ? await getResult(job.id) : null;
    return NextResponse.json({ job, result });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
