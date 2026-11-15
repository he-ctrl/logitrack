// Helper unduh (CSV / Excel / PDF) — dipakai client-side dari app/page.js.
// buildCSV / buildExcel / buildPDF murni (bisa dites di Node);
// downloadFile butuh DOM (browser).
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

export function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export function buildCSV(headers, rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  return '\uFEFF' + lines.join('\r\n');
}

export function buildExcel(headers, rows, sheetName = 'Data') {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

export function buildPDF(title, subtitle, headers, rows, chartImage) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFontSize(16);
  doc.text(title, 40, 40);
  let y = 56;
  if (subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(90, 90, 90);
    doc.text(doc.splitTextToSize(subtitle, pageW - 80), 40, 58);
    y = 78;
  }
  doc.setTextColor(0, 0, 0);
  if (chartImage) {
    const imgW = pageW - 80;
    const imgH = Math.round((imgW * 320) / 800);
    doc.addImage(chartImage, 'PNG', 40, y, imgW, imgH);
    y += imgH + 14;
  }
  autoTable(doc, {
    startY: y,
    head: [headers],
    body: rows.map((r) => r.map((v) => (v === null || v === undefined ? '' : v))),
    styles: { fontSize: 9 },
    headStyles: { fillColor: [15, 42, 67] },
  });
  return doc.output('arraybuffer');
}

export function downloadFile(filename, data, mime) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
