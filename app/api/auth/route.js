import { NextResponse } from 'next/server';
import {
  getUsers,
  saveUsers,
  createSession,
  deleteSession,
  getSession,
  hashPassword,
  SESSION_COOKIE,
  SESSION_TTL_MS,
} from '../kv';

// Login: POST {username, password} -> set cookie sesi (httpOnly).
export async function POST(req) {
  try {
    const body = await req.json();
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    if (!username || !password) {
      return NextResponse.json({ error: 'Username dan password wajib diisi.' }, { status: 400 });
    }
    const users = await getUsers();
    const user = users.find((u) => u.username.toLowerCase() === username.toLowerCase());
    if (!user || hashPassword(password, user.salt) !== user.hash) {
      return NextResponse.json({ error: 'Username atau password salah.' }, { status: 401 });
    }
    const sid = await createSession(user.username, user.role);
    const res = NextResponse.json({ username: user.username, role: user.role });
    res.cookies.set(SESSION_COOKIE, sid, {
      httpOnly: true,
      path: '/',
      maxAge: Math.floor(SESSION_TTL_MS / 1000),
      sameSite: 'lax',
    });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Status sesi saat ini.
export async function GET(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Belum login.' }, { status: 401 });
    return NextResponse.json({ username: sess.username, role: sess.role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Logout: hapus sesi + cookie.
export async function DELETE(req) {
  try {
    const sess = await getSession(req);
    if (sess) await deleteSession(sess.id);
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, '', { httpOnly: true, path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// Ganti password sendiri: PUT {oldPassword, newPassword}
export async function PUT(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const body = await req.json();
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (!oldPassword || !newPassword) {
      return NextResponse.json({ error: 'Password lama dan baru wajib diisi.' }, { status: 400 });
    }
    if (newPassword.length < 6) {
      return NextResponse.json({ error: 'Password baru minimal 6 karakter.' }, { status: 400 });
    }
    const users = await getUsers();
    const user = users.find((u) => u.username === sess.username);
    if (!user) return NextResponse.json({ error: 'Akun tidak ditemukan.' }, { status: 404 });
    if (hashPassword(oldPassword, user.salt) !== user.hash) {
      return NextResponse.json({ error: 'Password lama salah.' }, { status: 401 });
    }
    const { randomBytes } = await import('node:crypto');
    user.salt = randomBytes(8).toString('hex');
    user.hash = hashPassword(newPassword, user.salt);
    await saveUsers(users);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
