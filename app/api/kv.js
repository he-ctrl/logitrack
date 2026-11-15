// Helper Upstash KV (HTTP REST) untuk LogiTrack — pola yang sama dengan
// proyek Kronos. Kredensial hanya dari env Vercel (KV_REST_API_URL /
// KV_REST_API_TOKEN), tidak pernah dikirim ke browser.
import crypto from 'node:crypto';
import { evalFormula } from './formula';
import { evalAggregate } from '../lib/aggregate';

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

// ---- Rumus agregat tersimpan ----
// logistik:aggregates = [{id, name, formula}] — rumus sum/avg/median/... atas
// tabel (dihitung client-side dari baris yang tampil setelah filter).
export async function getAggregates() {
  const raw = await kvGetRaw('logistik:aggregates');
  if (!raw) return [];
  try {
    const a = JSON.parse(raw);
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

export async function saveAggregates(list) {
  return kvSetRaw('logistik:aggregates', JSON.stringify(list));
}

// ---- Kolom rumus ----
// Hitung semua kolom rumus (sesuai urutan skema — rumus hanya boleh memakai
// kolom yang sudah ada, jadi urutan skema aman dari siklus).
// values: nilai kolom biasa yang sudah dibersihkan. resolveVar(name) ->
// number|null untuk referensi [Nama Variabel] di dalam rumus (boleh null
// bila rumus tidak memakai variabel). Kembalian:
// { values: {..., [idRumus]: number|null}, errors: [{column, error}] }
export function computeFormulas(columns, values, resolveVar, varNames = []) {
  const out = { ...values };
  const errors = [];
  const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const knownNames = [...columns.map((c) => c.name), ...varNames];
  for (const col of columns) {
    if (col.type !== 'rumus') continue;
    if (!col.formula) {
      out[col.id] = null;
      continue;
    }
    const res = evalFormula(col.formula, (name) => {
      const ref = byName.get(String(name).toLowerCase());
      if (ref) {
        const v = out[ref.id];
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      }
      if (resolveVar) {
        const v = resolveVar(name);
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
      }
      return null;
    }, knownNames);
    if (res.error) {
      out[col.id] = null;
      errors.push({ column: col.name, error: res.error });
    } else {
      out[col.id] = res.value;
    }
  }
  return { values: out, errors };
}

// ---- Variabel ----
// Hitung semua variabel tersimpan atas baris yang diberikan.
// Kembalian: Map nama-kecil -> number|null (null bila rumusnya error).
export function computeVariables(columns, rows, aggregates) {
  const vars = new Map();
  const list = Array.isArray(aggregates) ? aggregates : [];
  for (const a of list) {
    const res = evalAggregate(a.formula, columns, rows, list);
    vars.set(String(a.name).toLowerCase(), res.error ? null : res.value);
  }
  return vars;
}

// Hitung ulang SEMUA kolom rumus di SEMUA baris, dengan variabel tersedia.
// Diulang sampai stabil (maks 4x) supaya rantai variabel <-> kolom rumus
// yang saling bergantung ikut terhitung dengan benar.
export function recomputeAllRows(columns, rows, aggregates) {
  let current = rows.map((r) => ({ ...(r.values || {}) }));
  for (let iter = 0; iter < 4; iter++) {
    const vars = computeVariables(columns, rows.map((r, i) => ({ ...r, values: current[i] })), aggregates);
    const next = current.map((values) =>
      computeFormulas(columns, values, (name) => vars.get(String(name).toLowerCase()) ?? null, aggregates.map((a) => a.name)).values
    );
    const same = JSON.stringify(next) === JSON.stringify(current);
    current = next;
    if (same) break;
  }
  return rows.map((r, i) => ({ ...r, values: current[i] }));
}

// ---- Login & role ----
// Akun disimpan di KV (logistik:users) sebagai hash SHA-256 + salt, bukan
// password polos. Akun awal (ganti lewat form Ganti Password setelah login):
// logistik / logistik123 (role logistik, semua fitur)
// supervisor / supervisor123 (role supervisor: tabel, filter, prediksi, grafik)
const SESSION_COOKIE = 'logistik_session';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

export function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function makeUser(username, role, password) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { username, role, salt, hash: hashPassword(password, salt) };
}

export async function getUsers() {
  const raw = await kvGetRaw('logistik:users');
  if (raw) {
    try {
      const users = JSON.parse(raw);
      if (Array.isArray(users) && users.length > 0) return users;
    } catch (e) { /* rusak — buat ulang di bawah */ }
  }
  const users = [
    makeUser('logistik', 'logistik', 'logistik123'),
    makeUser('supervisor', 'supervisor', 'supervisor123'),
  ];
  await kvSetRaw('logistik:users', JSON.stringify(users));
  return users;
}

export async function saveUsers(users) {
  return kvSetRaw('logistik:users', JSON.stringify(users));
}

async function getSessions() {
  const raw = await kvGetRaw('logistik:sessions');
  if (!raw) return {};
  try {
    const s = JSON.parse(raw);
    return s && typeof s === 'object' ? s : {};
  } catch (e) {
    return {};
  }
}

export async function createSession(username, role) {
  const id = crypto.randomBytes(24).toString('hex');
  const sessions = await getSessions();
  sessions[id] = { username, role, expires: Date.now() + SESSION_TTL_MS };
  // Buang sesi yang sudah kedaluwarsa.
  for (const [k, v] of Object.entries(sessions)) {
    if (!v || v.expires < Date.now()) delete sessions[k];
  }
  await kvSetRaw('logistik:sessions', JSON.stringify(sessions));
  return id;
}

export async function deleteSession(id) {
  if (!id) return;
  const sessions = await getSessions();
  if (sessions[id]) {
    delete sessions[id];
    await kvSetRaw('logistik:sessions', JSON.stringify(sessions));
  }
}

// Baca sesi dari cookie request. Kembalian: {username, role} atau null.
export async function getSession(req) {
  const cookie = req.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)logistik_session=([^;]+)/);
  if (!m) return null;
  const sessions = await getSessions();
  const s = sessions[m[1]];
  if (!s || !s.username || !s.role || s.expires < Date.now()) return null;
  return { username: s.username, role: s.role, id: m[1] };
}

export { kvEnabled, SESSION_COOKIE, SESSION_TTL_MS };
