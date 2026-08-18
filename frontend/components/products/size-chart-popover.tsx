'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';

const sizes = ['XS', 'S', 'M', 'L', 'XL'];
const measurements = [
  ['Bust', ['32', '34', '36', '38', '40']],
  ['Waist', ['24', '26', '28', '30', '32']],
  ['Hip', ['34', '36', '38', '40', '42']],
  ['Shoulder', ['13.5', '14', '14.5', '15', '15.5']],
] as const;

export function SizeChartPopover() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePress);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePress);
  }, [open]);

  return <div
    ref={containerRef}
    className="relative"
    onPointerEnter={(event) => { if (event.pointerType === 'mouse') setOpen(true); }}
    onPointerLeave={(event) => { if (event.pointerType === 'mouse') setOpen(false); }}
  >
    <button
      type="button"
      onClick={() => setOpen((current) => !current)}
      aria-expanded={open}
      className="text-[0.55rem] uppercase tracking-[0.18em] text-gold transition hover:text-charcoal"
    >
      Don&apos;t know your size?
    </button>
    <AnimatePresence>
      {open ? <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.16 }}
        role="dialog"
        aria-label="Women&apos;s size chart"
        className="absolute right-0 top-full z-50 mt-3 w-[min(23rem,calc(100vw-2rem))] rounded-[14px] border border-black/10 bg-ivory p-4 text-charcoal shadow-[0_18px_50px_rgba(42,38,34,0.16)] dark:border-white/15 dark:bg-[#151515] dark:text-white"
      >
        <div className="flex items-end justify-between gap-4 border-b border-black/10 pb-3 dark:border-white/15">
          <div>
            <p className="text-[0.52rem] uppercase tracking-[0.24em] text-gold">RK size guide</p>
            <p className="mt-1 font-display text-2xl leading-none">Women&apos;s measurements</p>
          </div>
          <span className="text-[0.52rem] uppercase tracking-[0.18em] text-charcoal/45 dark:text-white/50">Inches</span>
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[20rem] border-collapse text-left text-[0.58rem]">
            <thead>
              <tr className="border-b border-black/10 text-[0.5rem] uppercase tracking-[0.16em] text-charcoal/50 dark:border-white/15 dark:text-white/55">
                <th scope="col" className="pb-2 pr-3 font-normal">Size</th>
                {sizes.map((size) => <th key={size} scope="col" className="px-1 pb-2 text-center font-normal">{size}</th>)}
              </tr>
            </thead>
            <tbody>
              {measurements.map(([label, values]) => <tr key={label} className="border-b border-black/6 last:border-0 dark:border-white/10">
                <th scope="row" className="py-2 pr-3 font-normal uppercase tracking-[0.12em] text-charcoal/55 dark:text-white/55">{label}</th>
                {values.map((value, index) => <td key={`${label}-${sizes[index]}`} className="px-1 py-2 text-center">{value}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
      </motion.div> : null}
    </AnimatePresence>
  </div>;
}
