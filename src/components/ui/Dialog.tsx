'use client';

import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  maxWidth?: string;
}

export function Dialog({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = 'max-w-2xl'
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = React.useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else {
      if (dialog.open) {
        dialog.close();
      }
    }
  }, [isOpen]);

  // Handle native cancel (Esc key)
  const handleCancel = (e: React.SyntheticEvent) => {
    e.preventDefault();
    onClose();
  };

  // Close when clicking directly on the backdrop (outside the inner box)
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onCancel={handleCancel}
      onClick={handleBackdropClick}
      className={`rounded-xl border border-slate-200 bg-white p-0 shadow-2xl text-slate-800 ${maxWidth} w-full m-auto backdrop:bg-slate-900/60 open:animate-in open:fade-in-0 open:zoom-in-95`}
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4 bg-slate-50/50">
        <h2 id={titleId} className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 transition"
          aria-label="Close dialog"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="p-6 max-h-[80vh] overflow-y-auto">
        {children}
      </div>
    </dialog>
  );
}
