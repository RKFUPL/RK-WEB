'use client';

import { useState } from 'react';
import { SectionShell } from './section-shell';

export function Newsletter() {
  const [email, setEmail] = useState('');

  return (
    <SectionShell id="journal" className="bg-ivory">
      <div className="grid gap-8 border-y border-black/6 py-12 lg:grid-cols-[1fr_0.85fr] lg:items-center lg:py-16">
        <div className="space-y-4">
          <p className="text-xs uppercase tracking-[0.38em] text-charcoal/50">Newsletter</p>
          <h2 className="max-w-xl font-display text-5xl leading-[0.9] text-charcoal md:text-7xl">
            Receive collection notes, launches, and editorial stories.
          </h2>
        </div>
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(event) => event.preventDefault()}
        >
          <label className="sr-only" htmlFor="newsletter-email">
            Email
          </label>
          <input
            id="newsletter-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            className="flex-1 border border-black/10 bg-white px-5 py-4 text-sm outline-none transition placeholder:text-charcoal/35 focus:border-gold"
          />
          <button
            type="submit"
            className="border border-charcoal bg-charcoal px-7 py-4 text-xs uppercase tracking-[0.3em] text-ivory transition hover:border-gold hover:bg-gold hover:text-ink"
          >
            Subscribe
          </button>
        </form>
      </div>
    </SectionShell>
  );
}
