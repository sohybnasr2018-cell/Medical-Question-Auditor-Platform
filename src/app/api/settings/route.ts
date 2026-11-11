import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET() {
  try {
    const db = getDb();
    const rows = db.prepare("SELECT key, value FROM system_settings").all() as Array<{ key: string; value: string }>;
    const settings: Record<string, string> = {};

    for (const r of rows) {
      if (r.key.includes('api_key') && r.value) {
        // Mask API keys for security
        settings[r.key] = r.value.length > 8 ? `${r.value.slice(0, 4)}...${r.value.slice(-4)}` : '••••••••';
        settings[`has_${r.key}`] = 'true';
      } else {
        settings[r.key] = r.value;
      }
    }

    return NextResponse.json({ settings });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const db = getDb();
    const updateSetting = db.prepare(`
      INSERT INTO system_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `);

    for (const [key, val] of Object.entries(body)) {
      if (typeof val === 'string') {
        // Don't overwrite with masked string
        if (key.includes('api_key') && (val.includes('•••') || val.includes('...'))) {
          continue;
        }
        updateSetting.run(key, val);
      }
    }

    return NextResponse.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
