// Helper Upstash KV (HTTP REST) untuk LogiTrack — pola yang sama dengan
// proyek Kronos. Kredensial hanya dari env Vercel (KV_REST_API_URL /
// KV_REST_API_TOKEN), tidak pernah dikirim ke browser.
const KV_URL = (process.env.KV_REST_API_URL || '').replace(/\/$/, '');
const KV_TOKEN = process.env.KV_REST_API_TOKEN || '';
const KV_READ_TOKEN = process.env.KV_REST_API_READ_ONLY_TOKEN || KV_TOKEN;

function kvEnabled() {
  return Boolean(KV_URL && KV_TOKEN);
}

async function kvGetRaw(key) {
  const res = await fetch(`${KV_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_READ_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`KV get ${key} gagal: HTTP ${res.status}`);
  const j = await res.json();
  return j.result ?? null;
}

async function kvDeleteRaw(key) {
  const res = await fetch(`${KV_URL}/del/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`KV del ${key} gagal: HTTP ${res.status}`);
  return res.json();
}

export async function clearPredictJob() {
  const job = await getJob();
  if (!job) return;
  await kvDeleteRaw('logistik:predict:job');
  await kvDeleteRaw(`logistik:predict:result:${job.id}`);
}

async function kvSetRaw(key, value) {
  const body = typeof value === 'string' ? value : JSON.stringify(value);
  const res = await fetch(`${KV_URL}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${KV_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body,
  });
  if (!res.ok) throw new Error(`KV set ${key} gagal: HTTP ${res.status}`);
  return res.json();
}

const DEFAULT_SCHEMA = {
  columns: [{ id: 'tanggal', name: 'Tanggal', type: 'tanggal' }],
};

export async function getData() {
  if (!kvEnabled()) throw new Error('KV belum dikonfigurasi (KV_REST_API_URL / KV_REST_API_TOKEN).');
  let schema = null;
  let rows = null;
  try {
    const s = await kvGetRaw('logistik:schema');
    if (s) schema = JSON.parse(s);
  } catch (e) { /* schema belum ada */ }
  try {
    const r = await kvGetRaw('logistik:rows');
    if (r) rows = JSON.parse(r);
  } catch (e) { /* rows belum ada */ }
  if (!schema || !Array.isArray(schema.columns)) {
    schema = DEFAULT_SCHEMA;
    await kvSetRaw('logistik:schema', JSON.stringify(schema));
  }
  // Pastikan kolom tanggal selalu ada dan selalu pertama.
  if (!schema.columns.some((c) => c.id === 'tanggal')) {
    schema.columns.unshift({ id: 'tanggal', name: 'Tanggal', type: 'tanggal' });
    await kvSetRaw('logistik:schema', JSON.stringify(schema));
  }
  if (!Array.isArray(rows)) {
    rows = [];
    await kvSetRaw('logistik:rows', JSON.stringify(rows));
  }
  return { columns: schema.columns, rows };
}

export async function saveSchema(columns) {
  return kvSetRaw('logistik:schema', JSON.stringify({ columns }));
}

export async function saveRows(rows) {
  return kvSetRaw('logistik:rows', JSON.stringify(rows));
}

export async function getJob() {
  const raw = await kvGetRaw('logistik:predict:job');
  return raw ? JSON.parse(raw) : null;
}

export async function saveJob(job) {
  return kvSetRaw('logistik:predict:job', JSON.stringify(job));
}

export async function getResult(jobId) {
  const raw = await kvGetRaw(`logistik:predict:result:${jobId}`);
  return raw ? JSON.parse(raw) : null;
}

export { kvEnabled };
