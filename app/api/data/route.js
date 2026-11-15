import { NextResponse } from 'next/server';
import { getData } from '../kv';

export async function GET() {
  try {
    const data = await getData();
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
