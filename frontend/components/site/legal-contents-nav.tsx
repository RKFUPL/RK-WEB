'use client';

import { ChevronDown } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';

type LegalContentsNavProps = {
  sections: Array<{ title: string }>;
  mobile?: boolean;
};

function sectionHref(index: number) {
  return `#section-${index + 1}`;
}

export function LegalContentsNav({ sections, mobile = false }: LegalContentsNavProps) {
  const [activeId, setActiveId] = useState('section-1');

  useEffect(() => {
    const headings = sections
      .map((_, index) => document.getElementById(`section-${index + 1}`))
      .filter((element): element is HTMLElement => Boolean(element));
    if (!headings.length) return undefined;

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => left.boundingClientRect.top - right.boundingClientRect.top)[0];
      if (visible?.target.id) setActiveId(visible.target.id);
    }, { rootMargin: '-22% 0px -66% 0px', threshold: 0 });

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, [sections]);

  const navigate = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
    window.history.replaceState(null, '', `#${id}`);
    setActiveId(id);
  };

  const links = <nav aria-label="Policy contents" className={mobile ? 'legal-contents-links legal-contents-links--mobile' : 'legal-contents-links'}>
    {sections.map((section, index) => {
      const id = `section-${index + 1}`;
      const active = activeId === id;
      return <a
        key={`${id}-${section.title}`}
        href={sectionHref(index)}
        onClick={(event) => navigate(event, id)}
        aria-current={active ? 'location' : undefined}
        className={`legal-contents-link${active ? ' legal-contents-link--active' : ''}`}
      >
        <span aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <span>{section.title}</span>
      </a>;
    })}
  </nav>;

  if (!mobile) return links;

  return <details className="legal-contents-mobile">
    <summary>
      <span>On this page</span>
      <ChevronDown aria-hidden="true" size={16} strokeWidth={1.5} />
    </summary>
    {links}
  </details>;
}
