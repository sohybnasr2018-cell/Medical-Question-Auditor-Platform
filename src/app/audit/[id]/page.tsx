'use client';

import React, { useState, useEffect, use } from 'react';
import Link from 'next/link';
import {
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  FileText,
  BookOpen,
  ArrowLeft,
  ArrowRight,
  Filter,
  Check,
  X,
  Clock,
  Edit3,
  Layers,
  ChevronDown,
  ExternalLink,
  ShieldAlert,
  Loader2,
  FileSpreadsheet,
  Printer
} from 'lucide-react';
import { Badge, BadgeVariant } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';

export default function AuditWorkspacePage({
  params
}: {
  params: Promise<{ id: string }>
}) {
  const { id: sessionId } = use(params);

  const [session, setSession] = useState<any>(null);
  const [findings, setFindings] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeQuestionIndex, setActiveQuestionIndex] = useState(0);

  // Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [reviewFilter, setReviewFilter] = useState('all');

  // Human Review State for active question
  const [isSubmittingReview, setIsSubmittingReview] = useState(false);
  const [humanNotes, setHumanNotes] = useState('');
  const [humanEditedAnswer, setHumanEditedAnswer] = useState('');
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Conflict modal
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [latestSessionId, setLatestSessionId] = useState<string | null>(null);

  const fetchSessionStatus = async () => {
    try {
      const res = await fetch(`/api/audit/${sessionId}/status`);
      if (res.ok) {
        const data = await res.json();
        setSession(data.session);
        setFindings(data.findings || []);
      } else if (res.status === 404) {
        // Stale URL fallback: find latest session so user is never stranded
        const allRes = await fetch('/api/audit');
        if (allRes.ok) {
          const allData = await allRes.json();
          if (allData.sessions?.length > 0) {
            setLatestSessionId(allData.sessions[0].id);
          }
        }
      }
    } catch (err) {
      console.error('Failed to load audit session:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessionStatus();
    // Poll every 3 seconds if in_progress
    const interval = setInterval(() => {
      if (session?.status === 'in_progress') {
        fetchSessionStatus();
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [sessionId, session?.status]);

  // Filtered findings list
  const filteredFindings = findings.filter(f => {
    if (categoryFilter === 'confirmed_error' && f.findings_category !== 'confirmed_error') return false;
    if (categoryFilter === 'multiple_correct' && f.has_multiple_correct !== 1) return false;
    if (categoryFilter === 'ambiguous' && f.findings_category !== 'ambiguous_question') return false;
    if (categoryFilter === 'insufficient_evidence' && f.findings_category !== 'insufficient_evidence') return false;
    if (categoryFilter === 'clean' && f.findings_category !== 'no_detected_issue') return false;

    if (reviewFilter !== 'all' && f.human_review_status !== reviewFilter) return false;

    return true;
  });

  const activeFinding = filteredFindings[activeQuestionIndex] || findings[0];

  useEffect(() => {
    if (activeFinding) {
      setHumanNotes(activeFinding.human_notes || '');
      setHumanEditedAnswer(activeFinding.human_edited_answer || activeFinding.proposed_answer || '');
    }
  }, [activeFinding?.id]);

  const handleReviewDecision = async (status: 'approved' | 'rejected' | 'postponed') => {
    if (!activeFinding) return;

    try {
      setIsSubmittingReview(true);
      const res = await fetch(`/api/audit/${sessionId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          findingId: activeFinding.id,
          status,
          humanNotes,
          humanEditedAnswer: humanEditedAnswer !== activeFinding.proposed_answer ? humanEditedAnswer : undefined
        })
      });

      if (res.ok) {
        // Update local state
        setFindings(prev => prev.map(f => {
          if (f.id === activeFinding.id) {
            return {
              ...f,
              human_review_status: status,
              human_notes: humanNotes,
              human_edited_answer: humanEditedAnswer
            };
          }
          return f;
        }));
      }
    } catch (err) {
      console.error('Review submission error:', err);
    } finally {
      setIsSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <div className="p-24 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-teal-600 mx-auto mb-3" />
        <h2 className="text-base font-bold text-slate-800">Loading Audit Workspace...</h2>
        <p className="text-xs text-slate-500 mt-1">Retrieving evidence-based verification results and textbook citations</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="p-16 text-center space-y-4">
        <h2 className="text-lg font-bold text-slate-800">Audit Session Not Found</h2>
        <p className="text-xs text-slate-500 max-w-md mx-auto">
          This URL references an older or removed audit run.
        </p>
        <div className="flex items-center justify-center gap-3">
          {latestSessionId && (
            <Link
              href={`/audit/${latestSessionId}`}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition"
            >
              <span>Open Latest Audit Session</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
          <Link href="/" className="text-xs font-semibold px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200">
            Return to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-5">
      {/* Top Banner / Session Header */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-xs font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2.5 py-0.5 rounded border border-teal-200">
              {session.ai_provider_used?.toUpperCase() || 'BUILT-IN AUDITOR'}
            </span>
            <Badge variant={session.status === 'completed' ? 'ready' : 'processing'}>
              {session.status.toUpperCase()}
            </Badge>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">{session.exam_title}</h1>
          <p className="text-xs text-slate-500">
            Session: {session.name} &bull; Audited {session.total_questions} Questions against Ingested Medical Textbooks
          </p>
        </div>

        {/* Action buttons (Excel & PDF export) */}
        <div className="flex items-center space-x-2 shrink-0">
          <a
            href={`/api/export/excel?sessionId=${sessionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-200 transition"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
            <span>Export Excel</span>
          </a>

          <a
            href={`/api/export/pdf?sessionId=${sessionId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition"
          >
            <Printer className="h-4 w-4" />
            <span>Printable PDF Report</span>
          </a>
        </div>
      </div>

      {/* Progress Bar (if still in progress) */}
      {session.status === 'in_progress' && (
        <div className="bg-teal-50 border border-teal-200 rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-teal-900">
            <span className="flex items-center space-x-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />
              <span>Auditing in Progress... Analyzing questions against medical reference books</span>
            </span>
            <span>{session.progress_percent}% ({session.current_question_index} of {session.total_questions})</span>
          </div>
          <div className="w-full bg-teal-200/60 rounded-full h-2">
            <div
              className="bg-teal-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${session.progress_percent}%` }}
            />
          </div>
        </div>
      )}

      {/* Filter and Summary Bar */}
      <div className="bg-white p-3.5 rounded-xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Category Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => { setCategoryFilter('all'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition ${
              categoryFilter === 'all'
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            All Questions ({findings.length})
          </button>
          <button
            type="button"
            onClick={() => { setCategoryFilter('confirmed_error'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center space-x-1 ${
              categoryFilter === 'confirmed_error'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
            }`}
          >
            <span>Confirmed Errors</span>
            <span className="font-bold">({session.confirmed_errors_count || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setCategoryFilter('multiple_correct'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center space-x-1 ${
              categoryFilter === 'multiple_correct'
                ? 'bg-purple-600 text-white'
                : 'bg-purple-50 text-purple-700 hover:bg-purple-100 border border-purple-200'
            }`}
          >
            <span>Multiple Correct</span>
            <span className="font-bold">({session.multiple_correct_count || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setCategoryFilter('ambiguous'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center space-x-1 ${
              categoryFilter === 'ambiguous'
                ? 'bg-sky-600 text-white'
                : 'bg-sky-50 text-sky-700 hover:bg-sky-100 border border-sky-200'
            }`}
          >
            <span>Ambiguous</span>
            <span className="font-bold">({session.ambiguous_count || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setCategoryFilter('insufficient_evidence'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center space-x-1 ${
              categoryFilter === 'insufficient_evidence'
                ? 'bg-amber-600 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
            }`}
          >
            <span>Insufficient Evidence</span>
            <span className="font-bold">({session.insufficient_evidence_count || 0})</span>
          </button>
          <button
            type="button"
            onClick={() => { setCategoryFilter('clean'); setActiveQuestionIndex(0); }}
            className={`px-3 py-1.5 rounded-lg font-semibold transition flex items-center space-x-1 ${
              categoryFilter === 'clean'
                ? 'bg-emerald-600 text-white'
                : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
            }`}
          >
            <span>Verified / Clean</span>
            <span className="font-bold">({findings.filter(f => f.findings_category === 'no_detected_issue').length})</span>
          </button>
        </div>

        {/* Review Filter */}
        <div className="flex items-center space-x-2">
          <span className="text-slate-400 font-medium">Review Status:</span>
          <select
            value={reviewFilter}
            onChange={(e) => { setReviewFilter(e.target.value); setActiveQuestionIndex(0); }}
            className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg bg-slate-50 focus:outline-none"
          >
            <option value="all">All Statuses</option>
            <option value="pending">Pending Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="postponed">Postponed</option>
          </select>
        </div>
      </div>

      {/* Main Workspace Layout */}
      {filteredFindings.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-xs text-slate-500">
          No questions match the selected filter criteria.
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Question Navigator */}
          <div className="lg:col-span-3 bg-white rounded-xl border border-slate-200 p-3 shadow-sm space-y-2 max-h-[750px] overflow-y-auto">
            <div className="px-2 py-1 text-xs font-bold text-slate-400 uppercase tracking-wider">
              Questions ({filteredFindings.length})
            </div>

            <div className="space-y-1">
              {filteredFindings.map((finding, idx) => {
                let badgeColor = 'bg-slate-100 text-slate-700';
                if (finding.findings_category === 'confirmed_error') badgeColor = 'bg-rose-100 text-rose-800';
                else if (finding.has_multiple_correct === 1) badgeColor = 'bg-purple-100 text-purple-800';
                else if (finding.findings_category === 'ambiguous_question') badgeColor = 'bg-sky-100 text-sky-800';
                else if (finding.findings_category === 'insufficient_evidence') badgeColor = 'bg-amber-100 text-amber-800';
                else if (finding.findings_category === 'no_detected_issue') badgeColor = 'bg-emerald-100 text-emerald-800';

                return (
                  <button
                    key={finding.id}
                    type="button"
                    onClick={() => setActiveQuestionIndex(idx)}
                    className={`w-full text-left p-2.5 rounded-lg text-xs transition flex items-center justify-between ${
                      activeQuestionIndex === idx
                        ? 'bg-teal-50 border border-teal-500 shadow-sm'
                        : 'hover:bg-slate-50 border border-transparent'
                    }`}
                  >
                    <div>
                      <div className="font-bold text-slate-900">
                        Q{finding.question_number}. {finding.detected_primary_subject || 'Medical Science'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate max-w-[170px]">
                        {finding.topic || finding.stem.slice(0, 30)}
                      </div>
                    </div>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${badgeColor}`}>
                      {finding.has_multiple_correct === 1
                        ? 'MULTI'
                        : finding.findings_category === 'confirmed_error'
                        ? 'ERR'
                        : finding.findings_category === 'insufficient_evidence'
                        ? 'INSUFF'
                        : finding.findings_category === 'ambiguous_question'
                        ? 'AMBIG'
                        : 'OK'}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Detailed Question Inspection & Evidence Card */}
          <div className="lg:col-span-9 space-y-5">
            {activeFinding && (
              <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6">
                {/* Question Header */}
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div className="flex items-center space-x-3">
                    <span className="text-base font-extrabold text-slate-900">
                      Question {activeFinding.question_number}
                    </span>
                    <Badge variant={activeFinding.findings_category as BadgeVariant}>
                      {activeFinding.findings_category.replace(/_/g, ' ').toUpperCase()}
                    </Badge>
                    <span className="text-xs font-bold text-teal-800 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      {activeFinding.detected_primary_subject || 'General Medical Science'}
                    </span>
                  </div>

                  <div className="flex items-center space-x-3 text-xs">
                    <span className="text-slate-500">
                      Severity: <strong className="uppercase text-slate-800">{activeFinding.error_severity}</strong>
                    </span>
                    <span className="text-slate-500">
                      Evidence Confidence: <strong className="text-teal-700">{activeFinding.confidence_score}%</strong>
                    </span>
                  </div>
                </div>

                {/* Question Stem */}
                <div className="space-y-2">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Original Question Stem:
                  </div>
                  <p className="text-base font-medium text-slate-900 leading-relaxed bg-slate-50 p-4 rounded-lg border border-slate-200/80">
                    {activeFinding.stem}
                  </p>

                  {activeFinding.image_path && (
                    <div className="bg-white border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-sm">
                      <div className="text-xs font-bold uppercase tracking-wider text-teal-800">
                        Attached Question Figure / Visual Evidence
                      </div>
                      {activeFinding.image_path.toLowerCase().endsWith('.pdf') ? (
                        <iframe
                          src={`/api/questions/${activeFinding.question_id}/image#toolbar=0&view=FitH`}
                          title={`Question ${activeFinding.question_number} figure PDF`}
                          className="w-full h-80 rounded-lg border border-slate-200 bg-white"
                        />
                      ) : (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={`/api/questions/${activeFinding.question_id}/image`}
                          alt={`Question ${activeFinding.question_number} figure`}
                          className="max-h-80 w-auto rounded-lg border border-slate-200 object-contain"
                        />
                      )}
                      {activeFinding.image_description && (
                        <p className="text-xs text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-100 leading-relaxed">
                          <strong className="text-slate-700">Visual Figure Analysis:</strong> {activeFinding.image_description}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Proposed Stem Correction if stem had errors */}
                  {activeFinding.proposed_stem && (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900 space-y-1">
                      <div className="font-bold flex items-center space-x-1.5 text-amber-800">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span>Question Stem Correction Proposed:</span>
                      </div>
                      <p className="font-medium">{activeFinding.proposed_stem}</p>
                      <p className="text-amber-700 text-[11px] mt-1">{activeFinding.stem_evaluation}</p>
                    </div>
                  )}
                </div>

                {/* Answer Key Comparison Callout */}
                {activeFinding.options && activeFinding.options.length > 0 ? (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                      <div>
                        <div className="text-xs font-bold text-slate-500 uppercase">Designated Answer Key (Audited)</div>
                        <div className="mt-1 text-lg font-black text-slate-800">
                          {activeFinding.original_designated_answer
                            ? `Option ${activeFinding.original_designated_answer}`
                            : 'Not Specified in Exam'}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs font-bold text-teal-700 uppercase">Audited Correct Answer(s)</div>
                        <div className="mt-1 text-lg font-black text-teal-700 flex items-center space-x-2">
                          <span>
                            {activeFinding.proposed_answer
                              ? `Option ${activeFinding.proposed_answer}`
                              : activeFinding.findings_category === 'insufficient_evidence'
                              ? 'Insufficient Textbook Coverage'
                              : 'No Valid Option'}
                          </span>
                          {activeFinding.has_multiple_correct === 1 && (
                            <span className="text-xs bg-purple-100 text-purple-800 px-2 py-0.5 rounded font-bold border border-purple-200">
                              MULTIPLE CORRECT
                            </span>
                          )}
                          {activeFinding.has_no_correct === 1 && (
                            <span className="text-xs bg-rose-100 text-rose-800 px-2 py-0.5 rounded font-bold border border-rose-200">
                              NO CORRECT ANSWER
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Option-by-Option Scientific Analysis Cards */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                        Individual Answer Choice Verification (Audited Separately):
                      </div>

                      <div className="space-y-2.5">
                        {activeFinding.options.map((opt: any) => {
                          const analysis = activeFinding.optionAnalyses?.find((o: any) => o.option_letter === opt.label);
                          const isProposed = (activeFinding.proposed_answer || '').split(/[\s,]+/).includes(opt.label);
                          const isOriginal = (activeFinding.original_designated_answer || '').split(/[\s,]+/).includes(opt.label);

                          return (
                            <div
                              key={opt.label}
                              className={`p-3.5 rounded-lg border transition ${
                                isProposed
                                  ? 'bg-emerald-50/50 border-emerald-300 ring-1 ring-emerald-300'
                                  : isOriginal && !isProposed
                                  ? 'bg-rose-50/40 border-rose-300'
                                  : 'bg-white border-slate-200'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start space-x-2.5">
                                  <span className={`font-black text-sm px-2 py-0.5 rounded ${
                                    isProposed
                                      ? 'bg-emerald-600 text-white'
                                      : isOriginal && !isProposed
                                      ? 'bg-rose-600 text-white'
                                      : 'bg-slate-100 text-slate-700'
                                  }`}>
                                    {opt.label}
                                  </span>
                                  <div>
                                    <span className="text-sm font-semibold text-slate-900">{opt.text}</span>
                                    {(analysis?.evaluation_rationale || analysis?.explanation) && (
                                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                                        {analysis.evaluation_rationale || analysis.explanation}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                <div className="text-right shrink-0">
                                  {analysis?.is_scientifically_correct === 1 ? (
                                    <span className="inline-flex items-center text-xs font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">
                                      CORRECT
                                    </span>
                                  ) : isOriginal ? (
                                    <span className="inline-flex items-center text-xs font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded">
                                      INCORRECT KEY
                                    </span>
                                  ) : (
                                    <span className="text-xs text-slate-400 font-medium">INCORRECT</span>
                                  )}
                                </div>
                              </div>

                              {/* Specific citation for this option */}
                              {analysis?.citation_quote && analysis.citation_reference_name !== 'None' && (
                                <div className="mt-2.5 pt-2 border-t border-slate-200/60 text-[11px] text-slate-500 flex items-center justify-between">
                                  <span>
                                    Cited in: <strong>{analysis.citation_reference_name}</strong> &bull; Printed Page: <strong>{analysis.citation_printed_page}</strong> (PDF Page {analysis.citation_pdf_page})
                                  </span>
                                  <span className="italic text-slate-400 max-w-xs truncate">
                                    &quot;{analysis.citation_quote}&quot;
                                  </span>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600 flex items-center justify-between">
                    <div>
                      <div className="font-bold text-slate-800 uppercase tracking-wide text-[11px]">
                        Written / Short-Answer Question
                      </div>
                      <p className="mt-0.5">
                        Evaluated for scientific stem accuracy and textbook alignment without multiple-choice options.
                      </p>
                    </div>
                    {activeFinding.proposed_answer && (
                      <span className="font-bold text-teal-700 bg-teal-50 px-2.5 py-1 rounded border border-teal-200">
                        {activeFinding.proposed_answer}
                      </span>
                    )}
                  </div>
                )}

                {/* Evidence Citations & Quotes */}
                {activeFinding.citations && activeFinding.citations.length > 0 && (
                  <div className="space-y-3 pt-2">
                    <div className="text-xs font-bold uppercase tracking-wider text-teal-800 flex items-center space-x-1.5">
                      <BookOpen className="h-4 w-4" />
                      <span>Traceable Textbook Evidence Citations (Ground Truth Excerpts):</span>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {activeFinding.citations.map((cite: any, i: number) => (
                        <div key={i} className="p-3 bg-slate-50 border-l-4 border-teal-600 rounded-r-lg text-xs space-y-1">
                          <div className="flex items-center justify-between font-bold text-slate-800">
                            <span>{cite.reference_book_name}</span>
                            <span className="text-teal-700 font-semibold">
                              Printed Page: {cite.printed_page_number} (PDF Index {cite.pdf_page_index})
                            </span>
                          </div>
                          <p className="text-slate-700 font-mono text-[11px] leading-relaxed bg-white p-2 rounded border border-slate-200">
                            &quot;{cite.statement_quote}&quot;
                          </p>
                          <p className="text-slate-500 text-[11px]">{cite.support_explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Cross-Reference Conflict Alert (if any) */}
                {activeFinding.has_conflicting_references === 1 && (
                  <div className="p-4 bg-purple-50 border border-purple-200 rounded-xl space-y-2 text-xs">
                    <div className="flex items-center justify-between font-bold text-purple-900">
                      <div className="flex items-center space-x-1.5">
                        <AlertTriangle className="h-4 w-4 text-purple-700" />
                        <span>Conflicting Statements Detected Across Ingested References</span>
                      </div>
                      <span className="text-[11px] uppercase bg-purple-200/80 text-purple-900 px-2 py-0.5 rounded font-bold">
                        Conflict Documented
                      </span>
                    </div>
                    <p className="text-purple-800 leading-relaxed">
                      {activeFinding.conflict_explanation}
                    </p>
                  </div>
                )}

                {/* Human Review & Faculty Correction Controls */}
                <div className="pt-4 border-t border-slate-200 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Faculty Review & Correction Management:
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Current Status: <strong className="uppercase text-slate-800">{activeFinding.human_review_status}</strong>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        disabled={isSubmittingReview}
                        onClick={() => handleReviewDecision('approved')}
                        className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition ${
                          activeFinding.human_review_status === 'approved'
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                        }`}
                      >
                        <Check className="h-3.5 w-3.5" />
                        <span>Approve Audit</span>
                      </button>

                      <button
                        type="button"
                        disabled={isSubmittingReview}
                        onClick={() => handleReviewDecision('rejected')}
                        className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-3.5 py-2 rounded-lg transition ${
                          activeFinding.human_review_status === 'rejected'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : 'bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200'
                        }`}
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Reject Correction</span>
                      </button>

                      <button
                        type="button"
                        disabled={isSubmittingReview}
                        onClick={() => handleReviewDecision('postponed')}
                        className={`inline-flex items-center space-x-1.5 text-xs font-semibold px-3 py-2 rounded-lg transition ${
                          activeFinding.human_review_status === 'postponed'
                            ? 'bg-slate-800 text-white shadow-sm'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200'
                        }`}
                      >
                        <Clock className="h-3.5 w-3.5" />
                        <span>Postpone</span>
                      </button>
                    </div>
                  </div>

                  {/* Faculty Notes input */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">
                      Faculty / Board Reviewer Notes:
                    </label>
                    <textarea
                      rows={2}
                      value={humanNotes}
                      onChange={(e) => setHumanNotes(e.target.value)}
                      placeholder="Add clinical explanation or editorial notes regarding this question audit..."
                      className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
                    />
                  </div>
                </div>

                {/* Bottom Navigation Buttons */}
                <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                  <button
                    type="button"
                    disabled={activeQuestionIndex <= 0}
                    onClick={() => setActiveQuestionIndex(prev => Math.max(0, prev - 1))}
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-700 transition disabled:opacity-40"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" />
                    <span>Previous Question</span>
                  </button>

                  <span className="text-xs text-slate-400 font-medium">
                    Question {activeQuestionIndex + 1} of {filteredFindings.length}
                  </span>

                  <button
                    type="button"
                    disabled={activeQuestionIndex >= filteredFindings.length - 1}
                    onClick={() => setActiveQuestionIndex(prev => Math.min(filteredFindings.length - 1, prev + 1))}
                    className="inline-flex items-center space-x-1.5 text-xs font-semibold px-4 py-2 rounded-lg bg-teal-600 hover:bg-teal-700 text-white transition disabled:opacity-40"
                  >
                    <span>Next Question</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
