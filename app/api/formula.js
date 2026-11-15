// Mesin rumus LogiTrack — parser & evaluator aman (tanpa eval).
// Sintaks referensi kolom: [Nama Kolom] — tulis persis nama kolomnya,
// contoh: [Harga] * [Jumlah Barang]
// Operator: + - * / % ^ dan tanda kurung. Urutan hitung PEMDAS.
// Referensi hanya boleh kolom angka (int / double / rumus).
// Hasil harus angka berhingga; kalau tidak, evaluator mengembalikan error.

// ---- Tokenizer ----
function tokenize(formula) {
  const tokens = [];
  let i = 0;
  while (i < formula.length) {
    const ch = formula[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }
    if (ch >= '0' && ch <= '9' || ch === '.') {
      let j = i;
      let dot = false;
      while (j < formula.length && ((formula[j] >= '0' && formula[j] <= '9') || formula[j] === '.')) {
        if (formula[j] === '.') {
          if (dot) throw new Error('Angka tidak valid (dua titik desimal).');
          dot = true;
        }
        j++;
      }
      const num = Number(formula.slice(i, j));
      if (!Number.isFinite(num)) throw new Error('Angka tidak valid.');
      tokens.push({ type: 'num', value: num });
      i = j;
      continue;
    }
    if (ch === '[') {
      const close = formula.indexOf(']', i + 1);
      if (close === -1) throw new Error('Tanda [ tidak ditutup dengan ].');
      const name = formula.slice(i + 1, close).trim();
      if (!name) throw new Error('Referensi kolom kosong: [].');
      tokens.push({ type: 'ref', value: name });
      i = close + 1;
      continue;
    }
    if ('+-*/%^()'.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    throw new Error(
      `Karakter tidak dikenal: "${ch}". Tulis nama kolom di dalam [tanda kurung siku], contoh: [Harga] * [Jumlah Barang].`
    );
  }
  return tokens;
}

// ---- Parser (recursive descent, PEMDAS) ----
function parseTokens(tokens, resolve) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function parseExpr() {
    let v = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      v = op === '+' ? v + rhs : v - rhs;
    }
    return v;
  }

  function parseTerm() {
    let v = parseFactor();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value;
      const rhs = parseFactor();
      if (op === '*') v = v * rhs;
      else if (op === '/') {
        if (rhs === 0) throw new Error('Pembagian dengan nol.');
        v = v / rhs;
      } else {
        if (rhs === 0) throw new Error('Modulo dengan nol.');
        v = v % rhs;
      }
    }
    return v;
  }

  function parseFactor() {
    let base = parseUnary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next();
      const exp = parseFactor(); // pangkat asosiatif kanan: 2^3^2 = 2^(3^2)
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary() {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      next();
      return -parseUnary();
    }
    if (peek() && peek().type === 'op' && peek().value === '+') {
      next();
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary() {
    const t = next();
    if (!t) throw new Error('Rumus berakhir sebelum waktunya (operator tanpa angka di belakangnya?).');
    if (t.type === 'num') return t.value;
    if (t.type === 'ref') {
      const v = resolve(t.value);
      if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
        throw new Error(`Kolom "${t.value}" tidak punya nilai angka di baris ini.`);
      }
      return v;
    }
    if (t.type === 'op' && t.value === '(') {
      const v = parseExpr();
      const close = next();
      if (!close || close.type !== 'op' || close.value !== ')') {
        throw new Error('Tanda kurung ( tidak ditutup dengan ).');
      }
      return v;
    }
    throw new Error(`Tidak bisa membaca rumus di dekat "${t.value}".`);
  }

  const value = parseExpr();
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new Error(`Tidak bisa membaca rumus di dekat "${t.value}".`);
  }
  return value;
}

// Evaluasi rumus. resolve(name) -> number | null (null = tidak ada nilai angka).
// Kembalian: { value: number|null, error: string|null }
export function evalFormula(formula, resolve) {
  try {
    if (!formula || !String(formula).trim()) return { value: null, error: 'Rumus kosong.' };
    const tokens = tokenize(String(formula));
    if (tokens.length === 0) return { value: null, error: 'Rumus kosong.' };
    const value = parseTokens(tokens, (name) => resolve(name));
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { value: null, error: 'Hasil rumus bukan angka yang valid.' };
    }
    return { value, error: null };
  } catch (e) {
    return { value: null, error: e.message };
  }
}

// Validasi rumus saat kolom dibuat/diubah.
// columns: skema saat ini (tanpa kolom baru). refs harus sudah ada & bertipe angka.
// Kembalian: { refs: string[] (nama kolom yang dipakai), error: string|null }
export function validateFormula(formula, columns) {
  try {
    if (!formula || !String(formula).trim()) return { refs: [], error: 'Rumus wajib diisi untuk kolom tipe rumus.' };
    const tokens = tokenize(String(formula));
    const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
    const refs = [];
    for (const t of tokens) {
      if (t.type !== 'ref') continue;
      const col = byName.get(t.value.toLowerCase());
      if (!col) return { refs: [], error: `Kolom "${t.value}" tidak ditemukan. Cek lagi nama kolomnya.` };
      if (col.type !== 'int' && col.type !== 'double' && col.type !== 'rumus') {
        return { refs: [], error: `Kolom "${t.value}" bertipe ${col.type} — rumus hanya bisa memakai kolom angka (int/double/rumus).` };
      }
      if (!refs.includes(col.name)) refs.push(col.name);
    }
    if (refs.length === 0) return { refs: [], error: 'Rumus harus memakai minimal satu kolom, contoh: [Harga] * [Jumlah Barang].' };
    // Uji hitung dengan nilai dummy 1 untuk menangkap kesalahan sintaks.
    const trial = evalFormula(formula, () => 1);
    if (trial.error) return { refs: [], error: trial.error };
    return { refs, error: null };
  } catch (e) {
    return { refs: [], error: e.message };
  }
}

// Daftar id kolom yang dipakai sebuah rumus (berdasarkan nama di skema).
export function formulaRefIds(formula, columns) {
  const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const ids = [];
  try {
    for (const t of tokenize(String(formula || ''))) {
      if (t.type === 'ref') {
        const col = byName.get(t.value.toLowerCase());
        if (col && !ids.includes(col.id)) ids.push(col.id);
      }
    }
  } catch (e) { /* abaikan — validasi dilakukan di tempat lain */ }
  return ids;
}
