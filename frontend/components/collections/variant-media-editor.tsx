"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, ImagePlus, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { hasUnsavedGalleryChanges, isPersistedMediaRelationshipId, parseWorkDriveBatch, prepareWorkDriveGallerySave, workDriveGalleryMatches, type WorkDriveGalleryDraft } from "@/lib/workdrive-media";
import type { CatalogProductVariant } from "@/lib/catalog";
import { colourSwatchValue, isHexColour, normalizeColourSwatchName } from "@/lib/colour-swatches";

async function readApiResponse(response: Response, endpoint: string): Promise<Record<string, unknown>> {
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try { payload = text ? JSON.parse(text) as Record<string, unknown> : {}; } catch {
    const excerpt = text.replace(/\s+/g, " ").slice(0, 120);
    throw new Error(`API ${response.status} from ${endpoint} returned a non-JSON response${excerpt ? `: ${excerpt}` : "."}`);
  }
  if (!response.ok) throw new Error(String(payload.error || `API ${response.status} from ${endpoint} failed.`));
  return payload;
}

export function VariantMediaEditor({ productId, variants, token, onSaved }: { productId: string; variants: CatalogProductVariant[]; token: () => string; onSaved?: () => void }) {
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const selected = variants.find((item) => item.id === variantId) || variants[0];
  const [drafts, setDrafts] = useState<WorkDriveGalleryDraft[]>([]);
  const [baseline, setBaseline] = useState<WorkDriveGalleryDraft[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [batch, setBatch] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);
  const [failedMediaIds, setFailedMediaIds] = useState<Set<string>>(new Set());
  const [newColour, setNewColour] = useState("");
  const [newColourHex, setNewColourHex] = useState("");
  const [colourSwatches, setColourSwatches] = useState<Record<string, string>>({});
  const [editingColour, setEditingColour] = useState("");
  const [editingHex, setEditingHex] = useState("");
  const [addingColour, setAddingColour] = useState(false);
  const base = "/api/staff/products/" + encodeURIComponent(productId) + "/variants/";

  const load = async (id: string) => {
    if (!id) return [];
    setLoading(true);
    try {
      const endpoint = base + encodeURIComponent(id);
      const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" });
      const payload = await readApiResponse(response, endpoint);
      const meta = Array.isArray(payload.imageMeta) ? payload.imageMeta : [];
      const imageList = Array.isArray(payload.images) ? payload.images : [];
      const loaded = imageList.map((url: string, index: number) => {
        const item = meta.find((entry: { position?: number }) => entry.position === index) || meta[index] || {};
        return { id: String(item.media_id || item.id || `${id}:${index}:${url}`), permalink: String(item.permalink || url), renderUrl: item.renderUrl, alt_text: item.alt_text, variantId: id, primary: item.is_primary === true || (!meta.length && index === 0), hover: item.is_hover === true };
      });
      setDrafts(loaded);
      setBaseline(loaded);
      setLoadedCount(loaded.length);
      setFailedMediaIds(new Set());
      setCounts((current) => ({ ...current, [id]: loaded.length }));
      setError("");
      return loaded;
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(selected?.id || "").catch((value) => setError(value instanceof Error ? value.message : "Unable to load gallery.")); }, [selected?.id]);

  useEffect(() => {
    void fetch("/api/admin/colour-swatches", { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload) => { if (payload?.colourSwatches && typeof payload.colourSwatches === "object") setColourSwatches(payload.colourSwatches); })
      .catch(() => undefined);
  }, [productId]);

  useEffect(() => {
    variants.forEach((variant) => {
      if (variant.id === selected?.id) return;
      void fetch(base + encodeURIComponent(variant.id), { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" })
        .then((response) => response.ok ? response.json() : null)
        .then((payload) => { if (payload) setCounts((current) => ({ ...current, [variant.id]: Array.isArray(payload.images) ? payload.images.length : 0 })); })
        .catch(() => undefined);
    });
  }, [productId, variants.length]);

  const addBatch = () => {
    const parsed = parseWorkDriveBatch(batch);
    if (parsed.error || !parsed.entries.length) { setError(parsed.error || "Paste at least one approved WorkDrive link."); return; }
    setDrafts((current) => [...current, ...parsed.entries.map((entry, index) => ({ ...entry, id: `${selected.id}:new:${Date.now()}:${index}`, variantId: selected.id, primary: current.length === 0 && index === 0, hover: false }))]);
    setBatch(""); setError(""); setMessage("");
  };

  const save = async () => {
    if (!selected) return;
    const prepared = prepareWorkDriveGallerySave(drafts, batch, selected.id);
    if (prepared.error) { setError(prepared.error); return; }
    const submitted = prepared.entries;
    if (!submitted.length && loadedCount === 0) { setError("Add or preview at least one WorkDrive image before saving this empty gallery."); return; }
    if (submitted.filter((item) => item.primary).length > 1 || submitted.filter((item) => item.hover).length > 1) { setError("Choose at most one primary and one hover image."); return; }
    setBusy(true); setError(""); setMessage("");
    try {
      const endpoint = base + encodeURIComponent(selected.id);
      const response = await fetch(endpoint, { method: "PATCH", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ images: submitted.map((item) => item.permalink), imageMeta: submitted.map((item, index) => ({ id: item.id, permalink: item.permalink, url: item.permalink, alt_text: item.alt_text, position: index, is_primary: item.primary, is_hover: item.hover })) }) });
      await readApiResponse(response, endpoint);
      setBatch("");
      const persisted = await load(selected.id);
      if (!workDriveGalleryMatches(submitted, persisted)) throw new Error("The saved gallery did not match the server read-back. Reload and try again.");
      setMessage("Saved and verified against the server."); onSaved?.();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to save colour gallery."); }
    finally { setBusy(false); }
  };

  const move = (index: number, delta: number) => setDrafts((current) => { const next = [...current]; const target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; });
  const switchVariant = (nextVariantId: string) => {
    if (nextVariantId === selected.id) return;
    if (hasUnsavedGalleryChanges(baseline, drafts, batch)) {
      setError(`Save or discard the unsaved ${selected.colour || "current"} gallery changes before switching colours.`);
      return;
    }
    setError(""); setMessage(""); setVariantId(nextVariantId);
  };
  const saveColourHex = async (colour: string, hex: string) => {
    if (!isHexColour(hex)) throw new Error("Hex code must use the format #RRGGBB.");
    const endpoint = "/api/admin/colour-swatches";
    const response = await fetch(endpoint, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ colourSwatches: { [normalizeColourSwatchName(colour)]: hex.toUpperCase() } }) });
    const payload = await readApiResponse(response, endpoint);
    setColourSwatches((payload.colourSwatches as Record<string, string>) || {});
  };
  const addColour = async () => {
    const colour = newColour.trim().replace(/\s+/g, " ").toUpperCase();
    if (!colour) { setError("Enter a colour name."); return; }
    if (newColourHex.trim() && !isHexColour(newColourHex)) { setError("Hex code must use the format #RRGGBB."); return; }
    setAddingColour(true); setError("");
    const endpoint = "/api/staff/products/" + encodeURIComponent(productId) + "/variants";
    try {
      if (newColourHex.trim()) await saveColourHex(colour, newColourHex.trim());
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ colour }) });
      const payload = await readApiResponse(response, endpoint);
      const created = payload.variant as { id?: string } | undefined;
      setNewColour(""); setNewColourHex("");
      if (created?.id) { setVariantId(created.id); onSaved?.(); }
      else onSaved?.();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to add colour."); }
    finally { setAddingColour(false); }
  };
  const editColourHex = async () => {
    if (!editingColour || !isHexColour(editingHex)) { setError("Hex code must use the format #RRGGBB."); return; }
    setAddingColour(true); setError("");
    try { await saveColourHex(editingColour, editingHex); setEditingColour(""); setEditingHex(""); setMessage("Colour swatch saved."); }
    catch (value) { setError(value instanceof Error ? value.message : "Unable to save colour swatch."); }
    finally { setAddingColour(false); }
  };
  const unsaved = hasUnsavedGalleryChanges(baseline, drafts, batch);
  if (!variants.length) return null;

  return <section className="admin-panel mt-6 overflow-hidden" aria-labelledby="colour-gallery-title">
    <div className="border-b border-[var(--admin-border)] px-4 pt-5 sm:px-6">
      <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--admin-gold)]">Media & galleries</p>
      <div className="mt-1 flex flex-wrap items-end justify-between gap-3"><div><h3 id="colour-gallery-title" className="text-2xl">Colour galleries</h3><p className="mt-1 text-xs text-[var(--admin-muted)]">Images are isolated by stable colour variant and verified after every save.</p></div>{message ? <p className="mb-1 inline-flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={15} />{message}</p> : null}</div>
      <div className="mt-5 min-w-0">
        <div className="flex min-w-0 gap-2 overflow-x-auto" role="tablist" aria-label="Product colour galleries">
        {variants.map((variant) => { const active = variant.id === selected.id; const name = normalizeColourSwatchName(variant.colour); return <div key={variant.id} className="flex items-stretch"><button type="button" role="tab" aria-selected={active} onClick={() => switchVariant(variant.id)} className={`min-w-36 rounded-t-xl border border-b-0 px-4 py-3 text-left transition ${active ? "border-[#c69a62]/55 bg-[#fbf4e9] text-[#3b2b1f]" : "border-transparent text-[var(--admin-muted)] hover:bg-black/[.025]"}`}><span className="flex items-center gap-2 text-sm font-medium"><span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ backgroundColor: colourSwatchValue(name, colourSwatches) || "#b7aa99" }} />{variant.colour || "Variant"}</span><span className="mt-1 block text-[10px] uppercase tracking-[.12em]">{counts[variant.id] ?? (variant.id === selected.id ? drafts.length : 0)} images · {variant.sku}</span></button><button type="button" aria-label={`Edit ${variant.colour} hex code`} onClick={() => { setEditingColour(name); setEditingHex(colourSwatches[name] || ""); }} className="rounded-tr-xl border border-b-0 border-transparent px-2 text-[var(--admin-muted)] hover:text-[#7d582c]"><Pencil size={13} /></button></div>; })}
        </div>
        <div className="mt-3 inline-flex w-fit max-w-full flex-wrap items-center gap-2 self-start rounded-t-xl border border-dashed border-[#c69a62]/60 px-3 py-2"><input aria-label="New colour name" value={newColour} onChange={(event) => setNewColour(event.target.value)} placeholder="ADD COLOUR" className="min-w-0 w-24 bg-transparent text-[10px] uppercase tracking-[.12em] outline-none" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addColour(); } }} /><input aria-label="New colour hex code" value={newColourHex} onChange={(event) => setNewColourHex(event.target.value)} placeholder="#RRGGBB" maxLength={7} className="min-w-0 w-20 bg-transparent text-[10px] uppercase tracking-[.12em] outline-none" /><span aria-label="New colour swatch" className="h-4 w-4 shrink-0 rounded-full border border-black/15" style={{ backgroundColor: colourSwatchValue(newColour, newColourHex ? { [normalizeColourSwatchName(newColour)]: newColourHex } : colourSwatches) || "#b7aa99" }} /><button type="button" onClick={() => void addColour()} disabled={addingColour} aria-label="Add colour" className="inline-flex shrink-0 items-center gap-1 text-[10px] uppercase tracking-[.12em] text-[#7d582c] disabled:opacity-50"><Plus size={13}/>Add</button></div>
      </div>
      {editingColour ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-[#c69a62]/40 bg-[#fbf8f2] p-3"><span className="text-xs font-medium">{editingColour}</span><input aria-label="Edit colour hex code" value={editingHex} onChange={(event) => setEditingHex(event.target.value)} placeholder="#RRGGBB" maxLength={7} className="admin-field h-8 w-28 min-h-0 text-xs" /><span aria-label="Edited colour swatch" className="h-5 w-5 rounded-full border border-black/15" style={{ backgroundColor: colourSwatchValue(editingColour, { [editingColour]: editingHex }) || "#b7aa99" }} /><button type="button" onClick={() => void editColourHex()} disabled={addingColour} className="admin-button-primary px-3 py-1.5 text-xs">Save swatch</button><button type="button" onClick={() => setEditingColour("")} className="admin-button-secondary px-3 py-1.5 text-xs">Cancel</button></div> : null}
    </div>

    <div className="p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h4 className="admin-display text-xl capitalize">{selected.colour || "Selected"} gallery</h4><p className="mt-1 text-xs text-[var(--admin-muted)]">{drafts.length} {drafts.length === 1 ? "image" : "images"} · {selected.sku}</p></div><div className="flex items-center gap-3">{unsaved && !loading ? <button type="button" onClick={() => { setBatch(""); void load(selected.id).catch((value) => setError(value instanceof Error ? value.message : "Unable to reload gallery.")); }} className="text-xs text-[var(--admin-muted)] underline decoration-[#a8793d]/50 underline-offset-4 hover:text-[#7d582c]">Discard changes</button> : null}{loading ? <span className="inline-flex items-center gap-2 text-xs text-[var(--admin-muted)]"><Loader2 size={14} className="animate-spin" />Loading gallery</span> : null}</div></div>

      {drafts.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{drafts.map((item, index) => { const failed = failedMediaIds.has(item.id); return <article key={item.id} className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)]">
        <div className="relative aspect-[4/3] bg-[#eee8de]">{isPersistedMediaRelationshipId(item.id) ? <img src={item.renderUrl || `/api/staff/products/${encodeURIComponent(productId)}/media/${encodeURIComponent(item.id)}`} alt={item.alt_text || `Product image ${index + 1}`} className={`h-full w-full object-cover${failed ? " hidden" : ""}`} onLoad={() => setFailedMediaIds((current) => { if (!current.has(item.id)) return current; const next = new Set(current); next.delete(item.id); return next; })} onError={() => setFailedMediaIds((current) => new Set(current).add(item.id))} /> : <div className="grid h-full place-items-center px-5 text-center text-xs text-[#8a9098]">Unsaved image relationship. Save the gallery to enable its secure preview.</div>}{failed ? <div className="absolute inset-0 grid place-items-center px-5 text-center text-xs text-[#8a9098]">Preview unavailable. Verify that the saved WorkDrive image is accessible.</div> : null}<span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-[11px] font-semibold shadow">{index + 1}</span></div>
        <div className="p-3"><input aria-label={`WorkDrive link for image ${index + 1}`} className="admin-field h-9 min-h-0 text-xs" value={item.permalink} onChange={(event) => setDrafts((all) => all.map((entry) => entry.id === item.id ? { ...entry, permalink: event.target.value } : entry))}/><p className="mt-2 truncate text-xs font-medium">{item.alt_text || `Image ${index + 1}`}</p><p className="mt-1 text-[10px] uppercase tracking-[.12em] text-[var(--admin-muted)]">{item.variantId}</p>
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-[var(--admin-border)] pt-3 text-xs"><label className="inline-flex items-center gap-1.5"><input type="radio" name={`primary-${selected.id}`} checked={item.primary} onChange={() => setDrafts((all) => all.map((entry) => ({ ...entry, primary: entry.id === item.id })))} />Primary</label><label className="inline-flex items-center gap-1.5"><input type="radio" name={`hover-${selected.id}`} checked={item.hover} onChange={() => setDrafts((all) => all.map((entry) => ({ ...entry, hover: entry.id === item.id })))} />Hover</label><span className="ml-auto flex gap-1"><button type="button" className="admin-icon-button rounded-md p-1.5 hover:bg-black/5 disabled:opacity-30" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${item.alt_text || `image ${index + 1}`} up`}><ArrowUp size={14}/></button><button type="button" className="admin-icon-button rounded-md p-1.5 hover:bg-black/5 disabled:opacity-30" disabled={index === drafts.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${item.alt_text || `image ${index + 1}`} down`}><ArrowDown size={14}/></button><button type="button" className="admin-icon-button rounded-md p-1.5 text-red-600 hover:bg-red-50" onClick={() => setDrafts((all) => all.filter((entry) => entry.id !== item.id))} aria-label={`Remove ${item.alt_text || `image ${index + 1}`}`}><Trash2 size={14}/></button></span></div>
        </div>
      </article>; })}</div> : <div className="mt-4 grid min-h-32 place-items-center rounded-xl border border-dashed border-[#9a7a4d]/35 bg-[#fbf8f2] text-center"><div><ImagePlus size={22} className="mx-auto text-[#a8793d]"/><p className="mt-2 text-sm font-medium">No images yet</p><p className="mt-1 text-xs text-[var(--admin-muted)]">Add approved WorkDrive links below.</p></div></div>}

      <div className="mt-5 rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">Add images to {selected.colour || "gallery"}</p><p className="mt-1 text-xs text-[var(--admin-muted)]">Named links, URL-only lists, and unpreviewed batches are validated before saving.</p></div><span className="rounded-full bg-[#efe2d0] px-3 py-1 text-[10px] uppercase tracking-[.12em] text-[#7d582c]">Destination · {selected.id}</span></div><textarea className="admin-field mt-3 min-h-28 resize-y text-xs leading-5" value={batch} onChange={(event) => setBatch(event.target.value)} placeholder="Landscape main.jpg - https://workdrive.zoho.in/file/..."/><div className="mt-3 flex flex-wrap justify-end gap-2"><button type="button" className="admin-button-secondary px-4 py-2 text-xs" onClick={addBatch}>Preview links</button><button type="button" disabled={busy || loading} onClick={() => void save()} className="admin-button-primary inline-flex min-w-36 items-center justify-center gap-2 px-4 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-40">{busy ? <><Loader2 size={14} className="animate-spin"/>Saving…</> : `Save ${selected.colour || "colour"} gallery`}</button></div></div>
      {error ? <p role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p> : null}
    </div>
  </section>;
}
