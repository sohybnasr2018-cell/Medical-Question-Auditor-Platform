import { NextRequest, NextResponse } from 'next/server';
import { seedRepresentativeTestData } from '@/lib/sample-data/seeder';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const forceReset = Boolean(body.forceReset);

    const result = await seedRepresentativeTestData(forceReset);

    return NextResponse.json({
      success: true,
      message: 'Representative test dataset initialized successfully.',
      ...result
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
