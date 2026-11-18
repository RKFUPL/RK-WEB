"use client";

import { useEffect, useRef } from "react";
import { X } from "lucide-react";

export function SizeSelectionDialog({ open, sizes, custom, onSelect, onCustom, onClose }: {
  open: boolean; sizes: string[]; custom: boolean;
  onSelect: (size: string) => void; onCustom: () => void; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = overflow; previous?.focus(); };
  }, [open]);
  return <dialog ref={ref} aria-labelledby="size-selection-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) onClose(); }} className="m-auto w-[calc(100%-2rem)] max-w-md border border-black/10 bg-ivory p-6 text-charcoal shadow-xl backdrop:bg-ink/55 sm:p-8">
    <div className="flex items-start justify-between gap-4">
      <h2 id="size-selection-title" className="font-display text-3xl">Please select a size.</h2>
      <button type="button" onClick={onClose} aria-label="Close size selection" className="p-2"><X size={18} /></button>
    </div>
    <div className="mt-6 flex flex-wrap gap-2">{sizes.map(size => <button key={size} type="button" onClick={() => onSelect(size)} className="min-h-11 min-w-11 border border-charcoal/25 px-3 text-sm transition hover:border-gold focus-visible:outline-gold">{size}</button>)}</div>
    {custom ? <button type="button" onClick={onCustom} className="mt-5 border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.18em]">Custom size</button> : null}
  </dialog>;
}
