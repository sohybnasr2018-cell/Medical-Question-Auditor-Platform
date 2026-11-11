import React from 'react';
import Link from 'next/link';
import { getDb } from '@/lib/db';
import {
  FileSpreadsheet,
  Printer,
  FileText,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Layers,
  ArrowRight
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';

export const revalidate = 0;

export default async function ExportedReportsPage() {
  const db = getDb();

  const sessions = db.prepare(`
    SELECT s.*, e.title as exam_title
    FROM audit_sessions s
    JOIN examinations e ON e.id = s.examination_id
    ORDER BY s.created_at DESC
  `).all() as any[];

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
          <FileSpreadsheet className="h-6 w-6 text-teal-600" />
          <span>Audit Reports & Data Exports</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Generate publication-ready PDF audit reports and structured multi-sheet Excel workbooks.
        </p>
      </div>

      {sessions.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">No Audit Reports Generated Yet</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Once you launch an audit session, comprehensive PDF and Excel exports will become available here.
          </p>
          <div className="mt-4">
            <Link
              href="/audit/new"
              className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-teal-600 text-white px-3.5 py-2 rounded-lg hover:bg-teal-700 transition"
            >
              <span>Launch First Audit</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {sessions.map((session) => (
            <div
              key={session.id}
              className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm hover:shadow-md transition flex flex-col md:flex-row md:items-center justify-between gap-6"
            >
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Badge variant={session.status === 'completed' ? 'ready' : 'processing'}>
                    {session.status.toUpperCase()}
                  </Badge>
                  <span className="text-xs text-slate-400">
                    ID: <code className="font-mono text-slate-600">{session.id.slice(0, 8)}</code>
                  </span>
                  <span className="text-xs text-slate-400 flex items-center space-x-1">
                    <Calendar className="h-3 w-3" />
                    <span>{new Date(session.created_at).toLocaleDateString()}</span>
                  </span>
                </div>

                <h2 className="text-lg font-bold text-slate-900">{session.exam_title}</h2>
                <p className="text-xs text-slate-500 font-medium">{session.name}</p>

                {/* Metrics badges */}
                <div className="flex flex-wrap items-center gap-3 pt-2 text-xs">
                  <span className="bg-slate-100 text-slate-700 px-2.5 py-1 rounded-md font-semibold">
                    {session.total_questions} Questions
                  </span>

                  <span className={`px-2.5 py-1 rounded-md font-semibold ${
                    session.confirmed_errors_count > 0 ? 'bg-rose-50 text-rose-700 border border-rose-200' : 'bg-slate-50 text-slate-500'
                  }`}>
                    {session.confirmed_errors_count} Confirmed Errors
                  </span>

                  <span className={`px-2.5 py-1 rounded-md font-semibold ${
                    session.multiple_correct_count > 0 ? 'bg-purple-50 text-purple-700 border border-purple-200' : 'bg-slate-50 text-slate-500'
                  }`}>
                    {session.multiple_correct_count} Multiple Correct
                  </span>

                  <span className={`px-2.5 py-1 rounded-md font-semibold ${
                    session.ambiguous_count > 0 ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-slate-50 text-slate-500'
                  }`}>
                    {session.ambiguous_count} Ambiguous Stems
                  </span>
                </div>
              </div>

              {/* Download Buttons */}
              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <Link
                  href={`/audit/${session.id}`}
                  className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition"
                >
                  <span>Interactive Workspace</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>

                <a
                  href={`/api/export/excel?sessionId=${session.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 rounded-lg border border-emerald-200 transition"
                >
                  <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                  <span>Excel (.xlsx)</span>
                </a>

                <a
                  href={`/api/export/pdf?sessionId=${session.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>Printable PDF</span>
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
