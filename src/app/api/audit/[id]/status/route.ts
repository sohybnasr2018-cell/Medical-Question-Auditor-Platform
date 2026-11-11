import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();

    const session = db.prepare(`
      SELECT s.*, e.title as exam_title
      FROM audit_sessions s
      JOIN examinations e ON e.id = s.examination_id
      WHERE s.id = ?
    `).get(id) as any;

    if (!session) {
      return NextResponse.json({ error: 'Audit session not found' }, { status: 404 });
    }

    const findings = db.prepare(`
      SELECT 
        f.*,
        q.stem,
        q.options_json,
        q.designated_answer,
        q.detected_primary_subject,
        q.detected_secondary_subjects,
        q.topic
      FROM audit_findings f
      JOIN questions q ON q.id = f.question_id
      WHERE f.audit_session_id = ?
      ORDER BY f.question_number ASC
    `).all(id) as any[];

    // Fetch options and citations for all findings
    const optionAnalyses = db.prepare(`
      SELECT o.*, f.question_number
      FROM option_analyses o
      JOIN audit_findings f ON f.id = o.audit_finding_id
      WHERE f.audit_session_id = ?
      ORDER BY f.question_number ASC, o.option_letter ASC
    `).all(id) as any[];

    const citations = db.prepare(`
      SELECT c.*, f.question_number
      FROM evidence_citations c
      JOIN audit_findings f ON f.id = c.audit_finding_id
      WHERE f.audit_session_id = ?
      ORDER BY f.question_number ASC
    `).all(id) as any[];

    // Attach options and citations to corresponding finding
    const findingsWithDetails = findings.map(f => {
      let parsedOptions = [];
      try { parsedOptions = JSON.parse(f.options_json); } catch {}

      return {
        ...f,
        options: parsedOptions,
        optionAnalyses: optionAnalyses.filter(o => o.audit_finding_id === f.id),
        citations: citations.filter(c => c.audit_finding_id === f.id)
      };
    });

    return NextResponse.json({
      session,
      findings: findingsWithDetails
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
