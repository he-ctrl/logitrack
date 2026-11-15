// Mesin rumus agregat LogiTrack — dihitung atas sekumpulan baris.
// Dipakai untuk Variabel (rumus tersimpan) dan dihitung client-side maupun
// server-side (kolom rumus per-baris yang memakai [Nama Variabel]).
//
// Sintaks:
//   sum(Kolom)                      jumlah semua nilai kolom itu
//   avg(Kolom) / average(Kolom)     rata-rata
//   median(Kolom)                   nilai tengah
//   count(Kolom)                    berapa baris yang cocok
//   min(Kolom) / max(Kolom)         nilai terkecil / terbesar
//   Kolom[nilai:Kolom; nilai:Kolom]  filter per nilai, mis:
//     sum([Jumlah Barang][in:Arus])            jumlah barang yang arusnya "in"
//     sum(barang[pending:arus])                (nama satu kata boleh polos)
//   [Nama Variabel]                 nilai variabel lain (boleh dipakai di
//     dalam rumus, tidak boleh di dalam sum/avg/... — pakai langsung).
//   Operator + - * / % ^ dan ( ), urutan hitung PEMDAS, boleh unary minus.
//   Nama kolom/variabel yang mengandung spasi wajib pakai [tanda kurung siku].
//   Nilai kondisi boleh mengandung spasi (dibaca sampai ':' pertama).
//
// Contoh lengkap (template pengguna):
//   (sum(barang[in:arus]) + sum(barang[pending:arus])) - sum(barang[out:arus])
// Dengan variabel:
//   Bawang In  = sum([jumlah][Bawang merah:Jenis barang; in:Arus])
//   Bawang Out = sum([jumlah][Bawang merah:Jenis barang; out:Arus])
//   Stok Bawang = [Bawang In] - [Bawang Out]

export function resolveColumn(name, columns) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return columns.find((c) => String(c.name).toLowerCase() === n) || null;
}

export function resolveVariable(name, variables) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return null;
  return (variables || []).find((v) => String(v.name).toLowerCase() === n) || null;
}

const NUMERIC = new Set(['int', 'double', 'rumus']);
const FUNCS = new Set(['sum', 'avg', 'average', 'median', 'count', 'min', 'max']);

function parseError(msg) {
  const e = new Error(msg);
  e.isParse = true;
  throw e;
}

// Parser recursive-descent langsung atas string.
function makeParser(src, columns, variables) {
  let i = 0;
  const s = String(src || '');

  function skipWs() {
    while (i < s.length && /\s/.test(s[i])) i++;
  }
  function peek() {
    skipWs();
    return s[i];
  }
  function expect(ch) {
    skipWs();
    if (s[i] !== ch) parseError(`Harusnya ada "${ch}" di posisi ${i + 1}.`);
    i++;
  }
  function readNumber() {
    skipWs();
    const m = /^[0-9]+(\.[0-9]+)?/.exec(s.slice(i));
    if (!m) parseError(`Angka tidak dikenal di posisi ${i + 1}.`);
    i += m[0].length;
    return { type: 'num', value: Number(m[0]) };
  }
  function readIdent() {
    skipWs();
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (!m) return null;
    i += m[0].length;
    return m[0];
  }
  function readBracketName() {
    // Sudah di '['. Baca sampai ']' — nama boleh mengandung spasi.
    i++; // lewati '['
    const end = s.indexOf(']', i);
    if (end === -1) parseError('Tanda ] penutup tidak ditemukan.');
    const name = s.slice(i, end).trim();
    i = end + 1;
    if (!name) parseError('Nama kolom di dalam [ ] tidak boleh kosong.');
    return name;
  }
  function readColName() {
    skipWs();
    if (s[i] === '[') return readBracketName();
    const id = readIdent();
    if (!id) parseError(`Nama kolom tidak dikenal di posisi ${i + 1}. Pakai [Nama Kolom] bila namanya mengandung spasi.`);
    return id;
  }
  // Baca satu kondisi "nilai:Kolom" — nilai dibaca mentah sampai ':' pertama,
  // nama kolom dibaca mentah sampai ';' atau ']' (boleh mengandung spasi).
  function readCondition() {
    skipWs();
    const colon = s.indexOf(':', i);
    if (colon === -1) parseError('Kondisi harus berbentuk nilai:Kolom (mis. in:Arus).');
    const value = s.slice(i, colon).trim();
    if (!value) parseError('Nilai kondisi tidak boleh kosong (mis. in:Arus).');
    i = colon + 1;
    skipWs();
    let col;
    if (s[i] === '[') {
      col = readBracketName();
    } else {
      const end = s.indexOf(']', i);
      const semi = s.indexOf(';', i);
      let stop = end;
      if (semi !== -1 && (end === -1 || semi < end)) stop = semi;
      if (stop === -1) parseError('Kondisi harus ditutup dengan ] (mis. [in:Arus]).');
      col = s.slice(i, stop).trim();
      i = stop;
      if (!col) parseError('Nama kolom kondisi tidak boleh kosong.');
    }
    return { value, col };
  }
  function readRef() {
    const col = readColName();
    if (!resolveColumn(col, columns)) {
      if (resolveVariable(col, variables)) {
        parseError(`"${col}" adalah variabel — variabel tidak bisa dipakai di dalam sum/avg/median, pakai langsung [${col}] di luar fungsi.`);
      }
      parseError(`Kolom "${col}" tidak ditemukan.`);
    }
    const conds = [];
    skipWs();
    if (s[i] === '[') {
      i++; // lewati '['
      skipWs();
      if (s[i] === ']') {
        i++;
      } else {
        for (;;) {
          conds.push(readCondition());
          skipWs();
          if (s[i] === ';') { i++; continue; }
          if (s[i] === ']') { i++; break; }
          parseError('Kondisi dipisah dengan ; dan ditutup ] (mis. [in:Arus; pending:Arus]).');
        }
      }
    }
    return { col, conds };
  }
  // Nama di luar fungsi: harus variabel. Kolom polos di sini tidak ada artinya.
  function readVarOrFail(name) {
    const v = resolveVariable(name, variables);
    if (v) return { type: 'var', name: v.name };
    if (resolveColumn(name, columns)) {
      parseError(`Kolom "${name}" harus dipakai di dalam sum / avg / median / count / min / max, mis. sum([${name}]).`);
    }
    parseError(`"${name}" tidak ditemukan — bukan kolom maupun variabel.`);
  }
  function parsePrimary() {
    skipWs();
    const ch = s[i];
    if (ch === '(') {
      i++;
      const node = parseExpr();
      expect(')');
      return node;
    }
    if (ch && /[0-9]/.test(ch)) return readNumber();
    if (ch === '[') return readVarOrFail(readBracketName());
    const id = readIdent();
    if (!id) parseError(`Karakter tidak dikenal "${ch || 'akhir rumus'}" di posisi ${i + 1}.`);
    skipWs();
    if (s[i] === '(') {
      const fn = id.toLowerCase();
      if (!FUNCS.has(fn)) parseError(`Fungsi "${id}" tidak dikenal. Yang bisa dipakai: sum, avg, median, count, min, max.`);
      i++; // lewati '('
      const ref = readRef();
      expect(')');
      return { type: 'fn', fn, ref };
    }
    return readVarOrFail(id);
  }
  function parsePower() {
    const left = parsePrimary();
    skipWs();
    if (s[i] === '^') {
      i++;
      const right = parseFactor();
      return { type: 'bin', op: '^', left, right };
    }
    return left;
  }
  function parseFactor() {
    skipWs();
    if (s[i] === '-') { i++; return { type: 'neg', node: parseFactor() }; }
    if (s[i] === '+') { i++; return parseFactor(); }
    return parsePower();
  }
  function parseTerm() {
    let node = parseFactor();
    for (;;) {
      skipWs();
      const ch = s[i];
      if (ch === '*' || ch === '/' || ch === '%') {
        i++;
        node = { type: 'bin', op: ch, left: node, right: parseFactor() };
      } else return node;
    }
  }
  function parseExpr() {
    let node = parseTerm();
    for (;;) {
      skipWs();
      const ch = s[i];
      if (ch === '+' || ch === '-') {
        i++;
        node = { type: 'bin', op: ch, left: node, right: parseTerm() };
      } else return node;
    }
  }

  function parse() {
    if (!s.trim()) parseError('Rumus masih kosong.');
    const node = parseExpr();
    skipWs();
    if (i < s.length) parseError(`Karakter tidak dikenal "${s[i]}" di posisi ${i + 1}.`);
    return node;
  }

  return { parse };
}

// Validasi sintaks + keberadaan kolom/variabel + deteksi siklus antar-variabel.
// variables: daftar variabel yang sudah ada (untuk POST variabel baru, sertakan
// kandidatnya supaya rujukan ke diri sendiri terdeteksi sebagai siklus).
export function validateAggregate(formula, columns, variables = []) {
  try {
    const node = makeParser(formula, columns, variables).parse();
    checkNode(node, columns, variables, new Set());
    return { error: null };
  } catch (e) {
    return { error: e.message || 'Rumus tidak valid.' };
  }
}

function checkNode(node, columns, variables, visiting) {
  if (node.type === 'num') return;
  if (node.type === 'neg') { checkNode(node.node, columns, variables, visiting); return; }
  if (node.type === 'bin') { checkNode(node.left, columns, variables, visiting); checkNode(node.right, columns, variables, visiting); return; }
  if (node.type === 'fn') {
    const target = resolveColumn(node.ref.col, columns);
    if (!target) parseError(`Kolom "${node.ref.col}" tidak ditemukan.`);
    if (node.fn !== 'count' && !NUMERIC.has(target.type)) {
      parseError(`Kolom "${target.name}" bertipe ${target.type} — ${node.fn} hanya bisa memakai kolom angka (int/double/rumus).`);
    }
    for (const cond of node.ref.conds) {
      const cc = resolveColumn(cond.col, columns);
      if (!cc) parseError(`Kolom kondisi "${cond.col}" tidak ditemukan.`);
    }
    return;
  }
  if (node.type === 'var') {
    const v = resolveVariable(node.name, variables);
    if (!v) parseError(`Variabel "${node.name}" tidak ditemukan.`);
    const key = v.name.toLowerCase();
    if (visiting.has(key)) parseError(`Variabel "${v.name}" saling merujuk dengan variabel lain (siklus).`);
    try {
      const inner = makeParser(v.formula, columns, variables).parse();
      checkNode(inner, columns, variables, new Set([...visiting, key]));
    } catch (e) {
      if (e.isParse) throw new Error(`Variabel "${v.name}" rumusnya bermasalah: ${e.message}`);
      throw e;
    }
    return;
  }
  parseError('Rumus tidak valid.');
}

// Evaluasi atas baris yang diberikan. Kembalikan { value } atau { error }.
export function evalAggregate(formula, columns, rows, variables = []) {
  try {
    const node = makeParser(formula, columns, variables).parse();
    checkNode(node, columns, variables, new Set());
    const value = evalNode(node, columns, rows, variables, { cache: new Map(), resolving: new Set() });
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { error: 'Hasilnya bukan angka.' };
    }
    return { value };
  } catch (e) {
    return { error: e.message || 'Rumus tidak valid.' };
  }
}

function matchingValues(ref, columns, rows) {
  const target = resolveColumn(ref.col, columns);
  const condCols = ref.conds.map((c) => ({ value: c.value, col: resolveColumn(c.col, columns) }));
  const matched = rows.filter((r) =>
    condCols.every(({ value, col }) => String(r.values[col.id] ?? '') === value)
  );
  const nums = [];
  for (const r of matched) {
    const v = r.values[target.id];
    const n = Number(v);
    if (v !== null && v !== undefined && v !== '' && Number.isFinite(n)) nums.push(n);
  }
  return { matched: matched.length, nums };
}

function evalNode(node, columns, rows, variables, ctx) {
  if (node.type === 'num') return node.value;
  if (node.type === 'neg') return -evalNode(node.node, columns, rows, variables, ctx);
  if (node.type === 'bin') {
    const a = evalNode(node.left, columns, rows, variables, ctx);
    const b = evalNode(node.right, columns, rows, variables, ctx);
    switch (node.op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/':
        if (b === 0) throw new Error('Pembagian dengan nol.');
        return a / b;
      case '%':
        if (b === 0) throw new Error('Pembagian dengan nol.');
        return a % b;
      case '^': return Math.pow(a, b);
      default: throw new Error('Operator tidak dikenal.');
    }
  }
  if (node.type === 'var') {
    const key = node.name.toLowerCase();
    if (ctx.cache.has(key)) return ctx.cache.get(key);
    if (ctx.resolving.has(key)) throw new Error(`Variabel "${node.name}" saling merujuk (siklus).`);
    const v = resolveVariable(node.name, variables);
    if (!v) throw new Error(`Variabel "${node.name}" tidak ditemukan.`);
    ctx.resolving.add(key);
    const inner = makeParser(v.formula, columns, variables).parse();
    const val = evalNode(inner, columns, rows, variables, ctx);
    ctx.resolving.delete(key);
    ctx.cache.set(key, val);
    return val;
  }
  if (node.type === 'fn') {
    const { matched, nums } = matchingValues(node.ref, columns, rows);
    switch (node.fn) {
      case 'sum': return nums.reduce((a, b) => a + b, 0);
      case 'count': return matched;
      case 'avg':
      case 'average':
        if (nums.length === 0) throw new Error('Tidak ada data yang cocok untuk dihitung rata-ratanya.');
        return nums.reduce((a, b) => a + b, 0) / nums.length;
      case 'median': {
        if (nums.length === 0) throw new Error('Tidak ada data yang cocok untuk dihitung mediannya.');
        const s = [...nums].sort((a, b) => a - b);
        const mid = Math.floor(s.length / 2);
        return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
      }
      case 'min':
        if (nums.length === 0) throw new Error('Tidak ada data yang cocok.');
        return Math.min(...nums);
      case 'max':
        if (nums.length === 0) throw new Error('Tidak ada data yang cocok.');
        return Math.max(...nums);
      default: throw new Error('Fungsi tidak dikenal.');
    }
  }
  throw new Error('Rumus tidak valid.');
}

// Daftar id kolom yang dipakai sebuah rumus agregat — termasuk kolom kondisi
// dan kolom yang dipakai variabel lain yang dirujuk (transitif). Dipakai untuk
// memblokir hapus kolom yang masih dipakai variabel.
export function aggregateRefIds(formula, columns, variables = []) {
  const byName = new Map(columns.map((c) => [c.name.toLowerCase(), c]));
  const ids = [];
  const seenVars = new Set();
  function walk(node) {
    if (!node) return;
    if (node.type === 'fn') {
      const t = byName.get(String(node.ref.col).toLowerCase());
      if (t && !ids.includes(t.id)) ids.push(t.id);
      for (const cond of node.ref.conds) {
        const cc = byName.get(String(cond.col).toLowerCase());
        if (cc && !ids.includes(cc.id)) ids.push(cc.id);
      }
    } else if (node.type === 'var') {
      const key = String(node.name).toLowerCase();
      if (seenVars.has(key)) return;
      seenVars.add(key);
      const v = resolveVariable(node.name, variables);
      if (!v) return;
      try {
        walk(makeParser(v.formula, columns, variables).parse());
      } catch (e) { /* abaikan rumus rusak */ }
    } else if (node.type === 'neg') {
      walk(node.node);
    } else if (node.type === 'bin') {
      walk(node.left);
      walk(node.right);
    }
  }
  try {
    walk(makeParser(formula, columns, variables).parse());
  } catch (e) { /* abaikan */ }
  return ids;
}
