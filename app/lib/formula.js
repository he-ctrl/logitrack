// Mesin rumus LogiTrack — parser & evaluator aman (tanpa eval).
// Sintaks referensi kolom: [Nama Kolom] — tulis persis nama kolomnya,
// contoh: [Harga] * [Jumlah Barang]
// Nama kolom/variabel yang mengandung spasi boleh juga ditulis polos tanpa
// [ ] bila namanya sudah dikenal (mis. Wortel stok) — tokenizer mencocokkan
// nama terpanjang yang dikenal; bila tidak dikenal, tetap wajib pakai [ ].
// Operator: + - * / % ^ dan tanda kurung. Urutan hitung PEMDAS.
// IF ala Excel: IF(kondisi, jika_benar, jika_salah) — alias JIKA; kondisi
// memakai perbandingan > < >= <= = <> (!=, ==); bisa bersarang:
// IF(A, 1, IF(B, 2, 3)). AND/OR/NOT juga ada (alias DAN/ATAU/TIDAK).
// STOK (hanya kolom rumus per-baris): STOK([jumlah], [Jenis barang], [Status])
// = stok berjalan per barang sampai baris ini (urut tanggal): in/masuk nambah,
// out/keluar ngurangin, nilai arah lain diabaikan; tanpa kolom arah, semua nambah.
// Agregat (hanya kolom rumus per-baris): sum/avg/count/min/max/median atas
// SEMUA baris — sum([jumlah]) atau sum([jumlah][kondisi; kondisi]), kondisi
// berbentuk nilai:Kolom; nilai boleh literal (in:Status) atau INI (= nilai
// kolom itu di baris ini, mis. INI:Jenis barang). Perbandingan kondisi tanpa
// peduli huruf besar/kecil dan spasi.
// Referensi hanya boleh kolom angka (int / double / rumus).
// Hasil harus angka berhingga; kalau tidak, evaluator mengembalikan error.

// ---- Tokenizer ----
function tokenize(formula, names = []) {
  const tokens = [];
  let i = 0;
  // Nama terpanjang yang dikenal, mulai dari posisi p — supaya nama
  // berspasi (mis. "Wortel stok") terbaca sebagai satu referensi.
  function matchKnownName(p) {
    const rest = String(formula).slice(p).toLowerCase();
    let best = null;
    for (const n of names) {
      const name = String(n || '');
      if (!name) continue;
      if (rest.startsWith(name.toLowerCase()) && (!best || name.length > best.length)) {
        const after = rest[name.length];
        if (after === undefined || !/[a-z0-9_]/.test(after)) best = name;
      }
    }
    return best;
  }
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
    if (ch === ',') {
      tokens.push({ type: 'op', value: ',' });
      i++;
      continue;
    }
    const two = formula.slice(i, i + 2);
    if (['>=', '<=', '<>', '!=', '=='].includes(two)) {
      tokens.push({ type: 'op', value: two });
      i += 2;
      continue;
    }
    if ('+-*/%^()><='.includes(ch)) {
      tokens.push({ type: 'op', value: ch });
      i++;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      // Kata kunci fungsi menang atas nama kolom bila diikuti '(' — supaya
      // kolom yang namanya sama dengan fungsi (mis. kolom "Stok" dengan
      // rumus STOK(...)) tetap bisa dipakai sebagai fungsi.
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(formula.slice(i))[0];
      const after = formula.slice(i + word.length).trimStart();
      if (after[0] === '(') {
        const kw = word.toLowerCase();
        if (kw === 'if' || kw === 'jika') { tokens.push({ type: 'fn', value: 'if' }); i += word.length; continue; }
        if (kw === 'and' || kw === 'dan') { tokens.push({ type: 'fn', value: 'and' }); i += word.length; continue; }
        if (kw === 'or' || kw === 'atau') { tokens.push({ type: 'fn', value: 'or' }); i += word.length; continue; }
        if (kw === 'not' || kw === 'tidak') { tokens.push({ type: 'fn', value: 'not' }); i += word.length; continue; }
        if (kw === 'stok') { tokens.push({ type: 'fn', value: 'stok' }); i += word.length; continue; }
        if (kw === 'sum' || kw === 'avg' || kw === 'average' || kw === 'median' || kw === 'count' || kw === 'min' || kw === 'max') { tokens.push({ type: 'fn', value: kw === 'average' ? 'avg' : kw }); i += word.length; continue; }
      }
      const known = matchKnownName(i);
      if (known) {
        tokens.push({ type: 'ref', value: known });
        i += known.length;
        continue;
      }
    }
    throw new Error(
      `Karakter tidak dikenal: "${ch}". Tulis nama kolom di dalam [tanda kurung siku], contoh: [Harga] * [Jumlah Barang].`
    );
  }
  return tokens;
}

// ---- Parser (recursive descent, PEMDAS) ----
// Nilai internal bisa number atau boolean (hasil perbandingan). Hitung
// aritmetika hanya menerima number; kondisi IF/AND/OR/NOT menerima
// boolean atau number (0 = salah, selain 0 = benar, ala Excel).
// opts.running(qty, item, dir) -> number|null dipakai fungsi STOK.
function parseTokens(tokens, resolve, opts = {}) {
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function needNum(v) {
    if (typeof v !== 'number') throw new Error('Hasil perbandingan (benar/salah) tidak bisa langsung dihitung — pakai IF(...) untuk mengubahnya jadi angka.');
    return v;
  }
  function truthy(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    throw new Error('Kondisi IF harus berupa perbandingan atau angka.');
  }
  function expectOp(value, msg) {
    const t = next();
    if (!t || t.type !== 'op' || t.value !== value) throw new Error(msg);
  }
  // "nilai:Kolom; nilai:Kolom" di dalam sum/avg/... — nilai boleh literal
  // (in:Status) atau INI (= nilai kolom itu di baris ini).
  function parseConds(raw) {
    const conds = [];
    for (const part of String(raw).split(';')) {
      const p = part.trim();
      if (!p) continue;
      const ci = p.indexOf(':');
      if (ci === -1) throw new Error(`Kondisi "${p}" harus berbentuk nilai:Kolom, mis. INI:Jenis barang atau in:Status.`);
      const value = p.slice(0, ci).trim();
      const column = p.slice(ci + 1).trim();
      if (!value || !column) throw new Error(`Kondisi "${p}" harus berbentuk nilai:Kolom, mis. INI:Jenis barang atau in:Status.`);
      conds.push({ value, column });
    }
    return conds;
  }

  // Perbandingan — level terendah, di atas parseExpr.
  function parseComparison() {
    let v = parseExpr();
    const t = peek();
    if (t && t.type === 'op' && ['>', '<', '>=', '<=', '=', '==', '<>', '!='].includes(t.value)) {
      const op = next().value;
      const rhs = parseExpr();
      if (typeof v !== 'number' || typeof rhs !== 'number') {
        throw new Error('Perbandingan hanya bisa membandingkan angka.');
      }
      switch (op) {
        case '>': return v > rhs;
        case '<': return v < rhs;
        case '>=': return v >= rhs;
        case '<=': return v <= rhs;
        case '=':
        case '==': return v === rhs;
        case '<>':
        case '!=': return v !== rhs;
        default: throw new Error('Operator perbandingan tidak dikenal.');
      }
    }
    return v;
  }

  function parseExpr() {
    let v = parseTerm();
    while (peek() && peek().type === 'op' && (peek().value === '+' || peek().value === '-')) {
      const op = next().value;
      const rhs = parseTerm();
      v = op === '+' ? needNum(v) + needNum(rhs) : needNum(v) - needNum(rhs);
    }
    return v;
  }

  function parseTerm() {
    let v = parseFactor();
    while (peek() && peek().type === 'op' && (peek().value === '*' || peek().value === '/' || peek().value === '%')) {
      const op = next().value;
      const rhs = parseFactor();
      if (op === '*') v = needNum(v) * needNum(rhs);
      else if (op === '/') {
        if (needNum(rhs) === 0) throw new Error('Pembagian dengan nol.');
        v = needNum(v) / needNum(rhs);
      } else {
        if (needNum(rhs) === 0) throw new Error('Modulo dengan nol.');
        v = needNum(v) % needNum(rhs);
      }
    }
    return v;
  }

  function parseFactor() {
    let base = parseUnary();
    if (peek() && peek().type === 'op' && peek().value === '^') {
      next();
      const exp = parseFactor(); // pangkat asosiatif kanan: 2^3^2 = 2^(3^2)
      base = Math.pow(needNum(base), needNum(exp));
    }
    return base;
  }

  function parseUnary() {
    if (peek() && peek().type === 'op' && peek().value === '-') {
      next();
      return -needNum(parseUnary());
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
    if (t.type === 'fn') {
      const kw = t.value;
      expectOp('(', `Fungsi ${kw.toUpperCase()} harus diikuti tanda kurung, mis. ${kw.toUpperCase()}(...).`);
      if (kw === 'stok') {
        // STOK([jumlah], [Jenis barang], [Status]) — stok berjalan per barang
        // sampai baris ini (urut tanggal): in/masuk nambah, out/keluar ngurangin.
        const expectRefArg = () => {
          const a = next();
          if (!a || a.type !== 'ref') throw new Error('STOK butuh nama kolom, mis. STOK([jumlah], [Jenis barang], [Status]).');
          return a.value;
        };
        const qty = expectRefArg();
        expectOp(',', 'STOK butuh 2 atau 3 bagian dipisah koma: STOK([jumlah], [Jenis barang], [Status]).');
        const item = expectRefArg();
        let dir = null;
        if (peek() && peek().type === 'op' && peek().value === ',') {
          next();
          dir = expectRefArg();
        }
        expectOp(')', 'STOK harus ditutup dengan ).');
        if (!opts || typeof opts.running !== 'function') {
          throw new Error('STOK hanya bisa dihitung dari data tabel (saat menyimpan baris).');
        }
        const v = opts.running(qty, item, dir);
        if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error('STOK tidak bisa dihitung (kolom tidak ditemukan atau tidak ada baris yang cocok).');
        }
        return v;
      }
      if (kw === 'sum' || kw === 'avg' || kw === 'median' || kw === 'count' || kw === 'min' || kw === 'max') {
        // sum([Kolom]) atau sum([Kolom][kondisi; kondisi]) — agregat atas
        // SEMUA baris; kondisi INI memakai nilai kolom baris ini.
        const qtyTok = next();
        if (!qtyTok || qtyTok.type !== 'ref') throw new Error(`${kw.toUpperCase()} butuh nama kolom, mis. sum([jumlah]) atau sum([jumlah][INI:Jenis barang; in:Status]).`);
        let conds = [];
        const maybe = peek();
        if (maybe && maybe.type === 'ref' && maybe.value.includes(':')) {
          next();
          conds = parseConds(maybe.value);
        }
        expectOp(')', `${kw.toUpperCase()} harus ditutup dengan ).`);
        if (!opts || typeof opts.aggregate !== 'function') {
          throw new Error(`${kw.toUpperCase()} hanya bisa dihitung dari data tabel (saat menyimpan baris).`);
        }
        const v = opts.aggregate(kw, qtyTok.value, conds);
        if (v === null || v === undefined || typeof v !== 'number' || !Number.isFinite(v)) {
          throw new Error(`${kw.toUpperCase()} tidak bisa dihitung (kolom tidak ditemukan atau tidak ada baris yang cocok).`);
        }
        return v;
      }
      if (kw === 'if') {
        const cond = parseComparison();
        expectOp(',', 'IF butuh 3 bagian dipisah koma: IF(kondisi, jika benar, jika salah).');
        const a = parseComparison();
        expectOp(',', 'IF butuh 3 bagian dipisah koma: IF(kondisi, jika benar, jika salah).');
        const b = parseComparison();
        expectOp(')', 'IF harus ditutup dengan ).');
        return truthy(cond) ? needNum(a) : needNum(b);
      }
      if (kw === 'and' || kw === 'or') {
        const args = [parseComparison()];
        while (peek() && peek().type === 'op' && peek().value === ',') {
          next();
          args.push(parseComparison());
        }
        expectOp(')', `${kw.toUpperCase()} harus ditutup dengan ).`);
        return kw === 'and' ? args.every(truthy) : args.some(truthy);
      }
      // not
      const arg = parseComparison();
      expectOp(')', 'NOT harus ditutup dengan ).');
      return !truthy(arg);
    }
    if (t.type === 'op' && t.value === '(') {
      const v = parseComparison();
      const close = next();
      if (!close || close.type !== 'op' || close.value !== ')') {
        throw new Error('Tanda kurung ( tidak ditutup dengan ).');
      }
      return v;
    }
    throw new Error(`Tidak bisa membaca rumus di dekat "${t.value}".`);
  }

  const value = parseComparison();
  if (pos < tokens.length) {
    const t = tokens[pos];
    throw new Error(`Tidak bisa membaca rumus di dekat "${t.value}".`);
  }
  return value;
}

// Evaluasi rumus. resolve(name) -> number | null (null = tidak ada nilai angka).
// names: daftar nama kolom/variabel yang dikenal — dipakai supaya nama
// berspasi boleh ditulis polos tanpa [ ]. opts.running dipakai fungsi STOK.
// Kembalian: { value: number|null, error: string|null }
export function evalFormula(formula, resolve, names = [], opts = {}) {
  try {
    if (!formula || !String(formula).trim()) return { value: null, error: 'Rumus kosong.' };
    const tokens = tokenize(String(formula), names);
    if (tokens.length === 0) return { value: null, error: 'Rumus kosong.' };
    const value = parseTokens(tokens, (name) => resolve(name), opts);
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
// variables: daftar variabel tersimpan — nama variabel juga boleh dipakai
// sebagai referensi (nilainya angka). Kembalian:
// { refs: string[] (nama kolom yang dipakai), error: string|null }
export function validateFormula(formula, columns, variables = []) {
  try {
    if (!formula || !String(formula).trim()) return { refs: [], error: 'Rumus wajib diisi untuk kolom tipe rumus.' };
    const names = [...columns.map((c) => c.name), ...(variables || []).map((v) => v.name)];
    const tokens = tokenize(String(formula), names);
    const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
    const varByName = new Map((variables || []).map((v) => [String(v.name).toLowerCase(), v]));
    // Petakan argumen STOK: token fn 'stok' diikuti '(' — ref di dalamnya
    // adalah argumen ke-0 (jumlah, harus angka), ke-1 (barang), ke-2 (arah).
    const stokArgPos = new Map(); // indeks token -> nomor argumen
    const stokCalls = [];
    for (let k = 0; k < tokens.length; k++) {
      if (tokens[k].type === 'fn' && tokens[k].value === 'stok') {
        let j = k + 1;
        if (tokens[j]?.type !== 'op' || tokens[j].value !== '(') continue;
        j++;
        let depth = 0, argNo = 0;
        const callArgs = [];
        for (; j < tokens.length; j++) {
          const tk = tokens[j];
          if (tk.type === 'op' && tk.value === '(') depth++;
          else if (tk.type === 'op' && tk.value === ')') {
            if (depth === 0) break;
            depth--;
          } else if (tk.type === 'op' && tk.value === ',' && depth === 0) argNo++;
          else if (tk.type === 'ref' && depth === 0) {
            stokArgPos.set(j, argNo);
            callArgs[argNo] = tk.value;
          }
        }
        stokCalls.push(callArgs);
      }
    }
    for (const callArgs of stokCalls) {
      const n = callArgs.filter((a) => a !== undefined).length;
      if (n < 2 || n > 3) return { refs: [], error: 'STOK butuh 2 atau 3 bagian: STOK([jumlah], [Jenis barang], [Status]).' };
    }
    // Blok kondisi sum/avg/...: token ref berisi ':' tepat setelah ref jumlah
    // di dalam panggilan sum/avg/count/min/max/median — validasi kolom
    // kondisinya secara terpisah, bukan sebagai kolom angka.
    const AGG = new Set(['sum', 'avg', 'median', 'count', 'min', 'max']);
    const condBlockPos = new Set();
    for (let k = 3; k < tokens.length; k++) {
      if (tokens[k].type === 'ref' && tokens[k].value.includes(':')
        && tokens[k - 1]?.type === 'ref'
        && tokens[k - 2]?.type === 'op' && tokens[k - 2].value === '('
        && tokens[k - 3]?.type === 'fn' && AGG.has(tokens[k - 3].value)) {
        condBlockPos.add(k);
        for (const part of tokens[k].value.split(';')) {
          const p = part.trim();
          if (!p) continue;
          const ci = p.indexOf(':');
          if (ci === -1) return { refs: [], error: `Kondisi "${p}" harus berbentuk nilai:Kolom, mis. INI:Jenis barang atau in:Status.` };
          const colName = p.slice(ci + 1).trim();
          const col = byName.get(colName.toLowerCase());
          if (!col) return { refs: [], error: `"${colName}" tidak ditemukan — bukan kolom maupun variabel. Cek lagi namanya.` };
        }
      }
    }
    const refs = [];
    let hasVar = false;
    for (let ti = 0; ti < tokens.length; ti++) {
      const t = tokens[ti];
      if (t.type !== 'ref' || condBlockPos.has(ti)) continue;
      const col = byName.get(t.value.toLowerCase());
      if (stokArgPos.has(ti)) {
        // Argumen STOK: boleh kolom teks (barang/arah), bukan hanya angka.
        if (!col) return { refs: [], error: `"${t.value}" tidak ditemukan — bukan kolom maupun variabel. Cek lagi namanya.` };
        const argNo = stokArgPos.get(ti);
        if (argNo === 0) {
          if (col.type !== 'int' && col.type !== 'double' && col.type !== 'rumus') {
            return { refs: [], error: `STOK butuh kolom angka sebagai jumlah — "${t.value}" bertipe ${col.type}.` };
          }
          if (!refs.includes(col.name)) refs.push(col.name);
        } else if (argNo === 1) {
          if (col.type === 'tanggal') return { refs: [], error: 'STOK butuh kolom barang (teks/pilihan/angka), bukan Tanggal.' };
        } else {
          if (col.type !== 'string' && col.type !== 'selection') {
            return { refs: [], error: `Arah STOK harus kolom teks/pilihan (mis. Status berisi in/out) — "${t.value}" bertipe ${col.type}.` };
          }
        }
        continue;
      }
      if (col) {
        if (col.type !== 'int' && col.type !== 'double' && col.type !== 'rumus') {
          return { refs: [], error: `Kolom "${t.value}" bertipe ${col.type} — rumus hanya bisa memakai kolom angka (int/double/rumus).` };
        }
        if (!refs.includes(col.name)) refs.push(col.name);
        continue;
      }
      if (varByName.has(t.value.toLowerCase())) {
        hasVar = true;
        continue;
      }
      return { refs: [], error: `"${t.value}" tidak ditemukan — bukan kolom maupun variabel. Cek lagi namanya.` };
    }
    if (refs.length === 0 && !hasVar) return { refs: [], error: 'Rumus harus memakai minimal satu kolom atau variabel, contoh: [Harga] * [Jumlah Barang].' };
    // Uji hitung dengan nilai dummy 1 untuk menangkap kesalahan sintaks.
    const trial = evalFormula(formula, () => 1, names, { running: () => 1, aggregate: () => 1 });
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
    const tokens = tokenize(String(formula || ''), columns.map((c) => c.name));
    const AGG = new Set(['sum', 'avg', 'median', 'count', 'min', 'max']);
    for (let k = 0; k < tokens.length; k++) {
      const t = tokens[k];
      if (t.type !== 'ref') continue;
      // Blok kondisi sum/avg/... — daftarkan kolom-kolom kondisinya.
      if (t.value.includes(':') && tokens[k - 1]?.type === 'ref' && tokens[k - 2]?.type === 'op' && tokens[k - 2].value === '(' && tokens[k - 3]?.type === 'fn' && AGG.has(tokens[k - 3].value)) {
        for (const part of t.value.split(';')) {
          const p = part.trim();
          if (!p) continue;
          const ci = p.indexOf(':');
          if (ci === -1) continue;
          const col = byName.get(p.slice(ci + 1).trim().toLowerCase());
          if (col && !ids.includes(col.id)) ids.push(col.id);
        }
        continue;
      }
      const col = byName.get(t.value.toLowerCase());
      if (col && !ids.includes(col.id)) ids.push(col.id);
    }
  } catch (e) { /* abaikan — validasi dilakukan di tempat lain */ }
  return ids;
}
