import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(req: NextRequest) {
  try {
    const db = getDb();
    const url = new URL(req.url);
    const examId = url.searchParams.get('id');

    if (examId) {
      const examination = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examId) as any;
      if (!examination) {
        return NextResponse.json({ error: 'Examination not found' }, { status: 404 });
      }

      const questions = db.prepare(`
        SELECT * FROM questions
        WHERE examination_id = ?
        ORDER BY question_number ASC
      `).all(examId);

      const recentSession = db.prepare(`
        SELECT id, status, confirmed_errors_count, multiple_correct_count, completed_at
        FROM audit_sessions
        WHERE examination_id = ?
        ORDER BY created_at DESC LIMIT 1
      `).get(examId);

      return NextResponse.json({
        examination,
        questions,
        recentSession
      });
    }

    const examinations = db.prepare(`
      SELECT 
        e.*,
        (SELECT COUNT(*) FROM questions WHERE examination_id = e.id) as question_count,
        (SELECT id FROM audit_sessions WHERE examination_id = e.id ORDER BY created_at DESC LIMIT 1) as latest_session_id,
        (SELECT status FROM audit_sessions WHERE examination_id = e.id ORDER BY created_at DESC LIMIT 1) as latest_session_status
      FROM examinations e
      ORDER BY e.created_at DESC
    `).all();

    return NextResponse.json({ examinations });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Exam ID required' }, { status: 400 });

    const db = getDb();
    db.prepare("DELETE FROM questions WHERE examination_id = ?").run(id);
    db.prepare("DELETE FROM examinations WHERE id = ?").run(id);

    return NextResponse.json({ success: true, message: 'Examination deleted' });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
