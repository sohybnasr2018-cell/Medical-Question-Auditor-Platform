import { getDb } from '@/lib/db';

export function generatePrintableHtmlAuditReport(sessionId: string): string {
  const db = getDb();

  const session = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM audit_sessions s
    JOIN examinations e ON e.id = s.examination_id
    WHERE s.id = ?
  `).get(sessionId) as any;

  if (!session) {
    throw new Error('Audit session not found');
  }

  const findings = db.prepare(`
    SELECT 
      f.*,
      q.stem,
      q.options_json,
      q.detected_primary_subject,
      q.detected_secondary_subjects,
      q.topic
    FROM audit_findings f
    JOIN questions q ON q.id = f.question_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC
  `).all(sessionId) as any[];

  const options = db.prepare(`
    SELECT o.*, f.question_number
    FROM option_analyses o
    JOIN audit_findings f ON f.id = o.audit_finding_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC, o.option_letter ASC
  `).all(sessionId) as any[];

  const citations = db.prepare(`
    SELECT c.*, f.question_number
    FROM evidence_citations c
    JOIN audit_findings f ON f.id = c.audit_finding_id
    WHERE f.audit_session_id = ?
    ORDER BY f.question_number ASC
  `).all(sessionId) as any[];

  // Group citations by question
  const citationsByQ: Record<number, any[]> = {};
  for (const c of citations) {
    if (!citationsByQ[c.question_number]) citationsByQ[c.question_number] = [];
    citationsByQ[c.question_number].push(c);
  }

  // Group options by question
  const optionsByQ: Record<number, any[]> = {};
  for (const o of options) {
    if (!optionsByQ[o.question_number]) optionsByQ[o.question_number] = [];
    optionsByQ[o.question_number].push(o);
  }

  // Subject statistics
  const subjectStats: Record<string, { total: number; errors: number }> = {};
  for (const f of findings) {
    const sub = f.detected_primary_subject || 'Other';
    if (!subjectStats[sub]) subjectStats[sub] = { total: 0, errors: 0 };
    subjectStats[sub].total++;
    if (f.findings_category === 'confirmed_error') subjectStats[sub].errors++;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Medical Examination Audit Report - ${session.exam_title}</title>
  <style>
    @page {
      size: A4;
      margin: 20mm;
      @bottom-right {
        content: counter(page);
      }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      line-height: 1.5;
      background: #ffffff;
      margin: 0;
      padding: 0;
    }
    .cover-page {
      page-break-after: always;
      min-height: 90vh;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      border-bottom: 2px solid #0d9488;
      padding-bottom: 40px;
    }
    .header-badge {
      display: inline-block;
      background: #0f766e;
      color: white;
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      padding: 4px 12px;
      border-radius: 4px;
    }
    h1.title {
      font-size: 32px;
      font-weight: 800;
      color: #134e4a;
      margin: 20px 0 10px 0;
    }
    .subtitle {
      font-size: 18px;
      color: #475569;
      margin-bottom: 30px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 15px;
      margin: 25px 0;
    }
    .stat-card {
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 15px;
      background: #f8fafc;
    }
    .stat-num {
      font-size: 28px;
      font-weight: 800;
      color: #0f172a;
    }
    .stat-num.danger { color: #e11d48; }
    .stat-num.warning { color: #d97706; }
    .stat-num.purple { color: #7c3aed; }
    .stat-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      font-size: 13px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      font-weight: 700;
      color: #334155;
    }
    .page-break {
      page-break-after: always;
    }
    .q-card {
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      padding: 18px;
      margin-bottom: 25px;
      page-break-inside: avoid;
    }
    .q-header {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 10px;
      margin-bottom: 12px;
    }
    .q-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
    }
    .pill {
      display: inline-block;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
    }
    .pill-confirmed { background: #ffe4e6; color: #be123c; border: 1px solid #fecdd3; }
    .pill-multiple { background: #f3e8ff; color: #6b21a8; border: 1px solid #e9d5ff; }
    .pill-ambiguous { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
    .pill-clean { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
    .citation-box {
      background: #f8fafc;
      border-left: 3px solid #0d9488;
      padding: 10px 14px;
      margin-top: 10px;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <div class="no-print" style="background: #0f766e; color: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center;">
    <div><strong>Medical Question Auditor & Validator</strong> — Official Examination Audit Report</div>
    <button onclick="window.print()" style="background: white; color: #0f766e; border: none; font-weight: 700; padding: 6px 16px; border-radius: 4px; cursor: pointer;">
      Print / Save as PDF
    </button>
  </div>

  <div style="padding: 30px;">
    <!-- COVER PAGE -->
    <div class="cover-page">
      <div>
        <span class="header-badge">CONFIDENTIAL AUDIT REPORT</span>
        <h1 class="title">${session.exam_title}</h1>
        <div class="subtitle">Evidence-Based Scientific Accuracy & Answer Key Verification</div>
        <p style="color: #64748b; font-size: 14px;">
          Generated on: <strong>${new Date().toLocaleDateString('en-US', { dateStyle: 'full' })}</strong><br>
          Session ID: <code>${session.id}</code><br>
          Verification Standard: <strong>17 Mandatory Scientific Integrity Rules</strong>
        </p>

        <h3 style="margin-top: 40px; color: #1e293b;">Executive Summary</h3>
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-num">${session.total_questions}</div>
            <div class="stat-label">Total Questions Audited</div>
          </div>
          <div class="stat-card">
            <div class="stat-num danger">${session.confirmed_errors_count}</div>
            <div class="stat-label">Confirmed Scientific Errors</div>
          </div>
          <div class="stat-card">
            <div class="stat-num purple">${session.multiple_correct_count}</div>
            <div class="stat-label">Multiple Correct Answers</div>
          </div>
          <div class="stat-card">
            <div class="stat-num danger">${session.no_correct_count}</div>
            <div class="stat-label">No Correct Answer Found</div>
          </div>
          <div class="stat-card">
            <div class="stat-num warning">${session.ambiguous_count}</div>
            <div class="stat-label">Ambiguous / Stem Defects</div>
          </div>
          <div class="stat-card">
            <div class="stat-num">${session.insufficient_evidence_count}</div>
            <div class="stat-label">Insufficient Evidence</div>
          </div>
        </div>
      </div>

      <div>
        <h4>Subject Breakdown</h4>
        <table>
          <thead>
            <tr>
              <th>Medical Subject</th>
              <th>Audited Questions</th>
              <th>Scientific Errors Detected</th>
              <th>Accuracy Rate</th>
            </tr>
          </thead>
          <tbody>
            ${Object.entries(subjectStats).map(([sub, stat]) => `
              <tr>
                <td><strong>${sub}</strong></td>
                <td>${stat.total}</td>
                <td><span style="color: ${stat.errors > 0 ? '#e11d48' : '#059669'}; font-weight: 700;">${stat.errors}</span></td>
                <td>${Math.round(((stat.total - stat.errors) / stat.total) * 100)}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- DETAILED QUESTION FINDINGS -->
    <h2 style="color: #134e4a; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px;">Detailed Question-by-Question Scientific Audit</h2>

    ${findings.map(f => {
      let opts = [];
      try { opts = JSON.parse(f.options_json); } catch {}
      const qCitations = citationsByQ[f.question_number] || [];
      const qOptions = optionsByQ[f.question_number] || [];

      let pillClass = 'pill-clean';
      if (f.findings_category === 'confirmed_error') pillClass = 'pill-confirmed';
      else if (f.has_multiple_correct === 1) pillClass = 'pill-multiple';
      else if (f.findings_category === 'ambiguous_question') pillClass = 'pill-ambiguous';

      return `
        <div class="q-card">
          <div class="q-header">
            <div>
              <span class="q-title">Question ${f.question_number}</span> &bull; 
              <span style="color: #0f766e; font-weight: 600;">${f.detected_primary_subject}</span>
              ${f.topic ? `<span style="color: #64748b;">(${f.topic})</span>` : ''}
            </div>
            <div>
              <span class="pill ${pillClass}">${f.findings_category.replace(/_/g, ' ')}</span>
              <span style="font-size: 11px; margin-left: 8px; font-weight: 700; color: #475569;">Confidence: ${f.confidence_score}%</span>
            </div>
          </div>

          <div style="font-size: 14px; margin-bottom: 12px; font-weight: 500;">
            ${f.stem}
          </div>

          ${f.proposed_stem ? `
            <div style="background: #fffbeb; border: 1px solid #fef3c7; padding: 10px; border-radius: 6px; margin-bottom: 12px; font-size: 12px;">
              <strong style="color: #b45309;">Proposed Stem Correction:</strong><br>
              ${f.proposed_stem}
            </div>
          ` : ''}

          <div style="margin-bottom: 14px;">
            <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; margin-bottom: 6px;">Answer Choices & Individual Option Audit:</div>
            ${opts.map((opt: any) => {
              const optAudit = qOptions.find((o: any) => o.option_letter === opt.label);
              const isProposed = (f.proposed_answer || '').includes(opt.label);
              const isOriginal = (f.original_designated_answer || '').includes(opt.label);

              let badge = '';
              if (optAudit?.is_scientifically_correct) {
                badge = '<span style="color: #059669; font-weight: 700;">[SCIENTIFICALLY CORRECT]</span>';
              } else if (isOriginal && !optAudit?.is_scientifically_correct) {
                badge = '<span style="color: #e11d48; font-weight: 700;">[INCORRECT DESIGNATED KEY]</span>';
              }

              return `
                <div style="padding: 6px 10px; border-radius: 4px; margin-bottom: 4px; background: ${isProposed ? '#f0fdf4' : (isOriginal ? '#fff1f2' : '#f8fafc')}; border: 1px solid ${isProposed ? '#bbf7d0' : (isOriginal ? '#fecdd3' : '#f1f5f9')}; font-size: 13px;">
                  <strong>${opt.label})</strong> ${opt.text} ${badge}
                  ${optAudit?.evaluation_rationale ? `<div style="font-size: 11px; color: #475569; margin-top: 3px;"><em>${optAudit.evaluation_rationale}</em></div>` : ''}
                </div>
              `;
            }).join('')}
          </div>

          <div style="display: flex; gap: 20px; font-size: 13px; margin-bottom: 10px; background: #f1f5f9; padding: 8px 12px; border-radius: 4px;">
            <div>Original Answer: <strong>${f.original_designated_answer || 'None'}</strong></div>
            <div>Audited Proposed Answer: <strong style="color: #0f766e;">${f.proposed_answer || 'None'}</strong></div>
            <div>Severity: <strong>${f.error_severity.toUpperCase()}</strong></div>
            <div>Human Review: <strong>${f.human_review_status.toUpperCase()}</strong></div>
          </div>

          <div style="font-size: 13px; color: #1e293b; margin-top: 8px;">
            <strong>Scientific Audit Explanation:</strong><br>
            ${f.detailed_explanation}
          </div>

          ${qCitations.length > 0 ? `
            <div style="margin-top: 12px;">
              <div style="font-size: 11px; font-weight: 700; color: #0d9488; text-transform: uppercase;">Supporting Reference Evidence Citations:</div>
              ${qCitations.map((c: any) => `
                <div class="citation-box">
                  <strong>${c.reference_book_name}</strong> &bull; Printed Page: <strong>${c.printed_page_number}</strong> (PDF Page Index: ${c.pdf_page_index})<br>
                  <span style="color: #334155;">"${c.statement_quote}"</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `;
    }).join('')}
  </div>
</body>
</html>`;
}
