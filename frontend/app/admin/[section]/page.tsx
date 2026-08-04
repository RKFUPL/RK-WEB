export default async function AdminSection({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return <section className="mt-12 border border-black/10 bg-white p-8"><h2 className="font-display text-4xl capitalize">{section.replaceAll('-', ' ')}</h2><p className="mt-4 text-sm text-charcoal/60">This protected Admin workspace is ready for the corresponding management module.</p></section>;
}
