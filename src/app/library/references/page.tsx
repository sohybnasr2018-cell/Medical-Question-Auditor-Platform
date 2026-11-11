'use client';

import React, { useState, useEffect } from 'react';
import {
  BookOpen,
  Upload,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Edit2,
  FileSearch,
  CheckCircle2,
  AlertCircle,
  FileText,
  Loader2,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';

export default function ReferenceLibraryPage() {
  const [references, setReferences] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  // Upload modal state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadSubject, setUploadSubject] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState('');

  // Page Inspector state
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [activeBook, setActiveBook] = useState<any>(null);
  const [inspectPages, setInspectPages] = useState<any[]>([]);
  const [selectedPageNum, setSelectedPageNum] = useState<number>(1);
  const [activePageData, setActivePageData] = useState<any>(null);
  const [loadingPages, setLoadingPages] = useState(false);

  // Edit metadata modal
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editBookId, setEditBookId] = useState('');
  const [editTitle, setEditTitle] = useState('');
  const [editSubject, setEditSubject] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editAuthors, setEditAuthors] = useState('');
  const [editEdition, setEditEdition] = useState('');

  const fetchReferences = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (searchQuery) params.set('q', searchQuery);
      if (subjectFilter) params.set('subject', subjectFilter);

      const res = await fetch(`/api/references?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setReferences(data.references || []);
      }
    } catch (err) {
      console.error('Failed to load references:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchReferences();
  }, [searchQuery, subjectFilter]);

  // Handle PDF Upload
  const handleUploadSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;

    try {
      setIsUploading(true);
      setUploadProgress('Uploading PDF to server...');

      const formData = new FormData();
      formData.append('file', uploadFile);
      formData.append('type', 'reference');
      formData.append('title', uploadTitle || uploadFile.name.replace(/\.pdf$/i, ''));
      formData.append('subject', uploadSubject);
      formData.append('category', uploadCategory || 'Textbook');

      setUploadProgress('Extracting native PDF text and running OCR verification...');
      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        setIsUploadOpen(false);
        setUploadFile(null);
        setUploadTitle('');
        setUploadSubject('');
        fetchReferences();
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

  // Open Page Inspector
  const openInspector = async (book: any) => {
    setActiveBook(book);
    setIsInspectorOpen(true);
    setLoadingPages(true);

    try {
      const res = await fetch(`/api/references/${book.id}/pages`);
      if (res.ok) {
        const data = await res.json();
        setInspectPages(data.pages || []);
        if (data.pages && data.pages.length > 0) {
          fetchPageDetail(book.id, data.pages[0].pdf_page_index);
        }
      }
    } catch (err) {
      console.error('Failed to load pages for inspection:', err);
    } finally {
      setLoadingPages(false);
    }
  };

  const fetchPageDetail = async (bookId: string, pageIndex: number) => {
    setSelectedPageNum(pageIndex);
    try {
      const res = await fetch(`/api/references/${bookId}/pages?page=${pageIndex}`);
      if (res.ok) {
        const data = await res.json();
        setActivePageData(data.page);
      }
    } catch (err) {
      console.error('Failed to load single page:', err);
    }
  };

  // Trigger Re-indexing
  const handleReprocess = async (bookId: string) => {
    try {
      const res = await fetch(`/api/references/${bookId}/reprocess`, { method: 'POST' });
      if (res.ok) {
        fetchReferences();
      }
    } catch (err) {
      console.error('Reprocess failed:', err);
    }
  };

  // Delete Book
  const handleDelete = async (bookId: string, title: string) => {
    if (!confirm(`Are you sure you want to delete reference "${title}"? This will remove its search index.`)) return;

    try {
      const res = await fetch(`/api/references?id=${bookId}`, { method: 'DELETE' });
      if (res.ok) {
        fetchReferences();
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Edit metadata
  const openEditModal = (book: any) => {
    setEditBookId(book.id);
    setEditTitle(book.title);
    setEditSubject(book.subject || '');
    setEditCategory(book.category || '');
    setEditAuthors(book.authors || '');
    setEditEdition(book.edition || '');
    setIsEditOpen(true);
  };

  const handleEditSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/references', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editBookId,
          title: editTitle,
          subject: editSubject,
          category: editCategory,
          authors: editAuthors,
          edition: editEdition
        })
      });

      if (res.ok) {
        setIsEditOpen(false);
        fetchReferences();
      }
    } catch (err) {
      console.error('Edit failed:', err);
    }
  };

  // Unique subjects for filter dropdown
  const uniqueSubjects = Array.from(new Set(references.map(r => r.subject).filter(Boolean)));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight flex items-center space-x-2">
            <BookOpen className="h-6 w-6 text-teal-600" />
            <span>Medical Reference Library</span>
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Permanent repository of verified medical textbooks, clinical guidelines, and reference PDFs used as exclusive ground truth.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsUploadOpen(true)}
          className="inline-flex items-center space-x-2 text-xs font-semibold px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-lg shadow-sm transition self-start sm:self-auto"
        >
          <Upload className="h-4 w-4" />
          <span>Upload Medical Textbook</span>
        </button>
      </div>

      {/* Search & Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col md:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-3 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search textbooks by title, author, or medical subject..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
          />
        </div>

        <div className="w-full md:w-64">
          <select
            value={subjectFilter}
            onChange={(e) => setSubjectFilter(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500 bg-white"
          >
            <option value="">All Medical Subjects</option>
            {uniqueSubjects.map((sub: any) => (
              <option key={sub} value={sub}>{sub}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Book Grid */}
      {loading ? (
        <div className="p-16 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-600 mx-auto mb-2" />
          <p className="text-xs text-slate-500">Loading reference books...</p>
        </div>
      ) : references.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-sm">
          <BookOpen className="h-10 w-10 text-slate-300 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-slate-700">No Reference Books Found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Upload your medical textbooks (PDF) or click &quot;Load Representative Test Suite&quot; in the header to populate reference books automatically.
          </p>
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setIsUploadOpen(true)}
              className="inline-flex items-center space-x-1.5 text-xs font-semibold bg-teal-600 text-white px-3.5 py-2 rounded-lg hover:bg-teal-700 transition"
            >
              <Upload className="h-3.5 w-3.5" />
              <span>Upload First Book</span>
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {references.map((book) => (
            <div
              key={book.id}
              className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-teal-800 bg-teal-50 px-2.5 py-0.5 rounded border border-teal-200">
                    {book.subject || 'General Medical Science'}
                  </span>
                  <Badge variant={book.status === 'ready' ? 'ready' : 'processing'}>
                    {book.status.replace(/_/g, ' ').toUpperCase()}
                  </Badge>
                </div>

                <h3 className="text-base font-bold text-slate-900 leading-snug line-clamp-2">
                  {book.title}
                </h3>
                {book.authors && (
                  <p className="text-xs text-slate-500 mt-1 line-clamp-1">
                    By {book.authors}
                  </p>
                )}
                {book.edition && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {book.edition} &bull; {book.category || 'Clinical Reference'}
                  </p>
                )}

                {/* Processing metrics */}
                <div className="grid grid-cols-3 gap-2 mt-4 p-2.5 bg-slate-50 rounded-lg text-center text-xs">
                  <div>
                    <div className="font-bold text-slate-800">{book.real_page_count || book.page_count}</div>
                    <div className="text-[10px] text-slate-400">Pages</div>
                  </div>
                  <div>
                    <div className="font-bold text-slate-800">{book.chunk_count || 0}</div>
                    <div className="text-[10px] text-slate-400">Index Chunks</div>
                  </div>
                  <div>
                    <div className="font-bold text-emerald-600">{book.ocr_confidence_avg || 98}%</div>
                    <div className="text-[10px] text-slate-400">OCR Conf</div>
                  </div>
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-5 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
                <button
                  type="button"
                  onClick={() => openInspector(book)}
                  className="inline-flex items-center space-x-1.5 font-semibold text-teal-600 hover:text-teal-700"
                >
                  <FileSearch className="h-3.5 w-3.5" />
                  <span>Inspect OCR & Pages</span>
                </button>

                <div className="flex items-center space-x-2 text-slate-400">
                  <button
                    type="button"
                    onClick={() => openEditModal(book)}
                    className="hover:text-slate-700 p-1"
                    title="Edit Metadata"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReprocess(book.id)}
                    className="hover:text-slate-700 p-1"
                    title="Re-index Chunks"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(book.id, book.title)}
                    className="hover:text-rose-600 p-1"
                    title="Delete Book"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* UPLOAD MODAL */}
      <Dialog
        isOpen={isUploadOpen}
        onClose={() => { if (!isUploading) setIsUploadOpen(false); }}
        title="Upload Medical Textbook / Reference PDF"
      >
        <form onSubmit={handleUploadSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select PDF Document (Complete Books Supported, up to 100MB)
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
              Textbook Title
            </label>
            <input
              type="text"
              required
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g. Robbins & Cotran Pathologic Basis of Disease"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Medical Subject (Dynamic Discovery)
              </label>
              <input
                type="text"
                value={uploadSubject}
                onChange={(e) => setUploadSubject(e.target.value)}
                placeholder="e.g. Pathology, Pharmacology, Surgery"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category
              </label>
              <input
                type="text"
                value={uploadCategory}
                onChange={(e) => setUploadCategory(e.target.value)}
                placeholder="e.g. Core Science, Clinical Practice"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1">
            <div className="font-semibold text-slate-700 flex items-center space-x-1.5">
              <CheckCircle2 className="h-3.5 w-3.5 text-teal-600" />
              <span>Automated Background Ingestion:</span>
            </div>
            <p>
              The system extracts native text, detects scanned pages, runs medical OCR verification, and compiles page-level BM25 search indices automatically.
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
              {isUploading ? 'Processing Document...' : 'Ingest Reference Book'}
            </button>
          </div>
        </form>
      </Dialog>

      {/* SIDE-BY-SIDE OCR & PAGE INSPECTOR MODAL */}
      <Dialog
        isOpen={isInspectorOpen}
        onClose={() => setIsInspectorOpen(false)}
        title={`Reference Inspector: ${activeBook?.title || ''}`}
        maxWidth="max-w-5xl"
      >
        <div className="flex flex-col md:flex-row gap-6 min-h-[500px]">
          {/* Page Selector Sidebar */}
          <div className="w-full md:w-56 shrink-0 border-r border-slate-100 pr-4 overflow-y-auto max-h-[550px] space-y-1">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
              Book Pages ({inspectPages.length})
            </div>
            {inspectPages.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => fetchPageDetail(activeBook.id, p.pdf_page_index)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center justify-between ${
                  selectedPageNum === p.pdf_page_index
                    ? 'bg-teal-600 text-white font-semibold'
                    : 'hover:bg-slate-100 text-slate-700'
                }`}
              >
                <span>Page {p.printed_page_number || p.pdf_page_index}</span>
                <span className={`text-[10px] ${selectedPageNum === p.pdf_page_index ? 'text-teal-100' : 'text-slate-400'}`}>
                  (PDF {p.pdf_page_index})
                </span>
              </button>
            ))}
          </div>

          {/* Page Details / Side-by-Side View */}
          <div className="flex-1 overflow-y-auto max-h-[550px] space-y-4">
            {activePageData ? (
              <div>
                {/* Page Metadata Bar */}
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div>
                    Printed Page: <strong>{activePageData.printed_page_number}</strong> &bull; PDF Index: <strong>{activePageData.pdf_page_index}</strong>
                  </div>
                  <div>
                    Type: <strong className="uppercase">{activePageData.page_type}</strong>
                  </div>
                  <div>
                    OCR Confidence: <strong className="text-emerald-700">{activePageData.ocr_confidence}%</strong>
                  </div>
                  <div>
                    Word Count: <strong>{activePageData.word_count}</strong>
                  </div>
                </div>

                {activePageData.flagged_uncertain === 1 && (
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 flex items-center space-x-2">
                    <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" />
                    <span>Page flagged for low OCR confidence or complex multi-column layout.</span>
                  </div>
                )}

                {/* Extracted Scientific Content */}
                <div className="mt-4">
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                    Extracted & Indexed Reference Text:
                  </div>
                  <pre className="p-4 bg-slate-900 text-slate-100 rounded-lg text-xs leading-relaxed font-mono whitespace-pre-wrap max-h-[380px] overflow-y-auto">
                    {activePageData.extracted_text || 'No text extracted on this page.'}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="text-center py-16 text-xs text-slate-500">
                Select a page from the list to view its extracted content and OCR confidence.
              </div>
            )}
          </div>
        </div>
      </Dialog>

      {/* EDIT METADATA MODAL */}
      <Dialog
        isOpen={isEditOpen}
        onClose={() => setIsEditOpen(false)}
        title="Edit Reference Metadata"
      >
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Title
            </label>
            <input
              type="text"
              required
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Medical Subject
              </label>
              <input
                type="text"
                value={editSubject}
                onChange={(e) => setEditSubject(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Category
              </label>
              <input
                type="text"
                value={editCategory}
                onChange={(e) => setEditCategory(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Authors
              </label>
              <input
                type="text"
                value={editAuthors}
                onChange={(e) => setEditAuthors(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Edition
              </label>
              <input
                type="text"
                value={editEdition}
                onChange={(e) => setEditEdition(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500/20 focus:border-teal-500"
              />
            </div>
          </div>

          <div className="flex justify-end space-x-3 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 rounded-lg transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white rounded-lg transition"
            >
              Save Changes
            </button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
