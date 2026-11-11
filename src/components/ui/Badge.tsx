import React from 'react';

export type BadgeVariant =
  | 'confirmed_error'
  | 'highly_probable_error'
  | 'potential_error'
  | 'ambiguous_question'
  | 'insufficient_evidence'
  | 'no_detected_issue'
  | 'critical'
  | 'major'
  | 'moderate'
  | 'minor'
  | 'approved'
  | 'rejected'
  | 'postponed'
  | 'pending'
  | 'ready'
  | 'processing'
  | 'info';

interface BadgeProps {
  variant: BadgeVariant | string;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ variant, children, className = '' }: BadgeProps) {
  let style = 'bg-slate-100 text-slate-700 border-slate-200';

  switch (variant) {
    case 'confirmed_error':
    case 'critical':
    case 'rejected':
      style = 'bg-rose-50 text-rose-700 border-rose-200';
      break;
    case 'highly_probable_error':
    case 'major':
      style = 'bg-amber-50 text-amber-700 border-amber-200';
      break;
    case 'potential_error':
    case 'moderate':
      style = 'bg-yellow-50 text-yellow-800 border-yellow-200';
      break;
    case 'ambiguous_question':
      style = 'bg-sky-50 text-sky-700 border-sky-200';
      break;
    case 'insufficient_evidence':
      style = 'bg-purple-50 text-purple-700 border-purple-200';
      break;
    case 'no_detected_issue':
    case 'approved':
    case 'ready':
      style = 'bg-emerald-50 text-emerald-700 border-emerald-200';
      break;
    case 'pending':
    case 'processing':
      style = 'bg-blue-50 text-blue-700 border-blue-200';
      break;
    case 'postponed':
      style = 'bg-slate-100 text-slate-600 border-slate-300';
      break;
    case 'minor':
      style = 'bg-teal-50 text-teal-700 border-teal-200';
      break;
  }

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${style} ${className}`}
    >
      {children}
    </span>
  );
}
