import { NextRequest, NextResponse, after } from 'next/server';
import { getDb } from '@/lib/db';
import { executeAuditSession } from '@/lib/audit/engine';
import crypto from 'node:crypto';

export const maxDuration = 300;

export async function GET() {
  try {
    const db = getDb();
    const sessions = db.prepare(`
      SELECT 
        s.*,
        e.title as exam_title,
        (SELECT COUNT(*) FROM audit_findings WHERE audit_session_id = s.id AND human_review_status = 'pending') as pending_reviews_count,
        (SELECT COUNT(*) FROM audit_findings WHERE audit_session_id = s.id AND human_review_status = 'approved') as approved_reviews_count
      FROM audit_sessions s
      JOIN examinations e ON e.id = s.examination_id
      ORDER BY s.created_at DESC
    `).all();

    return NextResponse.json({ sessions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { examinationId, name, selectedReferenceIds, aiProvider } = body;

    if (!examinationId) {
      return NextResponse.json({ error: 'examinationId is required' }, { status: 400 });
    }

    const db = getDb();
    const exam = db.prepare("SELECT * FROM examinations WHERE id = ?").get(examinationId) as any;
    if (!exam) {
      return NextResponse.json({ error: 'Examination not found' }, { status: 404 });
    }

    const questionCount = db.prepare("SELECT COUNT(*) as count FROM questions WHERE examination_id = ?").get(examinationId) as { count: number };
    if (questionCount.count === 0) {
      return NextResponse.json({ error: 'Examination has no questions to audit' }, { status: 400 });
    }

    const sessionId = crypto.randomUUID();
    const sessionName = name || `Audit: ${exam.title} (${new Date().toLocaleDateString()})`;

    const insertSession = db.prepare(`
      INSERT INTO audit_sessions (
        id, name, examination_id, status, progress_percent, total_questions, selected_reference_ids, ai_provider_used
      ) VALUES (?, ?, ?, 'pending', 0, ?, ?, ?)
    `);

    const configuredProvider = (db.prepare("SELECT value FROM system_settings WHERE key = 'ai_provider'").get() as { value: string } | undefined)?.value;
    const effectiveProvider = aiProvider || configuredProvider || 'built_in';

    insertSession.run(
      sessionId,
      sessionName,
      examinationId,
      questionCount.count,
      JSON.stringify(selectedReferenceIds || []),
      effectiveProvider
    );

    // Use Next.js 15 after() so Vercel Serverless keeps running audit tasks after response is returned
    after(async () => {
      try {
        await executeAuditSession(sessionId);
      } catch (err) {
        console.error(`Audit execution failed for session ${sessionId}:`, err);
        db.prepare("UPDATE audit_sessions SET status = 'failed' WHERE id = ?").run(sessionId);
      }
    });

    return NextResponse.json({
      success: true,
      sessionId,
      name: sessionName,
      totalQuestions: questionCount.count,
      status: 'in_progress'
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
