import './globals.css';

export const metadata = {
  title: 'LogiTrack — Dashboard Pelacakan Logistik',
  description: 'Tabel logistik dinamis, grafik, dan prediksi deret waktu dengan TimesFM.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
