import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const body = await req.json();
    const { findingId, status, humanNotes, humanEditedAnswer } = body;

    if (!findingId || !status) {
      return NextResponse.json({ error: 'findingId and status are required' }, { status: 400 });
    }

    const validStatuses = ['approved', 'rejected', 'postponed', 'pending'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
    }

    const db = getDb();
    db.prepare(`
      UPDATE audit_findings
      SET human_review_status = ?,
          human_notes = COALESCE(?, human_notes),
          human_edited_answer = COALESCE(?, human_edited_answer),
          human_reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ? AND audit_session_id = ?
    `).run(status, humanNotes ?? null, humanEditedAnswer ?? null, findingId, sessionId);

    return NextResponse.json({
      success: true,
      message: `Review updated to ${status}`
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
