"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Trash2 } from "lucide-react";
import type { CatalogMedia, CatalogProductVariant } from "@/lib/catalog";
import { parseWorkDriveBatch } from "@/lib/workdrive-media";
import { apiBaseUrl } from "@/lib/rbac";
import { colourSwatchValue, isHexColour, normalizeColourSwatchName } from "@/lib/colour-swatches";

type Props = {
  variants: CatalogProductVariant[];
  value: CatalogMedia[];
  onChange: (media: CatalogMedia[]) => void;
  token: () => string;
  onAddColour: (colour: string) => string | undefined;
  onRenameColour: (variantId: string, colour: string) => string | undefined;
  onRemoveColour: (variantId: string) => boolean;
};

function DraftMediaPreview({ url, label, token }: { url: string; label: string; token: () => string }) {
  const [source, setSource] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = "";
    setSource(""); setFailed(false);
    void fetch(`${apiBaseUrl}/api/staff/collections/image-preview`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error("Preview unavailable");
      objectUrl = URL.createObjectURL(await response.blob());
      setSource(objectUrl);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url]);
  if (source) return <img src={source} alt={label} className="h-full w-full object-cover"/>;
  return <div className="grid h-full place-items-center px-5 text-center text-xs text-[#8a9098]">{failed ? "Preview unavailable. Check that this WorkDrive image is accessible." : "Loading secure preview…"}</div>;
}

export function CreateProductMediaEditor({ variants, value, onChange, token, onAddColour, onRenameColour, onRemoveColour }: Props) {
  const [variantId, setVariantId] = useState(variants[0]?.id || "");
  const [newColour, setNewColour] = useState("");
  const [newColourHex, setNewColourHex] = useState("");
  const [batch, setBatch] = useState("");
  const [error, setError] = useState("");
  const [addingColour, setAddingColour] = useState(false);
  const [editingColour, setEditingColour] = useState("");
  const selected = variants.find((variant) => variant.id === variantId) || variants[0];
  const gallery = useMemo(
    () => value.filter((item) => item.variant_id === selected?.id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0)),
    [selected?.id, value],
  );

  useEffect(() => {
    if (!variants.length) setVariantId("");
    else if (!variants.some((variant) => variant.id === variantId)) setVariantId(variants[0].id);
  }, [variants, variantId]);

  const addColour = async () => {
    if (addingColour) return;
    if (newColourHex.trim() && !isHexColour(newColourHex)) { setError("Hex code must use the format #RRGGBB."); return; }
    const addedId = onAddColour(newColour);
    if (!addedId) {
      setError(newColour.trim() ? "That colour already exists or is not valid." : "Enter a colour name first.");
      return;
    }
    setAddingColour(true);
    setError("");
    setVariantId(addedId);
    if (newColourHex.trim()) {
      try {
        const response = await fetch(`${apiBaseUrl}/api/admin/colour-swatches`, { method: "PUT", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ colourSwatches: { [normalizeColourSwatchName(newColour)]: newColourHex.trim().toUpperCase() } }) });
        if (!response.ok) throw new Error("Unable to save the colour swatch. The new colour was not kept.");
      } catch (value) {
        onRemoveColour(addedId);
        setError(value instanceof Error ? value.message : "Unable to save the colour swatch. The new colour was not kept.");
        setAddingColour(false);
        return;
      }
    }
    setNewColour("");
    setNewColourHex("");
    setError("");
    setAddingColour(false);
  };
  const renameColour = () => {
    if (!selected) return;
    const nextId = onRenameColour(selected.id, editingColour);
    if (!nextId) { setError("Enter a unique colour name."); return; }
    setVariantId(nextId); setEditingColour(""); setError("");
  };
  const removeColour = () => {
    if (!selected) return;
    if (gallery.length && !window.confirm(`Remove ${selected.colour} and discard its ${gallery.length} draft image${gallery.length === 1 ? "" : "s"}?`)) return;
    if (!onRemoveColour(selected.id)) { setError("Unable to remove this colour."); return; }
    setError("");
  };

  if (!selected) {
    return <section className="admin-panel mt-6 p-5" aria-labelledby="create-colour-gallery-title"><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--admin-gold)]">Media & galleries</p><h3 id="create-colour-gallery-title" className="admin-display mt-1 text-2xl">Colour galleries</h3><p className="mt-2 text-xs text-[var(--admin-muted)]">Add the first colour here, then attach its WorkDrive images immediately.</p><div className="mt-4 flex flex-wrap items-center gap-2"><input aria-label="New colour" value={newColour} onChange={(event) => setNewColour(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addColour(); } }} className="admin-field min-w-48 flex-1" placeholder="e.g. Red"/><input aria-label="New colour hex code" value={newColourHex} onChange={(event) => setNewColourHex(event.target.value)} placeholder="#RRGGBB" maxLength={7} className="admin-field w-28"/><span aria-label="New colour swatch" className="h-5 w-5 rounded-full border border-black/15" style={{ backgroundColor: colourSwatchValue(newColour, newColourHex ? { [normalizeColourSwatchName(newColour)]: newColourHex } : {}) || "#b7aa99" }} /><button type="button" onClick={() => void addColour()} disabled={addingColour} className="admin-button-primary px-4 py-2 text-xs disabled:opacity-50">Add colour</button></div>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}</section>;
  }

  const replaceGallery = (next: CatalogMedia[]) => {
    const retained = value.filter((item) => item.variant_id !== selected.id);
    onChange([...retained, ...next.map((item, position) => ({ ...item, position }))]);
  };
  const addBatch = () => {
    const parsed = parseWorkDriveBatch(batch);
    if (parsed.error || !parsed.entries.length) {
      setError(parsed.error || "Paste at least one approved WorkDrive link.");
      return;
    }
    const existing = new Set(value.map((item) => String(item.permalink || item.url || "").toLowerCase()));
    if (parsed.entries.some((item) => existing.has(item.permalink.toLowerCase()))) {
      setError("Each WorkDrive image may be attached only once to this product.");
      return;
    }
    const added = parsed.entries.map((item, index) => ({
      id: `${selected.id}:draft:${Date.now()}:${index}`,
      media_id: `${selected.id}:draft:${Date.now()}:${index}`,
      provider: "zoho_workdrive" as const,
      permalink: item.permalink,
      url: item.permalink,
      alt_text: item.alt_text,
      variant_id: selected.id,
      colour_slug: selected.colourSlug,
      colour: selected.colour,
      position: gallery.length + index,
      is_primary: gallery.length === 0 && index === 0,
      is_hover: false,
    }));
    replaceGallery([...gallery, ...added]);
    setBatch("");
    setError("");
  };
  const update = (identity: string, changes: Partial<CatalogMedia>) => replaceGallery(gallery.map((item) => item.media_id === identity ? { ...item, ...changes } : item));
  const selectFlag = (identity: string, flag: "is_primary" | "is_hover") => replaceGallery(gallery.map((item) => ({ ...item, [flag]: item.media_id === identity })));
  const move = (index: number, delta: number) => {
    const next = [...gallery];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    replaceGallery(next);
  };

  return <section className="admin-panel mt-6 overflow-hidden" aria-labelledby="create-colour-gallery-title">
    <div className="border-b border-[var(--admin-border)] px-5 pt-5">
      <p className="text-[10px] font-semibold uppercase tracking-[.2em] text-[var(--admin-gold)]">Media & galleries</p>
      <h3 id="create-colour-gallery-title" className="admin-display mt-1 text-2xl">Colour galleries</h3>
      <p className="mt-1 text-xs text-[var(--admin-muted)]">Draft images are validated now and persisted with the product on first save.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2"><input aria-label="New colour" value={newColour} onChange={(event) => setNewColour(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void addColour(); } }} className="admin-field min-w-40 flex-1" placeholder="Add another colour"/><input aria-label="New colour hex code" value={newColourHex} onChange={(event) => setNewColourHex(event.target.value)} placeholder="#RRGGBB" maxLength={7} className="admin-field w-28"/><span aria-label="New colour swatch" className="h-5 w-5 rounded-full border border-black/15" style={{ backgroundColor: colourSwatchValue(newColour, newColourHex ? { [normalizeColourSwatchName(newColour)]: newColourHex } : {}) || "#b7aa99" }} /><button type="button" onClick={() => void addColour()} disabled={addingColour} className="admin-button-secondary px-4 py-2 text-xs disabled:opacity-50">Add colour</button></div>
      <div className="mt-5 flex gap-2 overflow-x-auto" role="tablist">
        {variants.map((variant) => <button key={variant.id} type="button" role="tab" aria-selected={variant.id === selected.id} onClick={() => { setVariantId(variant.id); setError(""); }} className={`min-w-36 rounded-t-xl border border-b-0 px-4 py-3 text-left ${variant.id === selected.id ? "border-[#c69a62]/55 bg-[#fbf4e9]" : "border-transparent text-[var(--admin-muted)]"}`}><span className="text-sm font-medium capitalize">{variant.colour}</span><span className="mt-1 block text-[10px] uppercase tracking-[.12em]">{value.filter((item) => item.variant_id === variant.id).length} images</span></button>)}
      </div>
    </div>
    <div className="p-5">
      <div className="mb-5 flex flex-wrap items-end gap-2 rounded-xl border border-[var(--admin-border)] bg-white/55 p-3">
        <label className="min-w-48 flex-1 text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Rename {selected.colour}<input value={editingColour} onChange={(event) => setEditingColour(event.target.value)} className="admin-field mt-1 h-9 min-h-0 text-xs" placeholder={selected.colour}/></label>
        <button type="button" onClick={renameColour} className="admin-button-secondary px-3 py-2 text-xs">Rename</button>
        <button type="button" onClick={removeColour} className="rounded-lg border border-red-200 px-3 py-2 text-xs text-red-700 hover:bg-red-50">Remove colour</button>
      </div>
      {gallery.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{gallery.map((item, index) => <article key={item.media_id} className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)]"><div className="aspect-[4/3] bg-[#eee8de]"><DraftMediaPreview url={item.permalink || ""} label={item.alt_text || `Product image ${index + 1}`} token={token}/></div><div className="p-3"><input aria-label={`WorkDrive link for image ${index + 1}`} value={item.permalink || ""} onChange={(event) => update(item.media_id, { permalink: event.target.value, url: event.target.value })} className="admin-field h-9 min-h-0 text-xs"/><input aria-label={`Filename for image ${index + 1}`} value={item.alt_text || ""} onChange={(event) => update(item.media_id, { alt_text: event.target.value })} className="admin-field mt-2 h-9 min-h-0 text-xs" placeholder={`Image ${index + 1}`}/><div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><label><input type="radio" name={`create-primary-${selected.id}`} checked={item.is_primary === true} onChange={() => selectFlag(item.media_id, "is_primary")}/> Primary</label><label><input type="radio" name={`create-hover-${selected.id}`} checked={item.is_hover === true} onChange={() => selectFlag(item.media_id, "is_hover")}/> Hover</label><span className="ml-auto flex gap-1"><button type="button" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move image up"><ArrowUp size={14}/></button><button type="button" disabled={index === gallery.length - 1} onClick={() => move(index, 1)} aria-label="Move image down"><ArrowDown size={14}/></button><button type="button" onClick={() => replaceGallery(gallery.filter((entry) => entry.media_id !== item.media_id))} aria-label="Remove image" className="text-red-600"><Trash2 size={14}/></button></span></div></div></article>)}</div> : <div className="grid min-h-32 place-items-center rounded-xl border border-dashed border-[#9a7a4d]/35 bg-[#fbf8f2] text-center"><div><ImagePlus size={22} className="mx-auto text-[#a8793d]"/><p className="mt-2 text-sm font-medium">No {selected.colour} images yet</p></div></div>}
      <textarea value={batch} onChange={(event) => setBatch(event.target.value)} className="admin-field mt-5 min-h-28 text-xs" placeholder="Filename.jpg - https://workdrive.zoho.in/file/..."/>
      <div className="mt-3 flex justify-end"><button type="button" onClick={addBatch} className="admin-button-secondary px-4 py-2 text-xs">Preview links</button></div>
      {error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}
    </div>
  </section>;
}

export function CreateProductLevelMediaEditor({ value, onChange, token }: Pick<Props, "value" | "onChange" | "token">) {
  const [batch, setBatch] = useState("");
  const [error, setError] = useState("");
  const gallery = value.filter((item) => !item.variant_id).sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
  const replaceGallery = (next: CatalogMedia[]) => onChange([
    ...value.filter((item) => item.variant_id),
    ...next.map((item, position) => ({ ...item, position })),
  ]);
  const addBatch = () => {
    const parsed = parseWorkDriveBatch(batch);
    if (parsed.error || !parsed.entries.length) { setError(parsed.error || "Paste at least one approved WorkDrive link."); return; }
    const existing = new Set(value.map((item) => String(item.permalink || item.url || "").toLowerCase()));
    if (parsed.entries.some((item) => existing.has(item.permalink.toLowerCase()))) { setError("Each WorkDrive image may be attached only once to this product."); return; }
    const nonce = Date.now();
    replaceGallery([...gallery, ...parsed.entries.map((item, index) => ({
      id: `product:draft:${nonce}:${index}`,
      media_id: `product:draft:${nonce}:${index}`,
      provider: "zoho_workdrive" as const,
      permalink: item.permalink,
      url: item.permalink,
      alt_text: item.alt_text,
      position: gallery.length + index,
      is_primary: gallery.length === 0 && index === 0,
      is_hover: false,
    }))]);
    setBatch(""); setError("");
  };
  const selectFlag = (identity: string, flag: "is_primary" | "is_hover") => replaceGallery(gallery.map((item) => ({ ...item, [flag]: item.media_id === identity })));
  const move = (index: number, delta: number) => { const next = [...gallery]; const target = index + delta; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; replaceGallery(next); };
  return <section className="admin-panel mt-6 p-5"><p className="text-sm font-medium">Product images</p><p className="mt-2 text-xs text-[var(--admin-muted)]">Optional general images for products without colour galleries. Colour-specific products should use the galleries above.</p>
    {gallery.length ? <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{gallery.map((item, index) => <article key={item.media_id} className="overflow-hidden rounded-xl border border-[var(--admin-border)] bg-[var(--admin-surface-muted)]"><div className="aspect-[4/3] bg-[#eee8de]"><DraftMediaPreview url={item.permalink || ""} label={item.alt_text || `Product image ${index + 1}`} token={token}/></div><div className="p-3"><input aria-label={`General WorkDrive link ${index + 1}`} value={item.permalink || ""} onChange={(event) => replaceGallery(gallery.map((entry) => entry.media_id === item.media_id ? {...entry, permalink:event.target.value, url:event.target.value} : entry))} className="admin-field h-9 min-h-0 text-xs"/><div className="mt-3 flex flex-wrap items-center gap-3 text-xs"><label><input type="radio" name="create-product-primary" checked={item.is_primary === true} onChange={() => selectFlag(item.media_id, "is_primary")}/> Primary</label><label><input type="radio" name="create-product-hover" checked={item.is_hover === true} onChange={() => selectFlag(item.media_id, "is_hover")}/> Hover</label><span className="ml-auto flex gap-1"><button type="button" disabled={index === 0} onClick={() => move(index,-1)} aria-label="Move general image up"><ArrowUp size={14}/></button><button type="button" disabled={index === gallery.length - 1} onClick={() => move(index,1)} aria-label="Move general image down"><ArrowDown size={14}/></button><button type="button" onClick={() => replaceGallery(gallery.filter((entry) => entry.media_id !== item.media_id))} aria-label="Remove general image" className="text-red-600"><Trash2 size={14}/></button></span></div></div></article>)}</div> : null}
    <textarea value={batch} onChange={(event) => setBatch(event.target.value)} className="admin-field mt-4 min-h-24 text-xs" placeholder="Optional product-level WorkDrive links"/><div className="mt-3 flex justify-end"><button type="button" onClick={addBatch} className="admin-button-secondary px-4 py-2 text-xs">Preview product images</button></div>{error ? <p role="alert" className="mt-3 text-xs text-red-700">{error}</p> : null}
  </section>;
}
