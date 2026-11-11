'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Sparkles,
  BookOpen,
  FileText,
  CheckCircle2,
  Cpu,
  ArrowRight,
  Loader2,
  ShieldCheck
} from 'lucide-react';

function NewAuditForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const defaultExamId = searchParams.get('examId') || '';

  const [examinations, setExaminations] = useState<any[]>([]);
  const [references, setReferences] = useState<any[]>([]);
  const [selectedExamId, setSelectedExamId] = useState(defaultExamId);
  const [selectedRefIds, setSelectedRefIds] = useState<string[]>([]);
  const [sessionName, setSessionName] = useState('');
  const [aiProvider, setAiProvider] = useState('built_in');
  const [loading, setLoading] = useState(true);
  const [isLaunching, setIsLaunching] = useState(false);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        const [examsRes, refsRes, settingsRes] = await Promise.all([
          fetch('/api/examinations'),
          fetch('/api/references'),
          fetch('/api/settings')
        ]);

        if (examsRes.ok) {
          const eData = await examsRes.json();
          setExaminations(eData.examinations || []);
          if (!selectedExamId && eData.examinations?.length > 0) {
            setSelectedExamId(eData.examinations[0].id);
          }
        }

        if (refsRes.ok) {
          const rData = await refsRes.json();
          const readyBooks = (rData.references || []).filter((r: any) => r.status === 'ready');
          setReferences(readyBooks);
          // By default select all ready reference books
          setSelectedRefIds(readyBooks.map((r: any) => r.id));
        }

        if (settingsRes.ok) {
          const sData = await settingsRes.json();
          if (sData.settings?.ai_provider) {
            setAiProvider(sData.settings.ai_provider);
          }
        }
      } catch (err) {
        console.error('Failed to load audit config data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, []);

  const handleToggleRef = (id: string) => {
    setSelectedRefIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const handleSelectAllRefs = () => {
    if (selectedRefIds.length === references.length) {
      setSelectedRefIds([]);
    } else {
      setSelectedRefIds(references.map(r => r.id));
    }
  };

  const handleLaunch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedExamId) return;

    try {
      setIsLaunching(true);
      const res = await fetch('/api/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          examinationId: selectedExamId,
          name: sessionName,
          selectedReferenceIds: selectedRefIds,
          aiProvider
        })
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/audit/${data.sessionId}`);
      } else {
        const err = await res.json();
        alert(`Audit initialization failed: ${err.error || 'Server error'}`);
      }
    } catch (err: any) {
      alert(`Error launching audit: ${err.message}`);
    } finally {
      setIsLaunching(false);
    }
  };

  const selectedExam = examinations.find(e => e.id === selectedExamId);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
          <Sparkles className="h-6 w-6 text-teal-600" />
          <span>Launch Scientific Question Audit</span>
        </h1>
        <p className="text-sm text-slate-500 mt-1">
          Configure an automated audit session to verify question stems, answer keys, choices, and multiple correct options.
        </p>
      </div>

      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Preparing audit configuration...</p>
        </div>
      ) : examinations.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">No Examinations Available</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Please upload an examination PDF first, or click &quot;Load Representative Test Suite&quot; in the header.
          </p>
        </div>
      ) : (
        <form onSubmit={handleLaunch} className="space-y-6">
          {/* STEP 1: SELECT EXAMINATION */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 text-teal-800 text-xs font-bold">1</span>
              <span>Select Examination to Audit</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {examinations.map((exam) => (
                <label
                  key={exam.id}
                  className={`flex items-start justify-between p-4 rounded-lg border cursor-pointer transition ${
                    selectedExamId === exam.id
                      ? 'bg-teal-50/50 border-teal-500 ring-1 ring-teal-500'
                      : 'hover:bg-slate-50 border-slate-200'
                  }`}
                >
                  <div className="flex items-start space-x-3">
                    <input
                      type="radio"
                      name="exam"
                      value={exam.id}
                      checked={selectedExamId === exam.id}
                      onChange={() => setSelectedExamId(exam.id)}
                      className="mt-1 h-4 w-4 text-teal-600 focus:ring-teal-500 border-slate-300"
                    />
                    <div>
                      <div className="text-sm font-bold text-slate-900">{exam.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {exam.question_count} Questions &bull; Uploaded {new Date(exam.created_at).toLocaleDateString()}
                      </div>
                      {exam.detected_subject_summary && (
                        <div className="text-[11px] text-teal-700 font-medium mt-1">
                          Subjects: {exam.detected_subject_summary}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-slate-600">
                    {exam.question_count} Qs
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* STEP 2: SELECT REFERENCE TEXTBOOKS */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 text-teal-800 text-xs font-bold">2</span>
                <span>Exclusive Reference Evidence Sources ({selectedRefIds.length} of {references.length} selected)</span>
              </div>
              <button
                type="button"
                onClick={handleSelectAllRefs}
                className="text-xs font-semibold text-teal-600 hover:text-teal-700"
              >
                {selectedRefIds.length === references.length ? 'Deselect All' : 'Select All Ready Books'}
              </button>
            </div>

            {references.length === 0 ? (
              <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
                No reference books are indexed yet. The system requires at least one reference book as evidence ground truth. Please upload textbooks or click &quot;Load Representative Test Suite&quot;.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-60 overflow-y-auto pr-1">
                {references.map((ref) => (
                  <label
                    key={ref.id}
                    className={`flex items-start space-x-3 p-3 rounded-lg border cursor-pointer transition text-xs ${
                      selectedRefIds.includes(ref.id)
                        ? 'bg-teal-50/40 border-teal-500'
                        : 'hover:bg-slate-50 border-slate-200 opacity-70'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedRefIds.includes(ref.id)}
                      onChange={() => handleToggleRef(ref.id)}
                      className="mt-0.5 h-3.5 w-3.5 text-teal-600 focus:ring-teal-500 border-slate-300 rounded"
                    />
                    <div className="min-w-0">
                      <div className="font-bold text-slate-800 truncate">{ref.title}</div>
                      <div className="text-[11px] text-teal-700 font-medium">{ref.subject || 'Medical Science'}</div>
                      <div className="text-[10px] text-slate-400">{ref.page_count} pages indexed</div>
                    </div>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* STEP 3: CONFIGURE AUDIT ENGINE & NAME */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center space-x-2 text-sm font-bold text-slate-900">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-teal-100 text-teal-800 text-xs font-bold">3</span>
              <span>Verification Engine & Session Details</span>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Audit Session Name (Optional)
              </label>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder={`Audit: ${selectedExam?.title || 'Comprehensive Medical Examination'}`}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                AI Knowledge Processing Engine
              </label>
              <select
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
              >
                <option value="built_in">Built-in Deterministic Medical Auditor (Instant, Zero External API Dependency)</option>
                <option value="gemini">Google Gemini API (Gemini 3.5 Flash / 3.1 Flash Lite)</option>
                <option value="openai">OpenAI API (GPT-4o / GPT-4o-mini)</option>
                <option value="anthropic">Anthropic API (Claude 3.5 Sonnet)</option>
              </select>
              <p className="text-[11px] text-slate-400 mt-1">
                Configure external API credentials anytime in Settings. If API keys are not entered, the Built-in Deterministic Auditor automatically verifies questions against ingested books.
              </p>
            </div>
          </div>

          {/* MANDATORY INTEGRITY CALLOUT */}
          <div className="bg-slate-900 text-slate-200 p-4 rounded-xl flex items-start space-x-3 text-xs">
            <ShieldCheck className="h-5 w-5 text-teal-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-bold text-white">Active Scientific Rigor Verification:</div>
              <p className="text-slate-400 leading-relaxed">
                The engine will evaluate every option independently, verify question stems for scientific accuracy, detect multiple correct answers, flag missing correct answers, and attach exact book citations and page numbers.
              </p>
            </div>
          </div>

          {/* SUBMIT BUTTON */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={isLaunching || !selectedExamId || selectedRefIds.length === 0}
              className="inline-flex items-center space-x-2 text-sm font-semibold bg-teal-600 hover:bg-teal-700 text-white px-6 py-3 rounded-lg shadow-sm transition disabled:opacity-50"
            >
              {isLaunching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Initializing Scientific Audit...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Start Evidence-Based Audit</span>
                  <ArrowRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default function NewAuditPage() {
  return (
    <Suspense fallback={
      <div className="p-16 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto mb-2" />
        <p className="text-xs text-slate-500">Loading audit setup...</p>
      </div>
    }>
      <NewAuditForm />
    </Suspense>
  );
}
