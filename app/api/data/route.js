import { NextResponse } from 'next/server';
import { getData, getSession } from '../kv';

export async function GET(req) {
  try {
    const sess = await getSession(req);
    if (!sess) return NextResponse.json({ error: 'Silakan login dulu.' }, { status: 401 });
    const data = await getData();
    return NextResponse.json({ ...data, username: sess.username, role: sess.role });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
