'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  FileCheck2,
  BookOpen,
  FileText,
  UserCheck,
  FileSpreadsheet,
  Settings,
  ShieldCheck,
  Sparkles
} from 'lucide-react';

const navItems = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'New Audit', href: '/audit/new', icon: Sparkles },
  { name: 'Medical Reference Library', href: '/library/references', icon: BookOpen },
  { name: 'Examination Library', href: '/library/examinations', icon: FileText },
  { name: 'Audit Reports', href: '/reports', icon: FileSpreadsheet },
  { name: 'Settings & AI Config', href: '/settings', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col shrink-0 text-slate-300 select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800 flex items-center space-x-3">
        <div className="bg-teal-500/10 p-2 rounded-lg border border-teal-500/20 text-teal-400">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-sm font-bold text-white tracking-wide leading-tight">
            Medical Question<br />
            <span className="text-teal-400 font-extrabold">Auditor & Validator</span>
          </h1>
          <p className="text-[10px] text-slate-400 font-medium">Evidence-Based Clinical Engine</p>
        </div>
      </div>

      {/* Nav List */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
          Auditing & Library
        </div>
        {navItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                isActive
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
              }`}
            >
              <Icon className={`h-4 w-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </nav>

      {/* Scientific Integrity Tag */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40 text-xs text-slate-400 space-y-1">
        <div className="flex items-center space-x-1.5 text-teal-400 font-semibold text-[11px]">
          <FileCheck2 className="h-3.5 w-3.5" />
          <span>17 Integrity Rules Active</span>
        </div>
        <p className="text-[10px] text-slate-400 leading-normal">
          Primary evidence derived exclusively from ingested medical textbooks.
        </p>
      </div>
    </aside>
  );
}
