type LookbookPdfViewerProps = {
  title: string;
  subtitle: string;
  pdfUrl: string;
};

export function LookbookPdfViewer({ title, subtitle, pdfUrl }: LookbookPdfViewerProps) {
  const viewerUrl = `${pdfUrl}#toolbar=0&navpanes=0&scrollbar=0`;

  return (
    <section className="mx-auto max-w-7xl px-6 pb-16 pt-28 lg:px-10 lg:pb-24 lg:pt-32">
      <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div className="space-y-6 lg:sticky lg:top-28 lg:self-start">
          <p className="text-xs uppercase tracking-[0.38em] text-charcoal/45">Lookbook</p>
          <h1 className="max-w-xl font-display text-5xl leading-none md:text-7xl">{title}</h1>
          <p className="max-w-xl text-base leading-8 text-charcoal/70 md:text-lg">{subtitle}</p>
          <p className="max-w-xl text-sm leading-7 text-charcoal/60">
            The lookbook is embedded for viewing only. There is no download button in the page
            layout, although browser PDF controls may still vary by device.
          </p>
        </div>

        <div className="overflow-hidden border border-black/10 bg-white shadow-[0_20px_60px_rgba(0,0,0,0.06)]">
          <div className="border-b border-black/10 bg-ivory px-5 py-4 text-[0.65rem] uppercase tracking-[0.28em] text-charcoal/45">
            Viewer only
          </div>
          <iframe
            src={viewerUrl}
            title={title}
            className="h-[78vh] w-full bg-white"
            loading="eager"
          />
        </div>
      </div>
    </section>
  );
}
