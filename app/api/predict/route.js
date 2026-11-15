import { NextResponse } from 'next/server';
import { getData, getJob, saveJob, getResult } from '../kv';

export async function POST(req) {
  try {
    const body = await req.json();
    const horizon = Math.max(1, Math.min(60, parseInt(body.horizon, 10) || 7));
    let columns = body.columns || 'all';
    const { columns: schemaCols } = await getData();
    const numericIds = schemaCols.filter((c) => c.type === 'int' || c.type === 'double').map((c) => c.id);
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
