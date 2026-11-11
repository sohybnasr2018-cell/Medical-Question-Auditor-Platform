'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Sparkles, Plus, CheckCircle2, Loader2, Database } from 'lucide-react';

export function Header() {
  const router = useRouter();
  const [seeding, setSeeding] = useState(false);
  const [seedSuccess, setSeedSuccess] = useState(false);

  const handleSeedDemo = async () => {
    try {
      setSeeding(true);
      const res = await fetch('/api/demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceReset: false })
      });
      if (res.ok) {
        setSeedSuccess(true);
        setTimeout(() => setSeedSuccess(false), 4000);
        router.refresh();
      }
    } catch (err) {
      console.error('Demo seeding failed:', err);
    } finally {
      setSeeding(false);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0 z-10">
      <div className="flex items-center space-x-3">
        <span className="text-xs font-semibold px-2.5 py-1 rounded bg-teal-50 text-teal-800 border border-teal-200">
          Academic Edition v1.0
        </span>
        <span className="text-xs text-slate-600 hidden sm:inline">
          Evidence-Based Medical Examination Question Auditing
        </span>
      </div>

      <div className="flex items-center space-x-3">
        {/* Quick Seeder Button */}
        <button
          type="button"
          onClick={handleSeedDemo}
          disabled={seeding}
          className="inline-flex items-center space-x-2 text-xs font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-2 rounded-lg transition border border-slate-200 disabled:opacity-50"
          title="Seed all 10 representative test cases (Robbins Pathology, Katzung Pharmacology, Gray's Anatomy, Guyton Physiology, Guidelines) with ready-to-audit exam"
        >
          {seeding ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-teal-600" />
          ) : seedSuccess ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : (
            <Database className="h-3.5 w-3.5 text-slate-500" />
          )}
          <span>{seedSuccess ? '10 Test Cases Loaded!' : 'Load Representative Test Suite (10 Cases)'}</span>
        </button>

        <Link
          href="/audit/new"
          className="inline-flex items-center space-x-2 text-xs font-semibold bg-teal-600 hover:bg-teal-700 text-white px-3.5 py-2 rounded-lg transition shadow-sm"
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Launch Audit</span>
        </Link>
      </div>
    </header>
  );
}
