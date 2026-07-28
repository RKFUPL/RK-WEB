import { cn } from '@/lib/utils';

type SectionHeadingProps = {
  eyebrow: string;
  title: string;
  description?: string;
  className?: string;
};

export function SectionHeading({ eyebrow, title, description, className }: SectionHeadingProps) {
  return (
    <div className={cn('max-w-2xl space-y-4', className)}>
      <p className="text-xs uppercase tracking-[0.35em] text-charcoal/55">{eyebrow}</p>
      <h2 className="font-display text-4xl leading-none text-charcoal md:text-6xl">{title}</h2>
      {description ? <p className="max-w-xl text-sm leading-7 text-charcoal/72 md:text-base">{description}</p> : null}
    </div>
  );
}
