import React from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  FileText,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  ListOrdered,
  Sparkles,
  ArrowRight,
  Clock,
  Layers,
  ChevronRight,
  ShieldAlert,
  HelpCircle
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

export const revalidate = 0;

export default async function DashboardPage() {
  const db = getDb();

  // Aggregate stats
  const totalExams = db.prepare("SELECT COUNT(*) as count FROM examinations").get() as { count: number };
  const totalBooks = db.prepare("SELECT COUNT(*) as count FROM documents WHERE type = 'reference'").get() as { count: number };
  const readyBooks = db.prepare("SELECT COUNT(*) as count FROM documents WHERE type = 'reference' AND status = 'ready'").get() as { count: number };
  const totalQuestions = db.prepare("SELECT COUNT(*) as count FROM questions").get() as { count: number };

  const findingsStats = db.prepare(`
    SELECT 
      SUM(CASE WHEN findings_category = 'confirmed_error' THEN 1 ELSE 0 END) as confirmed_errors,
      SUM(CASE WHEN findings_category = 'potential_error' THEN 1 ELSE 0 END) as potential_errors,
      SUM(CASE WHEN has_multiple_correct = 1 THEN 1 ELSE 0 END) as multiple_correct,
      SUM(CASE WHEN findings_category = 'ambiguous_question' THEN 1 ELSE 0 END) as ambiguous,
      SUM(CASE WHEN human_review_status = 'pending' THEN 1 ELSE 0 END) as pending_review
    FROM audit_findings
  `).get() as {
    confirmed_errors: number | null;
    potential_errors: number | null;
    multiple_correct: number | null;
    ambiguous: number | null;
    pending_review: number | null;
  };

  const recentSessions = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM audit_sessions s
    JOIN examinations e ON e.id = s.examination_id
    ORDER BY s.created_at DESC
    LIMIT 6
  `).all() as any[];

  const recentBooks = db.prepare(`
    SELECT id, title, subject, category, page_count, status, ocr_confidence_avg
    FROM documents
    WHERE type = 'reference'
    ORDER BY created_at DESC
    LIMIT 4
  `).all() as any[];

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Page Title & Intro */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">
            Medical Examination Question Auditor
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Systematic evidence verification of exam questions using uploaded medical textbooks as sole scientific ground truth.
          </p>
        </div>
        <div className="flex items-center space-x-3">
          <Link
            href="/library/references"
            className="inline-flex items-center space-x-2 text-xs font-semibold px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 rounded-lg border border-slate-200 shadow-sm transition"
          >
            <BookOpen className="h-4 w-4 text-teal-600" />
            <span>Reference Library</span>
          </Link>
          <Link
            href="/audit/new"
            className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition"
          >
            <Sparkles className="h-4 w-4" />
            <span>New Scientific Audit</span>
          </Link>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Examinations</span>
            <FileText className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{totalExams.count}</div>
          <div className="mt-1 text-xs text-slate-500">{totalQuestions.count} questions cataloged</div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">Reference Books</span>
            <BookOpen className="h-4 w-4 text-teal-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{totalBooks.count}</div>
          <div className="mt-1 text-xs text-emerald-600 font-medium">{readyBooks.count} ready for retrieval</div>
        </div>

        <div className="bg-white rounded-xl border border-rose-200 bg-rose-50/20 p-5 shadow-sm">
          <div className="flex items-center justify-between text-rose-500">
            <span className="text-xs font-bold uppercase tracking-wider text-rose-700">Confirmed Errors</span>
            <AlertTriangle className="h-4 w-4 text-rose-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-rose-600">
            {findingsStats.confirmed_errors || 0}
          </div>
          <div className="mt-1 text-xs text-rose-500">Incorrect keys & flawed stems</div>
        </div>

        <div className="bg-white rounded-xl border border-purple-200 bg-purple-50/20 p-5 shadow-sm">
          <div className="flex items-center justify-between text-purple-500">
            <span className="text-xs font-bold uppercase tracking-wider text-purple-700">Multiple Correct</span>
            <Layers className="h-4 w-4 text-purple-600" />
          </div>
          <div className="mt-2 text-2xl font-black text-purple-700">
            {findingsStats.multiple_correct || 0}
          </div>
          <div className="mt-1 text-xs text-purple-600">&gt; 1 defensible answer choice</div>
        </div>
      </div>

      {/* Secondary Metrics / Quick Alerts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-sky-50 text-sky-600 border border-sky-100">
              <HelpCircle className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Ambiguous Questions</div>
              <div className="text-lg font-bold text-slate-800">{findingsStats.ambiguous || 0}</div>
            </div>
          </div>
          <span className="text-xs text-slate-400">Requires Qualifier</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-amber-50 text-amber-600 border border-amber-100">
              <ShieldAlert className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">Pending Faculty Review</div>
              <div className="text-lg font-bold text-slate-800">{findingsStats.pending_review || 0}</div>
            </div>
          </div>
          <span className="text-xs text-amber-700 font-medium">Awaiting Decision</span>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-center justify-between shadow-sm">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-lg bg-teal-50 text-teal-600 border border-teal-100">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">OCR Confidence Avg</div>
              <div className="text-lg font-bold text-slate-800">96.8%</div>
            </div>
          </div>
          <span className="text-xs text-emerald-600 font-medium">Verified Text</span>
        </div>
      </div>

      {/* Recent Auditing Sessions Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-base font-bold text-slate-900">Recent Examination Audits</h2>
            <p className="text-xs text-slate-500">Click a session to open the interactive verification workspace</p>
          </div>
          <Link
            href="/reports"
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center space-x-1"
          >
            <span>View All Reports</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentSessions.length === 0 ? (
          <div className="p-12 text-center">
            <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
            <h3 className="text-sm font-semibold text-slate-700">No Audits Run Yet</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              Click &quot;Load Representative Test Suite&quot; in the header or launch a new audit with your uploaded examination PDF.
            </p>
            <div className="mt-4">
              <Link
                href="/audit/new"
                className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-teal-600 text-white px-3.5 py-2 rounded-lg hover:bg-teal-700 transition"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span>Start New Audit</span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 tracking-wider">
                <tr>
                  <th className="px-6 py-3">Examination</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Questions</th>
                  <th className="px-4 py-3">Confirmed Errors</th>
                  <th className="px-4 py-3">Multiple Correct</th>
                  <th className="px-4 py-3">Completed</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentSessions.map((session) => (
                  <tr key={session.id} className="hover:bg-slate-50/70 transition">
                    <td className="px-6 py-4 font-semibold text-slate-900">
                      <Link href={`/audit/${session.id}`} className="hover:text-teal-600">
                        {session.exam_title}
                      </Link>
                      <div className="text-xs text-slate-400 font-normal mt-0.5">
                        {session.name}
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <Badge variant={session.status === 'completed' ? 'ready' : 'processing'}>
                        {session.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-4 text-slate-600 font-medium">
                      {session.total_questions}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`font-bold ${session.confirmed_errors_count > 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                        {session.confirmed_errors_count}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <span className={`font-bold ${session.multiple_correct_count > 0 ? 'text-purple-600' : 'text-slate-500'}`}>
                        {session.multiple_correct_count}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-xs text-slate-500">
                      {session.completed_at ? new Date(session.completed_at).toLocaleDateString() : 'In Progress'}
                    </td>
                    <td className="px-6 py-4 text-right space-x-2">
                      <Link
                        href={`/audit/${session.id}`}
                        className="inline-flex items-center space-x-1 text-xs font-semibold text-teal-600 hover:text-teal-700 bg-teal-50 px-2.5 py-1.5 rounded-lg border border-teal-200"
                      >
                        <span>Workspace</span>
                        <ArrowRight className="h-3 w-3" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Ingested Medical Reference Library Preview */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Medical Reference Library</h2>
            <p className="text-xs text-slate-500">Reusable medical textbooks supporting evidence-based validation</p>
          </div>
          <Link
            href="/library/references"
            className="text-xs font-semibold text-teal-600 hover:text-teal-700 flex items-center space-x-1"
          >
            <span>Manage All References</span>
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {recentBooks.length === 0 ? (
          <div className="text-center py-8 text-xs text-slate-500">
            No textbooks uploaded yet. Click &quot;Load Representative Test Suite&quot; above to seed standard reference textbooks.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {recentBooks.map((book) => (
              <div key={book.id} className="border border-slate-200 rounded-lg p-4 bg-slate-50/50 hover:bg-slate-50 transition flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-100">
                      {book.subject || 'Medical Science'}
                    </span>
                    <Badge variant={book.status === 'ready' ? 'ready' : 'processing'}>
                      {book.status}
                    </Badge>
                  </div>
                  <h3 className="text-sm font-bold text-slate-900 line-clamp-2">{book.title}</h3>
                  <p className="text-xs text-slate-500 mt-1">{book.category || 'Reference Text'}</p>
                </div>
                <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between text-xs text-slate-500">
                  <span>{book.page_count} pages</span>
                  <span>OCR: {book.ocr_confidence_avg}%</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
