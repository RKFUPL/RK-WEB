'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { Expand, Minimize2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

const sizes = ['XS', 'S', 'M', 'L', 'XL'];
const measurements = [
  ['Bust', ['32', '34', '36', '38', '40']],
  ['Waist', ['24', '26', '28', '30', '32']],
  ['Hip', ['34', '36', '38', '40', '42']],
  ['Shoulder', ['13.5', '14', '14.5', '15', '15.5']],
] as const;

export function SizeChartPopover() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setExpanded(false);
      }
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setExpanded(false);
  };

  return <>
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-expanded={open}
      className="text-[0.62rem] uppercase tracking-[0.2em] text-gold transition hover:text-charcoal"
    >
      Don&apos;t know your size?
    </button>
    <AnimatePresence>
      {open ? <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[170] flex items-center justify-center bg-ink/68 p-3 backdrop-blur-[2px] sm:p-6"
      >
        <motion.section
          initial={{ opacity: 0, y: 18, scale: 0.985 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.2 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rk-size-guide-title"
          className={`max-h-[calc(100vh-1.5rem)] w-full overflow-y-auto rounded-[16px] border border-black/10 bg-ivory text-charcoal shadow-[0_28px_90px_rgba(20,17,14,0.28)] dark:border-white/15 dark:bg-[#151515] dark:text-white sm:max-h-[calc(100vh-3rem)] ${expanded ? 'max-w-6xl p-5 sm:p-8 lg:p-10' : 'max-w-3xl p-5 sm:p-7 lg:p-8'}`}
        >
          <header className="flex items-start justify-between gap-5 border-b border-black/10 pb-5 dark:border-white/15 sm:pb-6">
            <div>
              <p className={`${expanded ? 'text-[0.72rem]' : 'text-[0.66rem]'} uppercase tracking-[0.3em] text-gold`}>RK size guide</p>
              <h2 id="rk-size-guide-title" className={`mt-2 font-display leading-none ${expanded ? 'text-4xl sm:text-5xl' : 'text-3xl sm:text-4xl'}`}>Women&apos;s measurements</h2>
              <p className={`mt-3 uppercase tracking-[0.2em] text-charcoal/48 dark:text-white/50 ${expanded ? 'text-xs' : 'text-[0.68rem]'}`}>Measurements in inches</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button type="button" onClick={() => setExpanded((current) => !current)} aria-label={expanded ? 'Return size guide to normal view' : 'Expand size guide'} className="inline-flex h-10 items-center gap-2 border border-black/15 px-3 text-[0.58rem] uppercase tracking-[0.18em] transition hover:border-gold hover:text-gold dark:border-white/20 sm:px-4">
                {expanded ? <Minimize2 size={15} /> : <Expand size={15} />}
                <span className="hidden sm:inline">{expanded ? 'Normal view' : 'Expand'}</span>
              </button>
              <button type="button" onClick={close} aria-label="Close size guide" className="grid h-10 w-10 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"><X size={18} /></button>
            </div>
          </header>
          <div className="mt-5 overflow-x-auto sm:mt-7">
            <table className={`w-full border-collapse text-left ${expanded ? 'min-w-[52rem] text-base' : 'min-w-[40rem] text-sm'}`}>
              <thead>
                <tr className="border-b border-black/12 uppercase tracking-[0.2em] text-charcoal/52 dark:border-white/15 dark:text-white/55">
                  <th scope="col" className={`${expanded ? 'pb-5 pr-8 text-xs' : 'pb-4 pr-6 text-[0.68rem]'} font-normal`}>Size</th>
                  {sizes.map((size) => <th key={size} scope="col" className={`${expanded ? 'px-4 pb-5 text-sm' : 'px-3 pb-4 text-xs'} text-center font-normal`}>{size}</th>)}
                </tr>
              </thead>
              <tbody>
                {measurements.map(([label, values]) => <tr key={label} className="border-b border-black/[.07] last:border-0 dark:border-white/10">
                  <th scope="row" className={`${expanded ? 'py-6 pr-8 text-sm' : 'py-5 pr-6 text-xs'} font-normal uppercase tracking-[0.16em] text-charcoal/60 dark:text-white/60`}>{label}</th>
                  {values.map((value, index) => <td key={`${label}-${sizes[index]}`} className={`${expanded ? 'px-4 py-6 text-lg' : 'px-3 py-5 text-base'} text-center tabular-nums`}>{value}</td>)}
                </tr>)}
              </tbody>
            </table>
          </div>
        </motion.section>
      </motion.div> : null}
    </AnimatePresence>
  </>;
}
