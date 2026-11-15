// Urutan kolom tabel (drag and drop di judul kolom).
// Semua pengenal berbasis id kolom — nilai baris dan rumus tidak berubah
// saat urutan diubah, jadi tidak perlu hitung ulang apa pun.

// Pindahkan kolom fromId ke posisi toId (before=true: sebelum toId,
// before=false: sesudah toId). Mengembalikan array baru; kalau id tidak
// ketemu atau sama, kembalikan list apa adanya.
export function reorderColumns(list, fromId, toId, before = true) {
  const from = list.findIndex((c) => c.id === fromId);
  const to = list.findIndex((c) => c.id === toId);
  if (from === -1 || to === -1 || from === to) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  let idx = next.findIndex((c) => c.id === toId);
  if (!before) idx += 1;
  next.splice(idx, 0, moved);
  return next;
}

// order harus permutasi persis dari id kolom yang ada: semua kolom tepat
// satu kali, tanpa kurang, lebih, atau duplikat.
export function isValidOrder(order, columns) {
  if (!Array.isArray(order) || order.length !== columns.length) return false;
  const ids = new Set(columns.map((c) => c.id));
  return order.length === new Set(order).size && order.every((id) => ids.has(id));
}
