'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  FileText,
  Upload,
  Sparkles,
  Trash2,
  ChevronRight,
  Eye,
  CheckCircle2,
  Clock,
  Loader2
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';

export default function ExaminationLibraryPage() {
  const [examinations, setExaminations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Preview Questions modal
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewExam, setPreviewExam] = useState<any>(null);
  const [previewQuestions, setPreviewQuestions] = useState<any[]>([]);
  const [loadingQuestions, setLoadingQuestions] = useState(false);

  const fetchExaminations = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/examinations');
      if (res.ok) {
        const data = await res.json();
        setExaminations(data.examinations || []);
      }
    } catch (err) {
      console.error('Failed to load examinations:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchExaminations();
  }, []);

  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    try {
      setIsUploading(true);
      setUploadProgress('Uploading examination PDF...');

      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('type', 'examination');
      formData.append('title', uploadTitle || uploadFile.name.replace(/\.pdf$/i, ''));

      setUploadProgress('Extracting questions, stems, choices, and answer keys...');
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        setIsUploadOpen(false);
        setUploadFile(null);
        setUploadTitle('');
        fetchExaminations();
      } else {
        const errData = await res.json();
        alert(`Upload failed: ${errData.error || 'Server error'}`);
      }
    } catch (err: any) {
      alert(`Upload error: ${err.message}`);
    } finally {
      setIsUploading(false);
      setUploadProgress('');
    }
  };

  const openPreview = async (exam: any) => {
    setPreviewExam(exam);
    setIsPreviewOpen(true);
    setLoadingQuestions(true);

    try {
      const res = await fetch(`/api/examinations?id=${exam.id}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewQuestions(data.questions || []);
      }
    } catch (err) {
      console.error('Failed to load questions:', err);
    } finally {
      setLoadingQuestions(false);
    }
  };

  const handleDeleteExam = async (examId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete examination "${title}"?`)) return;

    try {
      const res = await fetch(`/api/examinations?id=${examId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchExaminations();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <FileText className="h-6 w-6 text-teal-600" />
            <span>Examination Library</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Uploaded examination papers and question sets awaiting or undergoing evidence-based verification.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsUploadOpen(true)}
          className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition self-start sm:self-auto"
        >
          <Upload className="h-4 w-4" />
          <span>Upload Examination PDF</span>
        </button>
      </div>

      {/* Exam List */}
      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading examinations...</p>
        </div>
      ) : examinations.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <FileText className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">No Examinations Uploaded</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Upload an examination PDF or click &quot;Load Representative Test Suite&quot; in the header to populate sample clinical examinations.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-teal-600 text-white px-3.5 py-2 rounded-lg hover:bg-teal-700 transition"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload Examination</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-[11px] font-bold uppercase text-slate-500 tracking-wider border-b border-slate-200">
              <tr>
                <th className="px-6 py-3.5">Examination Title</th>
                <th className="px-4 py-3.5">Questions</th>
                <th className="px-4 py-3.5">Status</th>
                <th className="px-4 py-3.5">Uploaded Date</th>
                <th className="px-6 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {examinations.map((exam) => (
                <tr key={exam.id} className="hover:bg-slate-50/70 transition">
                  <td className="px-6 py-4 font-semibold text-slate-900">
                    <div>{exam.title}</div>
                    {exam.detected_subject_summary && (
                      <div className="text-xs text-slate-400 font-normal mt-0.5">
                        Subjects: {exam.detected_subject_summary}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4 text-slate-700 font-medium">
                    {exam.question_count} Questions
                  </td>
                  <td className="px-4 py-4">
                    <Badge variant={exam.latest_session_status === 'completed' ? 'ready' : 'info'}>
                      {exam.latest_session_status ? `Audited (${exam.latest_session_status})` : 'Ready to Audit'}
                    </Badge>
                  </td>
                  <td className="px-4 py-4 text-xs text-slate-500">
                    {new Date(exam.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      type="button"
                      onClick={() => openPreview(exam)}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 bg-slate-50 px-2.5 py-1.5 rounded-lg border border-slate-200"
                    >
                      <Eye className="h-3 w-3" />
                      <span>Preview</span>
                    </button>

                    <Link
                      href={`/audit/new?examId=${exam.id}`}
                      className="inline-flex items-center space-x-1 text-xs font-semibold text-teal-600 hover:text-teal-700 bg-teal-50 px-2.5 py-1.5 rounded-lg border border-teal-200"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Audit</span>
                    </Link>

                    <button
                      type="button"
                      onClick={() => handleDeleteExam(exam.id, exam.title)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                      title="Delete Examination"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* UPLOAD EXAM MODAL */}
      <Dialog
        isOpen={isUploadOpen}
        onClose={() => { if (!isUploading) setIsUploadOpen(false); }}
        title="Upload Examination Question File (PDF)"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Examination PDF
            </label>
            <input
              type="file"
              accept=".pdf"
              required
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setUploadFile(f);
                if (f && !uploadTitle) {
                  setUploadTitle(f.name.replace(/\.pdf$/i, ''));
                }
              }}
              className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 cursor-pointer"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Examination Title
            </label>
            <input
              type="text"
              required
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g. USMLE Step 1 Clinical Mock Examination"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-700 flex items-center space-x-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />
              <span>Automated Extraction Engine:</span>
            </div>
            <p>
              The system will automatically parse individual question numbers, complete question stems, answer options (A, B, C, D, E), and designated answer keys.
            </p>
          </div>

          {isUploading && (
            <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg flex items-center space-x-3 text-xs text-teal-800">
              <Loader2 className="h-4 w-4 animate-spin shrink-0 text-teal-600" />
              <span>{uploadProgress}</span>
            </div>
          )}

          <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              disabled={isUploading}
              onClick={() => setIsUploadOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isUploading}
              className="px-4 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition disabled:opacity-50"
            >
              {isUploading ? 'Parsing Questions...' : 'Upload & Extract'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* PREVIEW QUESTIONS MODAL */}
      <Dialog
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        title={`Questions Preview: ${previewExam?.title || ''}`}
        maxWidth="max-w-4xl"
      >
        {loadingQuestions ? (
          <div className="text-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-teal-600 mx-auto mb-2" />
            <p className="text-xs text-slate-500">Loading extracted questions...</p>
          </div>
        ) : (
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
            {previewQuestions.map((q) => {
              let opts = [];
              try { opts = JSON.parse(q.options_json); } catch {}

              return (
                <div key={q.id} className="p-4 border border-slate-200 rounded-lg bg-slate-50/50 space-y-2">
                  <div className="flex items-center justify-between text-xs font-bold text-slate-700">
                    <span>Question {q.question_number}</span>
                    <span className="text-teal-700 bg-teal-50 px-2 py-0.5 rounded border border-teal-200">
                      Designated Key: {q.designated_answer || 'None provided'}
                    </span>
                  </div>
                  <p className="text-sm text-slate-800">{q.stem}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-xs">
                    {opts.map((opt: any) => (
                      <div
                        key={opt.label}
                        className={`p-2 rounded border ${
                          q.designated_answer === opt.label
                            ? 'bg-emerald-50 border-emerald-200 font-semibold text-emerald-900'
                            : 'bg-white border-slate-200 text-slate-700'
                        }`}
                      >
                        <strong>{opt.label})</strong> {opt.text}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Dialog>
    </div>
  );
}
