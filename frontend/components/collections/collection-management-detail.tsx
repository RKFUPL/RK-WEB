"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { ArrowLeft, Image as ImageIcon, Package, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { apiBaseUrl, type StaffPermission } from "@/lib/rbac";
import {
  availabilityLabels,
  adminMediaGroups,
  guardedMediaCleanupPlan,
  inr,
  type CatalogProduct,
  type CollectionHeroConfig,
  type ManagedCollection,
  type ProductAvailability,
} from "@/lib/catalog";
import { formatDate } from "@/lib/date-time";
import {
  buildProductUpdate,
  productDraftFrom,
  verifyMediaRelationshipRemoval,
  verifyProductReadBack,
  type ProductDraft,
} from "@/lib/product-editor";
import { VariantMediaEditor } from "@/components/collections/variant-media-editor";
import { CreateProductLevelMediaEditor, CreateProductMediaEditor } from "@/components/collections/create-product-media-editor";
import { adminMediaRelationshipPreview, INITIAL_MEDIA_RELATIONSHIP_COUNT, visibleMediaRelationships } from "@/lib/admin-media-relationships";

type DetailPayload = {
  collection: ManagedCollection & { products: CatalogProduct[] };
  availableProducts: CatalogProduct[];
  allCollections: ManagedCollection[];
  permissions: StaffPermission[];
};

const inputClass =
  "admin-field mt-2 text-sm";
const isWorkDriveImage = (value: string) => /^https:\/\/workdrive\.zoho(?:external)?\.in\//i.test(value.trim());
type HeroSlide = NonNullable<CollectionHeroConfig["images"]>[number];

type ParsedHeroImage = Pick<HeroSlide, "image" | "alt">;

function parsePastedHeroImages(value: string): ParsedHeroImage[] | null {
  const urlPattern = /https:\/\/workdrive\.zoho(?:external)?\.in\/file\/[^\s]+/gi;
  const matches = [...value.matchAll(urlPattern)];
  if (matches.length < 2) return null;
  const parsed: ParsedHeroImage[] = [];
  let cursor = 0;
  for (const match of matches) {
    const prefix = value.slice(cursor, match.index ?? cursor).trim();
    const alt = prefix.replace(/\s*-\s*$/, "").trim();
    if (!alt || !match[0]) return [];
    parsed.push({ alt, image: match[0] });
    cursor = (match.index ?? cursor) + match[0].length;
  }
  return value.slice(cursor).trim() ? [] : parsed;
}

function HeroSlideEditor({ slide, index, count, token, savedPreview, onChange, onMove, onRemove }: {
  slide: HeroSlide; index: number; count: number; token: string; savedPreview?: string;
  onChange: (changes: Partial<HeroSlide>) => void; onMove: (direction: -1 | 1) => void; onRemove: () => void;
}) {
  const [preview, setPreview] = useState(savedPreview || (!isWorkDriveImage(slide.image) ? slide.image : ""));
  const [previewError, setPreviewError] = useState("");
  useEffect(() => {
    if (!slide.image) { setPreview(""); setPreviewError(""); return; }
    if (!isWorkDriveImage(slide.image)) { setPreview(slide.image); setPreviewError(""); return; }
    if (savedPreview) { setPreview(savedPreview); setPreviewError(""); return; }
    let objectUrl = "";
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/staff/collections/image-preview`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ url: slide.image }), signal: controller.signal });
        if (!response.ok) throw new Error("Preview unavailable");
        objectUrl = URL.createObjectURL(await response.blob());
        setPreview(objectUrl); setPreviewError("");
      } catch { if (!controller.signal.aborted) { setPreview(""); setPreviewError("Secure preview unavailable"); } }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [slide.image, savedPreview, token]);

  return <div className="grid gap-3 rounded-lg border border-black/[.07] p-3 md:grid-cols-2">
    <div className="aspect-video w-full max-w-md overflow-hidden rounded-md bg-[#efece6] md:col-span-2">{preview ? <img src={preview} alt={slide.alt || `Hero slide ${index + 1} preview`} className="h-full w-full object-cover" onError={() => { setPreview(""); setPreviewError("Preview unavailable"); }} /> : <div className="grid h-full place-items-center text-xs text-[#8a7b68]">{previewError || "Add an image URL to preview"}</div>}</div>
    <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">Slide desktop image URL<input required value={slide.image} onChange={(event) => onChange({ image: event.target.value })} className={inputClass} /></label>
    <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Optional slide mobile image URL<input value={slide.mobileImage || ""} onChange={(event) => onChange({ mobileImage: event.target.value })} className={inputClass} /></label>
    <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Alt text<input value={slide.alt || ""} onChange={(event) => onChange({ alt: event.target.value })} className={inputClass} /></label>
    <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Desktop position<input value={slide.desktopObjectPosition || "center center"} onChange={(event) => onChange({ desktopObjectPosition: event.target.value })} className={inputClass} /></label>
    <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Mobile position<input value={slide.mobileObjectPosition || "center center"} onChange={(event) => onChange({ mobileObjectPosition: event.target.value })} className={inputClass} /></label>
    <div className="flex flex-wrap items-center gap-2 md:col-span-2"><button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="rounded border border-black/10 px-3 py-2 text-xs disabled:opacity-30">Move up</button><button type="button" disabled={index === count - 1} onClick={() => onMove(1)} className="rounded border border-black/10 px-3 py-2 text-xs disabled:opacity-30">Move down</button><button type="button" onClick={onRemove} className="ml-auto inline-flex items-center gap-2 rounded border border-red-200 px-3 py-2 text-xs text-red-700"><Trash2 size={13} /> Remove</button></div>
  </div>;
}
const availabilityOptions: ProductAvailability[] = [
  "in_stock",
  "custom_order",
  "sold_out",
];
const T1_ID = "6ac91677140d396488cdc687";
const T1_STALE_MEDIA_IDS = new Set([
  "54810cc923b41e35020f31db18aec929",
  "2bd1d35e3b960296cf9e11bed471c781",
  "c8b26e803882073a7b9306b87b4c04f5",
]);

function colourVariants(value: string): CatalogProduct["variants"] {
  const seen = new Set<string>();
  return value.split(",").map((colour) => colour.trim()).filter((colour) => {
    const key = colour.toLocaleLowerCase();
    return Boolean(key) && !seen.has(key) && Boolean(seen.add(key));
  }).map((colour) => {
    const colourSlug = colour.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return { id: `colour:${colourSlug}`, sku: "Assigned after creation", colour, colourSlug, images: [], imageMeta: [], status: "active" as const, currency: "INR" as const, sizes: [], sizeInventory: [] };
  });
}

type CreateProductResult = { id?: string; product?: CatalogProduct; error?: string; code?: string; existingProduct?: { id: string; name?: string; sku?: string }; existingVariant?: { id: string; colour?: string; sku?: string }; newColours?: string[] };

function CreateProductDrawer({
  collection,
  busy,
  onClose,
  onCreate,
  onVerify,
  onOpenVariant,
}: {
  collection: ManagedCollection;
  busy: boolean;
  onClose: () => void;
  onCreate: (payload: Record<string, unknown>) => Promise<CreateProductResult>;
  onVerify: (id: string) => Promise<CatalogProduct | undefined>;
  onOpenVariant: (productId: string, variantId?: string) => Promise<void>;
}) {
  const [activeSection, setActiveSection] = useState<"overview" | "media" | "details" | "pricing">("overview");
  const [draft, setDraft] = useState({ name: "", sku: "", price: "", stock: "0", availability: "in_stock" as ProductAvailability, category: "", description: "", sizes: "", colors: "", fabric: "", occasion: "", gender: "", material: "", customizationInformation: "" });
  const [media, setMedia] = useState<NonNullable<CatalogProduct["catalogMedia"]>>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [createdId, setCreatedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [duplicate, setDuplicate] = useState<{ product: { id: string; name?: string; sku?: string }; colour: string; variantId?: string; exact: boolean } | null>(null);
  const variants = useMemo(() => colourVariants(draft.colors) || [], [draft.colors]);
  const addDraftColour = (value: string) => {
    const colour = value.trim();
    if (!colour) return undefined;
    const current = draft.colors.split(",").map((item) => item.trim()).filter(Boolean);
    if (current.some((item) => item.toLocaleLowerCase() === colour.toLocaleLowerCase())) return undefined;
    const colourSlug = colour.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!colourSlug) return undefined;
    setDraft((state) => ({ ...state, colors: [...current, colour].join(", ") }));
    return `colour:${colourSlug}`;
  };
  const renameDraftColour = (variantId: string, value: string) => {
    const colour = value.trim();
    const colourSlug = colour.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const current = colourVariants(draft.colors) || [];
    if (!colourSlug || current.some((item) => item.id !== variantId && item.colour.toLocaleLowerCase() === colour.toLocaleLowerCase())) return undefined;
    const nextId = `colour:${colourSlug}`;
    setDraft((state) => ({ ...state, colors: current.map((item) => item.id === variantId ? colour : item.colour).join(", ") }));
    setMedia((items) => items.map((item) => item.variant_id === variantId ? { ...item, variant_id: nextId, colour, colour_slug: colourSlug } : item));
    return nextId;
  };
  const removeDraftColour = (variantId: string) => {
    const current = colourVariants(draft.colors) || [];
    if (!current.some((item) => item.id === variantId)) return false;
    setDraft((state) => ({ ...state, colors: current.filter((item) => item.id !== variantId).map((item) => item.colour).join(", ") }));
    setMedia((items) => items.filter((item) => item.variant_id !== variantId));
    return true;
  };
  const updateDraftColours = (value: string) => {
    const before = colourVariants(draft.colors) || [];
    const after = colourVariants(value) || [];
    setDraft((state) => ({ ...state, colors: value }));
    setMedia((items) => items.map((item) => {
      const index = before.findIndex((variant) => variant.id === item.variant_id);
      const replacement = index >= 0 ? after[index] : undefined;
      return replacement ? { ...item, variant_id: replacement.id, colour: replacement.colour, colour_slug: replacement.colourSlug } : item;
    }));
  };
  const dirty = Object.values(draft).some((value) => value !== "" && value !== "0" && value !== "in_stock") || media.length > 0;
  const requestClose = () => { if (saving) return; if (dirty && !window.confirm("Discard this unsaved product draft?")) return; onClose(); };

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener("keydown", onKey); };
  }, [dirty, saving]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError(""); setMessage(""); setSaving(true);
    try {
      if (createdId) {
        const verified = await onVerify(createdId);
        if (!verified) throw new Error("The product was created, but read-back is still unavailable. Do not create it again; use Verify saved product.");
        onClose();
        return;
      }
      const name = draft.name.trim();
      const sku = draft.sku.trim().toUpperCase();
      const price = Number(draft.price);
      const stock = Number(draft.stock);
      if (!name) throw new Error("Product name is required.");
      if (!sku) throw new Error("A unique style code / SKU is required.");
      if (draft.price.trim() === "" || !Number.isFinite(price) || price < 0) throw new Error("Base price must be a non-negative number.");
      if (!Number.isInteger(stock) || stock < 0) throw new Error("Opening stock must be a non-negative whole number.");
      const sizes = draft.sizes.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean);
      const enteredColours = draft.colors.split(",").map((item) => item.trim()).filter(Boolean);
      if (enteredColours.length !== variants.length) throw new Error("Colour names must be unique after ignoring case and whitespace.");
      const variantIds = new Set(variants.map((variant) => variant.id));
      if (media.some((item) => item.variant_id && !variantIds.has(item.variant_id))) throw new Error("A draft image belongs to a removed colour. Restore that colour or remove the image before creating the product.");
      if (sizes.some((size) => !["XS", "S", "M", "L", "XL"].includes(size))) throw new Error("Sizes must use XS, S, M, L or XL.");
      if (sizes.length && stock !== 0) throw new Error("Opening stock for size-managed products must be allocated per size after creation. Use 0 for the initial product.");
      const result = await onCreate({ name, sku, styleCode: sku, price, stock, status: "draft", availability: draft.availability, category: draft.category.trim(), description: draft.description.trim(), collectionId: collection.id, attributes: { sizes, colors: variants.map((variant) => variant.colour), fabric: draft.fabric.trim(), occasion: draft.occasion.trim(), gender: draft.gender.trim(), material: draft.material.trim(), customizationInformation: draft.customizationInformation.trim() }, sizeInventoryConfigured: sizes.length > 0, sizeInventory: sizes.map((size) => ({ size, stock: 0, enabled: true })), media: media.map((item) => ({ ...item, id: undefined, media_id: undefined })) });
      if (result.code === "SKU_COLOUR_CONFLICT" && result.existingProduct) {
        setDuplicate({ product: result.existingProduct, colour: result.newColours?.[0] || "COLOUR", exact: !result.newColours?.length, variantId: result.existingVariant?.id });
        return;
      }
      if (result.id) setCreatedId(result.id);
      if (result.error) throw new Error(result.error);
      if (!result.product) throw new Error("The product was created, but authoritative read-back is unavailable. Your draft remains open; do not submit it again.");
      onClose();
    } catch (value) { setError(value instanceof Error ? value.message : "Unable to create product."); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px]" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><aside role="dialog" aria-modal="true" aria-labelledby="create-product-title" className="ml-auto flex h-full w-full max-w-[min(1120px,94vw)] flex-col overflow-hidden bg-[#f5f1eb] text-[#20242b] shadow-[-24px_0_80px_rgba(32,25,18,.18)]"><header className="flex shrink-0 items-start justify-between border-b border-black/[.07] bg-[#fffdf9]/95 px-5 py-5 sm:px-8"><div><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Product management · Create</p><h2 id="create-product-title" className="admin-display mt-2 text-3xl leading-none">{draft.name || "New product"}</h2><p className="mt-1 text-xs text-[#8a9098]">New centralized product · {collection.name}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => (document.getElementById("product-create-form") as HTMLFormElement | null)?.requestSubmit()} disabled={busy || saving} className="admin-button-primary px-4 py-2 text-xs disabled:opacity-40">{saving ? "Creating…" : createdId ? "Verify saved product" : "Create product"}</button><button type="button" onClick={requestClose} aria-label="Close product creation" className="rounded-lg p-2 hover:bg-black/5"><X size={18}/></button></div></header><nav aria-label="Product editor sections" role="tablist" className="flex shrink-0 gap-1 overflow-x-auto border-b border-black/[.07] bg-[#fffdf9] px-4 py-3 text-xs sm:px-8">{([['overview','Overview'],['media','Media & galleries'],['details','Details'],['pricing','Pricing & inventory']] as const).map(([id,label]) => <button key={id} type="button" role="tab" aria-selected={activeSection === id} onClick={() => setActiveSection(id)} className={`whitespace-nowrap rounded-lg px-3 py-2 ${activeSection === id ? "bg-[#efe4d5] font-medium text-[#7d582c]" : "text-[#6f675f] hover:bg-black/[.035]"}`}>{label}</button>)}</nav><form id="product-create-form" onSubmit={submit} className="flex-1 overflow-y-auto p-4 sm:p-8">
    {activeSection === "overview" ? <section className="admin-panel p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--admin-gold)]">Product identity</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Product name<input autoFocus value={draft.name} onChange={(event) => setDraft((current) => ({...current,name:event.target.value}))} className={inputClass}/></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Style code / SKU<input value={draft.sku} onChange={(event) => setDraft((current) => ({...current,sku:event.target.value}))} className={inputClass}/></label></div></section> : null}
    {activeSection === "details" ? <section className="admin-panel p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--admin-gold)]">Product details</p><div className="mt-4 grid gap-4 sm:grid-cols-2">{[["category","Category"],["sizes","Sizes · comma separated"],["colors","Colours · comma separated"],["fabric","Fabric"],["occasion","Occasion"],["gender","Gender"],["material","Material"],["customizationInformation","Customization information"]].map(([key,label]) => <label key={key} className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">{label}<input value={draft[key as keyof typeof draft]} onChange={(event) => key === "colors" ? updateDraftColours(event.target.value) : setDraft((current) => ({...current,[key]:event.target.value}))} className={inputClass}/></label>)}<label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098] sm:col-span-2">Description<textarea rows={4} value={draft.description} onChange={(event) => setDraft((current) => ({...current,description:event.target.value}))} className={inputClass}/></label></div></section> : null}
    {activeSection === "media" ? <><CreateProductMediaEditor variants={variants || []} value={media} onChange={setMedia} token={() => window.localStorage.getItem("rk_access_token") ?? ""} onAddColour={addDraftColour} onRenameColour={renameDraftColour} onRemoveColour={removeDraftColour}/><CreateProductLevelMediaEditor value={media} onChange={setMedia} token={() => window.localStorage.getItem("rk_access_token") ?? ""}/></> : null}
    {activeSection === "pricing" ? <section className="admin-panel p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--admin-gold)]">Pricing & inventory</p><div className="mt-4 grid gap-4 sm:grid-cols-3"><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Base INR price<input type="number" min="0" step="0.01" value={draft.price} onChange={(event) => setDraft((current) => ({...current,price:event.target.value}))} className={inputClass}/></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Availability<select value={draft.availability} onChange={(event) => setDraft((current) => ({...current,availability:event.target.value as ProductAvailability}))} className={inputClass}>{availabilityOptions.map((option) => <option key={option} value={option}>{availabilityLabels[option]}</option>)}</select></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Opening stock<input type="number" min="0" step="1" value={draft.stock} onChange={(event) => setDraft((current) => ({...current,stock:event.target.value}))} className={inputClass}/></label></div><p className="mt-4 text-xs text-[var(--admin-muted)]">Inventory adjustments remain audited after creation. Size-managed products start at zero until quantities are allocated per size.</p></section> : null}
    {message ? <p className="mt-4 text-sm text-emerald-700">{message}</p> : null}{error ? <p role="alert" className="mt-4 text-sm text-red-700">{error}</p> : null}
  </form></aside>{duplicate ? <div className="fixed inset-0 z-[120] grid place-items-center bg-black/35 p-4"><div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-2xl bg-[#fffdf9] p-6 text-[#20242b] shadow-2xl"><p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">Catalogue match</p><h3 className="mt-2 font-display text-2xl">{duplicate.exact ? "Colour already exists" : "Add a new colour"}</h3><p className="mt-4 text-sm leading-6">{duplicate.exact ? <>Colour <strong>{duplicate.colour}</strong> is already registered on product <strong>{duplicate.product.name || "Unnamed product"}</strong> ({duplicate.product.sku || "no product code"}).</> : <>Colour <strong>{duplicate.colour}</strong> is new for product <strong>{duplicate.product.name || "Unnamed product"}</strong> ({duplicate.product.sku || "no product code"}). It will be added using that existing product code.</>}</p><p className="mt-2 text-sm leading-6 text-[#6f675f]">{duplicate.exact ? "Open the existing colour to manage its photos, or cancel without changing anything." : "Add this colour to the existing product, then manage its photos from the Media & galleries section."}</p><div className="mt-6 flex flex-wrap justify-end gap-2"><button type="button" onClick={() => setDuplicate(null)} className="admin-button-secondary px-4 py-2 text-xs">Cancel</button>{duplicate.exact ? <button type="button" onClick={() => { setDuplicate(null); onOpenVariant(duplicate.product.id, duplicate.variantId); }} className="admin-button-primary px-4 py-2 text-xs">Open existing colour</button> : <button type="button" onClick={async () => { setSaving(true); try { const endpoint = `/api/staff/products/${encodeURIComponent(duplicate.product.id)}/variants`; const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${window.localStorage.getItem("rk_access_token") || ""}`, "Content-Type": "application/json" }, body: JSON.stringify({ colour: duplicate.colour }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(String(payload.error || `Unable to add colour (HTTP ${response.status}).`)); setDuplicate(null); onOpenVariant(duplicate.product.id, payload.variant?.id); } catch (value) { setError(value instanceof Error ? value.message : "Unable to add colour."); } finally { setSaving(false); } }} className="admin-button-primary px-4 py-2 text-xs">Add colour to existing product</button>}</div></div></div> : null}</div>;
}

function configuredMediaEntries(product: CatalogProduct) {
  const groups = adminMediaGroups(product);
  const variantNames = new Map((product.variants || []).map((variant) => [variant.id, variant.colour || variant.id]));
  return [
    ...groups.unassigned.map((item) => ({ ...item, label: item.label || "Unassigned product image", scope: "Unassigned" })),
    ...Object.entries(groups.variants).flatMap(([variantId, items]) =>
      items.map((item) => ({ ...item, label: item.label || `${variantNames.get(variantId) || variantId} image`, scope: variantNames.get(variantId) || variantId })),
    ),
  ];
}

function MediaRelationshipCard({ productId, entry, index, primary, deleting, onRemove }: {
  productId: string;
  entry: ReturnType<typeof configuredMediaEntries>[number];
  index: number;
  primary: boolean;
  deleting: boolean;
  onRemove: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const preview = adminMediaRelationshipPreview(productId, entry);
  useEffect(() => setFailed(false), [preview]);
  return <li className="overflow-hidden rounded-xl border border-black/[.07] bg-[#fffdf9] dark:border-white/[.08] dark:bg-white/[.02]">
    <div className="relative aspect-[4/3] overflow-hidden bg-[#eee8de] dark:bg-white/[.04]">
      {preview && !failed ? <img src={preview} alt={entry.label || `Product image ${index + 1}`} loading="lazy" decoding="async" className="h-full w-full object-cover object-center" onError={() => setFailed(true)} /> : <div className="grid h-full place-items-center px-4 text-center text-[10px] uppercase tracking-[.14em] text-[#8a9098]">{failed ? 'Preview unavailable' : 'Image preview unavailable'}</div>}
      <span className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-white/90 text-[10px] text-[#9a7a4d] shadow">{index + 1}</span>
      {primary ? <span className="absolute right-2 top-2 rounded-full bg-emerald-700 px-2 py-1 text-[8px] uppercase tracking-[.12em] text-white">Primary</span> : null}
    </div>
    <div className="flex min-h-24 items-start gap-3 p-3">
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{entry.label || `WorkDrive image ${index + 1}`}</p><p className="mt-1 text-[9px] uppercase tracking-[.12em] text-[#8a9098]">{entry.scope}</p></div>
      <button type="button" aria-label={`Remove ${entry.label || `image ${index + 1}`} from ${entry.scope}`} title={`Remove from ${entry.scope}`} disabled={deleting} onClick={onRemove} className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-red-200 text-red-600 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-wait disabled:opacity-40"><Trash2 size={14} className={deleting ? "animate-pulse" : ""} /></button>
    </div>
  </li>;
}

function valueOrDash(value: unknown) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function statusLabel(status: string) {
  return status === "collection" || status === "active" ? "Collection" : status;
}

function parentCode(product: CatalogProduct) {
  return product.styleCode || product.productCode || product.parentSku || product.sku || "";
}

function adminProductPreview(product: CatalogProduct) {
  const ordered = [...(product.catalogMedia || [])].sort((left, right) => Number(Boolean(right.is_primary)) - Number(Boolean(left.is_primary)) || Number(left.position || 0) - Number(right.position || 0));
  for (const item of ordered) {
    const relationshipId = String(item.media_id || item.id || "").trim();
    if (item.provider === "zoho_workdrive" && relationshipId) return `/api/staff/products/${encodeURIComponent(product.id)}/media/${encodeURIComponent(relationshipId)}`;
    const direct = String(item.renderUrl || item.secure_url || item.url || "").trim();
    if (direct && !isWorkDriveImage(direct)) return direct;
  }
  return (product.media || []).find((source) => source.startsWith("/") || (source.startsWith("https://") && !isWorkDriveImage(source))) || "";
}

function ProductDrawer({
  product,
  collection,
  collections,
  canManageProducts,
  canManageInventory,
  busy,
  onClose,
  onReload,
  onRemove,
  initialSection,
  initialVariantId,
}: {
  product: CatalogProduct;
  collection: ManagedCollection;
  collections: ManagedCollection[];
  canManageProducts: boolean;
  canManageInventory: boolean;
  busy: boolean;
  onClose: () => void;
  onReload: () => Promise<DetailPayload | undefined>;
  onRemove: () => Promise<void>;
  initialSection?: "overview" | "media" | "details" | "pricing";
  initialVariantId?: string;
}) {
  const attributes = product.attributes ?? {};
  const [editing, setEditing] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "media" | "details" | "pricing">(initialSection || "overview");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [targetCollection, setTargetCollection] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [overviewImageFailed, setOverviewImageFailed] = useState(false);
  const [showAllMediaRelationships, setShowAllMediaRelationships] = useState(false);
  const saveInFlight = useRef(false);
  const [baseline, setBaseline] = useState(product);
  const [form, setForm] = useState<ProductDraft>(() => productDraftFrom(product));
  const token = () => window.localStorage.getItem("rk_access_token") ?? "";
  const mediaGroups = adminMediaGroups(product);
  const mediaEntries = configuredMediaEntries(product);
  const visibleMediaEntries = visibleMediaRelationships(mediaEntries, showAllMediaRelationships);
  const overviewImage = adminProductPreview(product);
  const cleanupPlan = guardedMediaCleanupPlan(product, T1_ID, T1_STALE_MEDIA_IDS);
  const canCleanT1Media = cleanupPlan !== null;
  const editDirty = editing && JSON.stringify(form) !== JSON.stringify(productDraftFrom(baseline));
  const requestClose = () => {
    if (saveInFlight.current) return;
    if (editDirty && !window.confirm("Discard unsaved product changes?")) return;
    onClose();
  };
  useEffect(() => setOverviewImageFailed(false), [overviewImage]);
  useEffect(() => setShowAllMediaRelationships(false), [product.id]);
  const submitProductForm = () => {
    (document.getElementById("product-edit-form") as HTMLFormElement | null)?.requestSubmit();
  };

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") requestClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, editDirty]);

  useEffect(() => {
    setBaseline(product);
    setForm(productDraftFrom(product));
    setEditing(false);
    setError("");
    setMessage("");
  }, [product.id]);

  const cleanT1Media = async () => {
    if (!canCleanT1Media || !cleanupPlan) return;
    if (!window.confirm("Remove exactly the three verified unassigned T1 media relationships? Red and Blue colour galleries and the underlying WorkDrive files will remain unchanged.")) return;
    setError("");
    setMessage("");
    setCleanupBusy(true);
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/resources/products/${product.id}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ media: cleanupPlan }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Unable to remove stale T1 media.");
      const remaining = payload.item?.catalogMedia || [];
      const remainingIds = new Set(remaining.map((item: { media_id?: string; id?: string }) => String(item.media_id || item.id || "")));
      if ([...T1_STALE_MEDIA_IDS].some((id) => remainingIds.has(id))) throw new Error("Cleanup response still contains one or more stale T1 media relationships.");
      const expectedVariantIds = new Set((product.catalogMedia || []).filter((item) => item.variant_id).map((item) => String(item.media_id || item.id || "")));
      if ([...expectedVariantIds].some((id) => !remainingIds.has(id))) throw new Error("Cleanup response did not preserve every colour-gallery media relationship.");
      await onReload();
      setMessage("T1 stale media removed.");
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to remove stale T1 media.");
    } finally {
      setCleanupBusy(false);
    }
  };

  const removeMediaRelationship = async (entry: ReturnType<typeof configuredMediaEntries>[number]) => {
    if (deletingMediaId) return;
    const filename = entry.label || "WorkDrive image";
    if (!window.confirm(`Remove “${filename}” from ${entry.scope}? The WorkDrive file itself will not be deleted.`)) return;
    setError("");
    setMessage("");
    setDeletingMediaId(entry.identity);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/products/${product.id}/media/${encodeURIComponent(entry.identity)}`,
        { method: "DELETE", headers: { Authorization: `Bearer ${token()}` } },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `Unable to remove image relationship (HTTP ${response.status}).`);
      }
      const verification = await verifyMediaRelationshipRemoval(async () => {
        const refreshed = await onReload();
        return refreshed?.collection.products.find((item) => item.id === product.id);
      }, entry.identity);
      if (verification.status === "unavailable") {
        throw new Error("The relationship was accepted for removal, but the authoritative read-back is temporarily unavailable. Reload before trying again.");
      }
      if (verification.status === "mismatch") {
        throw new Error("The server accepted the request, but the relationship is still present. Reload and try again.");
      }
      setMessage(`Removed “${filename}” from ${entry.scope}. The WorkDrive file was preserved.`);
    } catch (value) {
      setError(value instanceof Error ? value.message : "Unable to remove image relationship.");
    } finally {
      setDeletingMediaId(null);
    }
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saveInFlight.current) return;
    setError("");
    setMessage("");
    const { payload: updates, error: validationError } = buildProductUpdate(baseline, form);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (!Object.keys(updates).length) {
      setForm(productDraftFrom(baseline));
      setMessage("No product changes to save.");
      return;
    }
    saveInFlight.current = true;
    setIsSaving(true);
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/resources/products/${product.id}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(updates),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.error) {
        throw new Error(payload.error ?? `Unable to update product (HTTP ${response.status}).`);
      }
      const verification = await verifyProductReadBack(async () => {
        const refreshed = await onReload();
        return refreshed?.collection.products.find((entry) => entry.id === product.id);
      }, updates);
      if (verification.status === "unavailable") {
        throw new Error("The server accepted the update, but the authoritative read-back is temporarily unavailable. Your draft is still available.");
      }
      if (verification.status === "mismatch") {
        throw new Error(`The server accepted the update, but the stored ${verification.field} does not match your change. Your draft is still available.`);
      }
      setBaseline(verification.product);
      setForm(productDraftFrom(verification.product));
      setEditing(false);
      setMessage("Product changes saved and verified.");
    } catch (value) {
      console.error("Product save failed", value instanceof Error ? value.message : "Unknown error");
      setError(value instanceof Error ? value.message : "Unable to update product.");
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  const adjustStock = async () => {
    const amount = Number(adjustment);
    if (!Number.isInteger(amount) || amount === 0) {
      setError("Enter a non-zero whole-number adjustment.");
      return;
    }
    if (!adjustmentReason.trim()) {
      setError("Enter a reason for the inventory change.");
      return;
    }
    setError("");
    setMessage("");
    const response = await fetch(
      `${apiBaseUrl}/api/staff/resources/inventory/${product.id}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          adjustment: amount,
          reason: adjustmentReason.trim(),
        }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Unable to adjust inventory.");
      return;
    }
    setAdjustment("");
    setAdjustmentReason("");
    setMessage("Inventory adjusted.");
    await onReload();
  };

  const assignElsewhere = async () => {
    const target = collections.find((item) => item.id === targetCollection);
    if (!target) return;
    setError("");
    setMessage("");
    const response = await fetch(
      `${apiBaseUrl}/api/staff/collections/${target.slug}/products`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ productId: product.id }),
      },
    );
    const payload = await response.json();
    if (!response.ok) {
      setError(payload.error ?? "Unable to assign product.");
      return;
    }
    setMessage(`Also assigned to ${target.name}.`);
    setTargetCollection("");
    await onReload();
  };

  const details: Array<[string, unknown]> = [
    ["Product name", product.name],
    ["Style / parent code", parentCode(product)],
    ["Product ID", product.id],
    ["Collection", collection.name],
    ["Category", product.category],
    [
      "Base INR price",
      product.price === undefined ? undefined : inr.format(product.price),
    ],
    ["Displayed currency", "INR"],
    ["Converted price", undefined],
    ["FX rate", undefined],
    ["Availability", availabilityLabels[product.availability]],
    ["Quantity", product.stock],
    [
      "Stock status",
      product.availability === "custom_order"
        ? "Made to order"
        : product.availability === "sold_out"
          ? "No stock"
          : "Available",
    ],
    [
      "Inventory mode",
      product.sizeInventoryConfigured
        ? "Size inventory configured"
        : `Legacy stock · ${product.stock ?? 0} units`,
    ],
    [
      "Size inventory",
      product.sizeInventoryConfigured
        ? product.sizeInventory
            ?.map((entry) => `${entry.size} ${entry.stock}`)
            .join(" · ") || "Configured · no sizes"
        : "Not configured",
    ],
    ["Size", attributes.sizes],
    ["Color", attributes.colors ?? attributes.color],
    ["Fabric", attributes.fabric],
    ["Occasion", attributes.occasion],
    ["Gender", attributes.gender],
    ["Material", attributes.material],
    ["Customization", attributes.customizationInformation],
    ["Description", product.description],
  ];
  const otherCollections = collections.filter(
    (item) =>
      item.id !== collection.id && !product.collectionIds?.includes(item.id),
  );

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/45 backdrop-blur-[1px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-detail-title"
        className="ml-auto flex h-full w-full max-w-[min(1120px,94vw)] flex-col overflow-hidden bg-[#f5f1eb] text-[#20242b] shadow-[-24px_0_80px_rgba(32,25,18,.18)] dark:bg-[#15161a] dark:text-white"
      >
        <header className="z-10 flex shrink-0 items-start justify-between border-b border-black/[.07] bg-[#fffdf9]/95 px-5 py-5 backdrop-blur-xl dark:border-white/[.08] dark:bg-[#15161a]/95 sm:px-8">
          <div>
            <p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">
              Product management
            </p>
            <h2
              id="product-detail-title"
              className="admin-display mt-2 text-3xl leading-none"
            >
              {product.name || "Unnamed product"}
            </h2>
            <p className="mt-1 text-xs text-[#8a9098]">
              Central product record · {product.id}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={() => { if (editing && editDirty && !window.confirm("Discard unsaved product changes?")) return; if (editing) { setForm(productDraftFrom(baseline)); setError(""); setEditing(false); } else { setForm(productDraftFrom(baseline)); setError(""); setMessage(""); setEditing(true); } }} disabled={isSaving} className="admin-button-secondary px-3 py-2 text-xs disabled:opacity-40">{editing ? "Cancel editing" : "Edit"}</button>{editing ? <button type="button" onClick={submitProductForm} disabled={busy || isSaving || !editDirty} className="admin-button-primary px-3 py-2 text-xs disabled:opacity-40">{isSaving ? "Saving…" : "Save changes"}</button> : null}<button type="button" onClick={requestClose} aria-label="Close product details" className="rounded-lg p-2 transition hover:bg-black/5 dark:hover:bg-white/10"><X size={18} /></button></div>
        </header>
        <nav aria-label="Product editor sections" className="z-10 flex shrink-0 gap-1 overflow-x-auto border-b border-black/[.07] bg-[#fffdf9] px-4 py-3 text-xs dark:border-white/[.08] dark:bg-[#15161a] sm:px-8" role="tablist">
          {([['overview','Overview'],['media','Media & galleries'],['details','Details'],['pricing','Pricing & inventory']] as const).map(([section,label]) => <button key={section} type="button" role="tab" aria-selected={activeSection === section} onClick={() => setActiveSection(section)} className={`whitespace-nowrap rounded-lg px-3 py-2 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#a8793d] ${activeSection === section ? "bg-[#efe4d5] font-medium text-[#7d582c]" : "text-[#6f675f] hover:bg-black/[.035] hover:text-[#8a6335] dark:hover:bg-white/5"}`}>{label}</button>)}
        </nav>
        <div className="flex-1 overflow-y-auto p-4 sm:p-8">
          {activeSection === "overview" ? <>
          <div className="admin-panel grid gap-6 p-4 sm:grid-cols-[13rem_1fr] sm:p-5">
            <div className="aspect-[4/5] overflow-hidden rounded-xl border border-black/[.08] bg-[#efece6] dark:border-white/[.08] dark:bg-white/[.04]">
              {overviewImage && !overviewImageFailed ? (
                <img
                  src={overviewImage}
                  alt={product.name || "Product"}
                  className="h-full w-full object-cover"
                  onError={() => setOverviewImageFailed(true)}
                />
              ) : (
                <div className="grid h-full place-items-center text-center text-[#9a7a4d]">
                  <div>
                    <ImageIcon size={26} className="mx-auto" />
                    <p className="mt-2 text-[10px] uppercase tracking-[.15em]">
                      {overviewImageFailed ? "Preview unavailable" : "Image placeholder"}
                    </p>
          </div>
          </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-5 gap-y-4">
              {details.slice(0, 12).map(([label, value]) => (
                <div
                  key={label}
                  className={label === "Product ID" ? "col-span-2" : ""}
                >
                  <p className="text-[9px] uppercase tracking-[.15em] text-[#9a7a4d]">
                    {label}
                  </p>
                  <p className="mt-1 break-words text-xs leading-5 text-[#5f6670] dark:text-[#d4d6da]">
                    {valueOrDash(value)}
                  </p>
                </div>
              ))}
            </div>
          </div>
          {editing ? <form id="product-edit-form" onSubmit={save} className="admin-panel mt-6 p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--admin-gold)]">Edit overview</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Product name<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Style code / SKU<input value={parentCode(baseline)} readOnly className={`${inputClass} cursor-not-allowed opacity-70`} /></label></div></form> : null}
          </> : null}
          {activeSection === "details" ? <section className="admin-panel p-5">
            <p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">
              Future product information
            </p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[details[4], ...details.slice(14)].map(([label, value]) => (
                <div key={label}>
                  <p className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                    {label}
                  </p>
                  <p className="mt-1 text-xs leading-5">{valueOrDash(value)}</p>
                </div>
              ))}
            </div>
          </section> : null}
          {activeSection === "media" ? <section className="admin-panel p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">
                  Product images
                </p>
                <p className="mt-2 text-xs text-[#8a9098]">
                  Ordered media relationships. The first image is primary.
                </p>
              </div>
              <span className="text-xs text-[#9a7a4d]">
                {mediaEntries.length} relationship
                {mediaEntries.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-[.12em] text-[#8a9098]">
              {(product.variants || []).filter((variant) => String(variant.status || "").toLowerCase() !== "remove").map((variant) => <span key={variant.id}>{variant.colour || variant.id}: {mediaGroups.variants[variant.id]?.length || 0}</span>)}
              <span>Unassigned / retained: {mediaGroups.unassigned.length}</span>
            </div>
            {mediaEntries.length ? (
              <>
                <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleMediaEntries.map((entry, index) => <MediaRelationshipCard key={entry.identity} productId={product.id} entry={entry} index={index} primary={index === 0} deleting={Boolean(deletingMediaId)} onRemove={() => void removeMediaRelationship(entry)} />)}
                </ol>
                {mediaEntries.length > INITIAL_MEDIA_RELATIONSHIP_COUNT ? <button type="button" aria-expanded={showAllMediaRelationships} onClick={() => setShowAllMediaRelationships((current) => !current)} className="mt-4 rounded-lg border border-black/10 px-4 py-2 text-xs transition hover:border-[#9a7a4d]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7a4d]/40 dark:border-white/10">{showAllMediaRelationships ? 'Show less' : `View all ${mediaEntries.length} relationships`}</button> : null}
              </>
            ) : (
              <p className="mt-4 text-xs text-[#8a9098]">
                No media relationships remain. Add WorkDrive links in a colour gallery to configure product images.
              </p>
            )}
          </section> : null}
          {message ? (
            <p className="mt-5 text-sm text-emerald-700">{message}</p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-5 text-sm text-red-600">
              {error}
            </p>
          ) : null}
          {activeSection === "details" && editing ? (
            <form
              id="product-edit-form"
              onSubmit={save}
              className="admin-panel mt-6 p-5"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  ["category", "Category"],
                  ["sizes", "Sizes · comma separated"],
                  ["colors", "Colors · comma separated"],
                  ["fabric", "Fabric"],
                  ["occasion", "Occasion"],
                  ["gender", "Gender"],
                  ["material", "Material"],
                  ["customizationInformation", "Customization information"],
                ].map(([key, label]) => (
                  <label
                    key={key}
                    className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]"
                  >
                    {label}
                    <input
                      type="text"
                      value={form[key as keyof typeof form]}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      className={inputClass}
                    />
                  </label>
                ))}
                <label className="sm:col-span-2 text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Description
                  <textarea
                    rows={4}
                    value={form.description}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
              </div>
            </form>
          ) : null}
          {activeSection === "media" && editing ? (
            <form id="product-edit-form" onSubmit={save} className="admin-panel mb-6 p-5">
              <p className="text-xs text-[#8a9098]">
                Product-detail changes are ready to save. Gallery relationships are saved separately below.
              </p>
            </form>
          ) : null}
          {activeSection === "media" && canManageProducts && product.variants?.length ? (
            <VariantMediaEditor productId={product.id} variants={product.variants} token={token} onSaved={onReload} initialVariantId={initialVariantId} />
          ) : null}
          {activeSection === "pricing" && editing ? <form id="product-edit-form" onSubmit={save} className="admin-panel mb-6 p-5"><p className="text-[10px] font-semibold uppercase tracking-[.18em] text-[var(--admin-gold)]">Edit pricing</p><div className="mt-4 grid gap-4 sm:grid-cols-2"><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Base price<input type="number" min="0" step="0.01" value={form.price} onChange={(event) => setForm((current) => ({ ...current, price: event.target.value }))} className={inputClass} /></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Availability<select value={form.availability} onChange={(event) => setForm((current) => ({ ...current, availability: event.target.value as ProductAvailability }))} className={inputClass}>{availabilityOptions.map((option) => <option key={option} value={option}>{availabilityLabels[option]}</option>)}</select></label><label className="text-[10px] uppercase tracking-[.14em] text-[#8a9098]">Style code / SKU<input value={parentCode(baseline)} readOnly className={`${inputClass} cursor-not-allowed opacity-70`} /></label></div></form> : null}
          {(activeSection === "overview" && canManageProducts) || (activeSection === "media" && canManageProducts && canCleanT1Media) || (activeSection === "pricing" && canManageInventory) ? (
            <section className="admin-panel mt-6 p-5">
              <p className="text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]">
                {activeSection === "pricing" ? "Pricing & inventory" : activeSection === "media" ? "Media controls" : "Product actions"}
              </p>
              {activeSection === "overview" ? <div className="mt-4 flex flex-wrap gap-2">
                {canManageProducts ? (
                  <button
                    type="button"
                    onClick={() => void onRemove()}
                    className="rounded-lg border border-red-200 px-4 py-2.5 text-xs text-red-700"
                  >
                    Remove from collection
                  </button>
                ) : null}
              </div> : null}
              {activeSection === "media" && canManageProducts && canCleanT1Media ? <div className="mt-4"><p className="max-w-2xl text-xs leading-5 text-[#8a9098]">This guarded action removes only the exact verified stale parent relationships. It never deletes WorkDrive assets or colour-gallery media.</p>
                    <button
                      type="button"
                      onClick={() => void cleanT1Media()}
                      disabled={busy || cleanupBusy}
                      className="mt-3 rounded-lg border border-red-200 px-4 py-2.5 text-xs text-red-700 disabled:opacity-40"
                    >
                      Remove stale T1 media
                    </button></div> : null}
              {activeSection === "pricing" && canManageInventory ? (
                <><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-[#f8f3ec] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Base price</p><p className="mt-1 text-sm font-medium">{inr.format(product.price || 0)}</p></div><div className="rounded-lg bg-[#f8f3ec] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Style code</p><p className="mt-1 text-sm font-medium">{parentCode(product)}</p></div><div className="rounded-lg bg-[#f8f3ec] p-3"><p className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Current stock</p><p className="mt-1 text-sm font-medium">{product.stock ?? 0}</p></div></div>
                <div className="mt-5 flex flex-wrap items-end gap-2">
                  <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                    Inventory adjustment
                    <input
                      type="number"
                      value={adjustment}
                      placeholder="+ / -"
                      onChange={(event) => setAdjustment(event.target.value)}
                      className={`${inputClass} w-32`}
                    />
                  </label>
                  <label className="min-w-64 text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                    Reason
                    <input
                      value={adjustmentReason}
                      onChange={(event) =>
                        setAdjustmentReason(event.target.value)
                      }
                      placeholder="Required for audited stock changes"
                      className={inputClass}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={busy || !adjustment || !adjustmentReason.trim()}
                    onClick={() => void adjustStock()}
                    className="rounded-lg border border-black/10 px-4 py-2.5 text-xs disabled:opacity-40"
                  >
                    Adjust stock
                  </button>
                </div></>
              ) : null}
              {activeSection === "overview" && canManageProducts && otherCollections.length ? (
                <div className="mt-5 flex flex-wrap items-end gap-2">
                  <label className="min-w-52 text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                    Assign to another collection
                    <select
                      value={targetCollection}
                      onChange={(event) =>
                        setTargetCollection(event.target.value)
                      }
                      className={inputClass}
                    >
                      <option value="">Choose collection</option>
                      {otherCollections.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !targetCollection}
                    onClick={() => void assignElsewhere()}
                    className="rounded-lg border border-black/10 px-4 py-2.5 text-xs disabled:opacity-40"
                  >
                    Assign
                  </button>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

export function CollectionManagementDetail({
  slug,
  basePath,
}: {
  slug: string;
  basePath: "/admin/collections" | "/admin/products" | "/staff/collections";
}) {
  const [data, setData] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [productOpenTarget, setProductOpenTarget] = useState<{ productId: string; variantId?: string } | null>(null);
  const [productRefreshRevision, setProductRefreshRevision] = useState(0);
  const [editingCollection, setEditingCollection] = useState(false);
  const [heroPreviewFailed, setHeroPreviewFailed] = useState(false);
  const [coverPreviewFailed, setCoverPreviewFailed] = useState(false);
  const [draftCoverPreview, setDraftCoverPreview] = useState("");
  const [draftCoverError, setDraftCoverError] = useState("");
  const [adding, setAdding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [existingProductId, setExistingProductId] = useState("");
  const [collectionForm, setCollectionForm] = useState({
    name: "",
    status: "collection",
    description: "",
    coverImage: "",
    heroType: "image",
    heroLayout: "media_dominant",
    heroVideo: "",
    heroPoster: "",
    heroMobileImage: "",
    heroMobileVideo: "",
    heroLabel: "The Collection",
    heroCtaLabel: "Explore Collection",
    season: "",
    year: "",
    designerNote: "",
    collectionNumber: "",
    location: "",
    campaignInformation: "",
  });
  const [collectionBaseline, setCollectionBaseline] = useState<typeof collectionForm | null>(null);
  const [heroImages, setHeroImages] = useState<NonNullable<CollectionHeroConfig["images"]>>([]);
  const [heroImagesBaseline, setHeroImagesBaseline] = useState<NonNullable<CollectionHeroConfig["images"]>>([]);
  const [heroImageParseError, setHeroImageParseError] = useState("");
  const collectionDraftRevision = useRef(0);
  const token = () => window.localStorage.getItem("rk_access_token") ?? "";
  const validHeroImages = heroImages.filter((slide) => slide.image.trim());
  const normalizeCollectionValue = (value: string) => value.trim().replace(/\s+/g, " ");
  const collectionEditableKeys = Object.keys(collectionForm) as Array<keyof typeof collectionForm>;
  const collectionDirty = Boolean(collectionBaseline && (collectionEditableKeys.some((key) => normalizeCollectionValue(collectionForm[key]) !== normalizeCollectionValue(collectionBaseline[key])) || JSON.stringify(validHeroImages) !== JSON.stringify(heroImagesBaseline)));
  useEffect(() => { collectionDraftRevision.current += 1; }, [collectionForm, heroImages]);
  const addHeroImage = () => setHeroImages((items) => [...items, { id: `draft-${crypto.randomUUID()}`, image: "", mobileImage: "", alt: "", desktopObjectPosition: "center center", mobileObjectPosition: "center center" }]);
  const updateHeroImage = (index: number, value: string) => {
    const parsed = parsePastedHeroImages(value);
    if (parsed?.length) {
      setHeroImageParseError("");
      setHeroImages((items) => [
        ...items.slice(0, index),
        ...parsed.map((item) => ({ id: `draft-${crypto.randomUUID()}`, image: item.image, mobileImage: "", alt: item.alt, desktopObjectPosition: "center center", mobileObjectPosition: "center center" })),
        ...items.slice(index + 1),
      ]);
      return;
    }
    if (parsed && !parsed.length) setHeroImageParseError("Paste each image as Name - WorkDrive URL, with one image per entry.");
    else setHeroImageParseError("");
    setHeroImages((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, image: value } : item));
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/collections/${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to load collection.");
      setData(payload as DetailPayload);
      const collection = payload.collection as ManagedCollection;
      const nextForm = {
        name: collection.name,
        status: collection.status,
        description: collection.description ?? "",
        coverImage: collection.coverImageSource ?? collection.coverImage ?? collection.heroImage ?? collection.hero?.image ?? "",
        heroType: collection.hero?.type ?? "image",
        heroLayout: collection.hero?.layout ?? "media_dominant",
        heroVideo: collection.heroSource?.video ?? collection.hero?.video ?? "",
        heroPoster: collection.heroSource?.poster ?? collection.hero?.poster ?? "",
        heroMobileImage: collection.heroSource?.mobileImage ?? collection.hero?.mobileImage ?? "",
        heroMobileVideo: collection.heroSource?.mobileVideo ?? collection.hero?.mobileVideo ?? "",
        heroLabel: collection.heroSource?.label ?? collection.hero?.label ?? "The Collection",
        heroCtaLabel: collection.heroSource?.ctaLabel ?? collection.hero?.ctaLabel ?? "Explore Collection",
        season: collection.season ?? "",
        year: collection.year ? String(collection.year) : "",
        designerNote: collection.designerNote ?? "",
        collectionNumber: collection.collectionNumber ?? "",
        location: collection.location ?? "",
        campaignInformation: collection.campaignInformation ?? "",
      };
      setCollectionForm(nextForm);
      setCollectionBaseline(nextForm);
      const savedHeroImages = collection.heroSource?.images ?? collection.hero?.images ?? [];
      const legacyDesktopImage = collection.heroSource?.image ?? collection.hero?.image ?? "";
      const legacySlide = legacyDesktopImage ? { id: `legacy-${legacyDesktopImage.slice(-16)}`, image: legacyDesktopImage, mobileImage: "", alt: "", desktopObjectPosition: "center center", mobileObjectPosition: "center center" } : null;
      const nextHeroImages = (legacySlide && !savedHeroImages.some((slide) => slide.image === legacyDesktopImage) ? [legacySlide, ...savedHeroImages] : savedHeroImages)
        .filter((slide, index, items) => items.findIndex((candidate) => candidate.image === slide.image) === index);
      setHeroImages(nextHeroImages.length ? nextHeroImages : [{ id: `draft-${crypto.randomUUID()}`, image: "", mobileImage: "", alt: "", desktopObjectPosition: "center center", mobileObjectPosition: "center center" }]);
      setHeroImagesBaseline(nextHeroImages);
      setHeroPreviewFailed(false);
      setCoverPreviewFailed(false);
      return payload as DetailPayload;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to load collection.",
      );
      return undefined;
    } finally {
      if (!silent) setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    if (!editingCollection || !isWorkDriveImage(collectionForm.coverImage)) {
      setDraftCoverPreview("");
      setDraftCoverError("");
      return;
    }
    if (collectionForm.coverImage === data?.collection.coverImageSource) {
      setDraftCoverPreview(data.collection.coverImage || data.collection.heroImage || "");
      setDraftCoverError("");
      return;
    }
    let objectUrl = "";
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`${apiBaseUrl}/api/staff/collections/image-preview`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
          body: JSON.stringify({ url: collectionForm.coverImage }),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Unable to preview this WorkDrive image.");
        objectUrl = URL.createObjectURL(await response.blob());
        setDraftCoverPreview(objectUrl);
        setDraftCoverError("");
        setCoverPreviewFailed(false);
      } catch (previewError) {
        if (!controller.signal.aborted) setDraftCoverError(previewError instanceof Error ? previewError.message : "Unable to preview this WorkDrive image.");
      }
    }, 450);
    return () => { window.clearTimeout(timer); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [collectionForm.coverImage, data, editingCollection]);
  useEffect(() => {
    void load();
  }, [load]);
  const canManageProducts = Boolean(
    data?.permissions.includes("products:manage"),
  );
  const canManageInventory = Boolean(
    data?.permissions.includes("inventory:manage"),
  );
  const selectedProduct = useMemo(
    () =>
      data?.collection.products.find((product) => product.id === selectedId) ??
      null,
    [data, selectedId],
  );

  const relationRequest = async (path: string, init: RequestInit) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
          ...(init.headers ?? {}),
        },
      });
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to update collection.");
      if (payload && typeof payload === "object" && "collection" in payload) {
        setData(payload as DetailPayload);
      }
      return payload;
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to update collection.",
      );
      return null;
    } finally {
      setBusy(false);
    }
  };

  const saveCollection = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const submittedRevision = collectionDraftRevision.current;
    const baseline = collectionBaseline;
    const body: Record<string, unknown> = {};
    for (const key of ["name", "status", "description", "coverImage", "season", "year", "designerNote", "collectionNumber", "location", "campaignInformation"] as const) {
      if (!baseline || normalizeCollectionValue(collectionForm[key]) !== normalizeCollectionValue(baseline[key])) body[key] = key === "year" ? collectionForm.year || null : collectionForm[key];
    }
    const heroKeys = {
      type: "heroType", layout: "heroLayout", video: "heroVideo", poster: "heroPoster",
      mobileImage: "heroMobileImage", mobileVideo: "heroMobileVideo", label: "heroLabel", ctaLabel: "heroCtaLabel",
    } as const;
    const hero: Record<string, unknown> = Object.fromEntries(Object.entries(heroKeys).flatMap(([target, source]) =>
      !baseline || normalizeCollectionValue(collectionForm[source]) !== normalizeCollectionValue(baseline[source]) ? [[target, collectionForm[source]]] : [],
    ));
    if (JSON.stringify(validHeroImages) !== JSON.stringify(heroImagesBaseline)) {
      hero.images = validHeroImages;
      hero.image = validHeroImages[0]?.image || "";
    }
    if (Object.keys(hero).length) body.hero = hero;
    if (!Object.keys(body).length) {
      setEditingCollection(false);
      setMessage("No collection changes to save.");
      return;
    }
    const payload = await relationRequest(
      `/api/staff/collections/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        body: JSON.stringify(body),
      },
    );
    if (payload) {
      if (collectionDraftRevision.current !== submittedRevision) {
        setMessage("Submitted changes were saved. Newer unsaved edits remain in the form; save again when ready.");
        return;
      }
      const refreshed = await load(true);
      if (!refreshed) {
        setError("Collection was updated, but authoritative read-back is unavailable. Your draft remains available.");
        return;
      }
      setEditingCollection(false);
      setMessage("Collection updated.");
    }
  };

  const assignExisting = async () => {
    if (!existingProductId) return;
    const payload = await relationRequest(
      `/api/staff/collections/${encodeURIComponent(slug)}/products`,
      {
        method: "POST",
        body: JSON.stringify({ productId: existingProductId }),
      },
    );
    if (payload) {
      setExistingProductId("");
      setAdding(false);
      setMessage("Existing product assigned without creating a copy.");
    }
  };

  const createProduct = async (body: Record<string, unknown>): Promise<CreateProductResult> => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/resources/products`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return { error: payload.error ?? `Unable to create product (HTTP ${response.status}).`, code: payload.code, existingProduct: payload.existingProduct, existingVariant: payload.variantId ? { id: String(payload.variantId), colour: payload.existingColour, sku: payload.existingSku } : undefined, newColours: payload.newColours };
      const id = String(payload.item?.id || "");
      const refreshed = await load(true);
      const product = refreshed?.collection.products.find((item) => item.id === id);
      if (!product) return { id, error: "The product was created, but the collection read-back is unavailable. Do not submit the draft again; use Verify saved product." };
      const submittedMedia = Array.isArray(body.media) ? body.media as Array<Record<string, unknown>> : [];
      const persisted = product.catalogMedia || [];
      const mediaVerified = submittedMedia.every((expected, index) => {
        const actual = persisted.find((item) => item.variant_id === expected.variant_id && item.permalink === expected.permalink);
        return actual && Number(actual.position || 0) === Number(expected.position ?? index) && Boolean(actual.is_primary) === Boolean(expected.is_primary) && Boolean(actual.is_hover) === Boolean(expected.is_hover);
      });
      if (!mediaVerified) return { id, error: "The product was created, but one or more media relationships failed authoritative read-back. The draft remains available." };
      setSelectedId(id);
      setMessage("Product created, assigned, and verified.");
      return { id, product };
    } catch (requestError) {
      return { error: requestError instanceof Error ? requestError.message : "Unable to create product." };
    } finally {
      setBusy(false);
    }
  };

  const openExistingVariant = async (productId: string, variantId?: string) => {
    await load(true);
    setSelectedId(productId);
    setProductOpenTarget({ productId, variantId });
    setAdding(false);
    setMessage(variantId ? "Existing colour opened. Manage its photos below." : "Existing product opened. Select its colour to manage photos.");
  };

  const changeCollectionArchiveState = async (archive: boolean) => {
    const current = data?.collection;
    if (!current) return;
    const action = archive ? "Archive" : "Restore";
    const consequence = archive
      ? "Products, media, stock, variants and collection relationships will be preserved. The collection will be removed from public discovery."
      : "The collection will return to public discovery using its previous status.";
    if (!window.confirm(`${action} “${current.name}”? ${consequence}`)) return;
    const payload = await relationRequest(
      `/api/staff/collections/${encodeURIComponent(slug)}/${archive ? "archive" : "restore"}`,
      { method: "POST", body: JSON.stringify({}) },
    );
    if (payload) {
      setMessage(archive ? "Collection archived. Its products and relationships were preserved." : "Collection restored.");
      setEditingCollection(false);
      setAdding(false);
      setAssigning(false);
    }
  };

  const deleteArchivedCollection = async () => {
    const current = data?.collection;
    if (!current || current.status !== "archived") return;
    if (!window.confirm(`Delete archived collection “${current.name}”? Products, variants, stock, media and WorkDrive assets will remain.`)) return;
    const payload = await relationRequest(`/api/staff/collections/${encodeURIComponent(slug)}`, { method: "DELETE", body: JSON.stringify({}) });
    if (payload) window.location.assign(basePath);
  };

  const verifyCreatedProduct = async (id: string) => {
    const refreshed = await load(true);
    const product = refreshed?.collection.products.find((item) => item.id === id);
    if (product) setSelectedId(id);
    return product;
  };

  if (loading)
    return <p className="mt-10 text-sm text-[#8a9098]">Loading collection…</p>;
  if (!data)
    return (
      <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-8">
        <Link href={basePath} className="text-xs text-[#9a7a4d]">
          ← Back to collections
        </Link>
        <p className="mt-6 text-sm text-red-600">
          {error || "Collection not found."}
        </p>
      </section>
    );
  const collection = data.collection;
  const draftPortraitPreview = isWorkDriveImage(collectionForm.coverImage)
    ? (draftCoverPreview || (collectionForm.coverImage === collection.coverImageSource ? collection.coverImage || collection.heroImage || "" : ""))
    : collectionForm.coverImage;

  return (
    <>
      <section className="mt-8">
        <Link
          href={basePath}
          className="inline-flex items-center gap-2 text-xs text-[#7d838d] transition hover:text-[#9a7a4d]"
        >
          <ArrowLeft size={14} />
          Back to collections
        </Link>
        <div className="mt-5 overflow-hidden rounded-2xl border border-black/[.06] bg-white shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f]">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(22rem,28rem)]">
            <div className="p-6 sm:p-8">
              <p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">
                Collection management
              </p>
              <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-3xl font-semibold">{collection.name}</h2>
                  <p className="mt-2 text-xs text-[#8a9098]">
                    {collection.slug}
                  </p>
                </div>
                {canManageProducts ? <div className="flex flex-wrap gap-2"><button type="button" onClick={() => setEditingCollection((current) => !current)} className="rounded-lg border border-black/10 px-4 py-2.5 text-xs transition hover:border-[#9a7a4d]">Edit collection</button><button type="button" onClick={() => void changeCollectionArchiveState(collection.status !== "archived")} disabled={busy} className={`rounded-lg border px-4 py-2.5 text-xs transition disabled:opacity-40 ${collection.status === "archived" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-red-200 text-red-700 hover:bg-red-50"}`}>{collection.status === "archived" ? "Restore collection" : "Archive collection"}</button>{collection.status === "archived" ? <button type="button" onClick={() => void deleteArchivedCollection()} disabled={busy} className="rounded-lg border border-red-300 px-4 py-2.5 text-xs text-red-700 transition hover:bg-red-50 disabled:opacity-40">Delete collection</button> : null}</div> : null}
              </div>
              <div className="mt-7 grid grid-cols-2 gap-5 sm:grid-cols-3">
                <div>
                  <p className="text-[9px] uppercase tracking-[.15em] text-[#8a9098]">
                    Status
                  </p>
                  <p className="mt-1 text-sm capitalize">
                    {statusLabel(collection.status)}
                  </p>
                </div>
                <div>
                  <p className="text-[9px] uppercase tracking-[.15em] text-[#8a9098]">
                    Products
                  </p>
                  <p className="mt-1 text-sm">{collection.productCount}</p>
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <p className="text-[9px] uppercase tracking-[.15em] text-[#8a9098]">
                    Created
                  </p>
                  <p className="mt-1 text-sm">
                    {collection.createdAt
                      ? formatDate(collection.createdAt)
                      : "—"}
                  </p>
                </div>
              </div>
              <p className="mt-7 max-w-3xl text-sm leading-7 text-[#6e747d]">
                {collection.description || "No collection description yet."}
              </p>
            </div>
            <div className="h-56 border-t border-black/[.06] bg-[#efece6] p-3 dark:border-white/[.08] dark:bg-white/[.03] sm:h-64 lg:min-h-[280px] lg:h-full lg:border-l lg:border-t-0">
              {collection.hero?.type === "video" && collection.hero.video ? (
                <video
                  muted
                  playsInline
                  controls
                  poster={collection.hero.poster || collection.hero.image}
                  className="h-full w-full object-cover object-center"
                >
                  <source src={collection.hero.video} />
                </video>
              ) : (collection.coverImage || collection.heroImage || collection.hero?.image) && !heroPreviewFailed ? (
                <img
                  src={collection.coverImage || collection.heroImage || collection.hero?.image || ""}
                  alt={`${collection.name} collection`}
                  className="h-full w-full object-cover object-center"
                  onError={() => setHeroPreviewFailed(true)}
                />
              ) : (
                <div className="grid h-full place-items-center text-center text-[#9a7a4d]">
                  <div>
                    <ImageIcon size={28} className="mx-auto" />
                    <p className="mt-2 text-[10px] uppercase tracking-[.16em]">
                      Hero placeholder
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
          {editingCollection ? (
            <form
              onSubmit={saveCollection}
              className="border-t border-black/[.06] bg-[#faf8f4] p-6 dark:border-white/[.08] dark:bg-white/[.025]"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Name
                  <input
                    required
                    value={collectionForm.name}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Status
                  <select
                    value={collectionForm.status}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        status: event.target.value,
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="collection">Collection</option>
                    <option value="draft">Draft</option>
                    <option value="archived">Archived</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Description
                  <textarea
                    rows={3}
                    value={collectionForm.description}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        description: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <div className="md:col-span-2 rounded-xl border border-black/[.08] bg-white/70 p-4">
                  <h3 className="text-sm font-semibold uppercase tracking-[.14em] text-[#776a5b]">Collection Image (Portrait)</h3>
                  <p className="mt-2 text-xs leading-5 text-[#8a9098]">Used for the collection card and collection preview. Separate from the landscape banner.</p>
                  <div className="mt-3 flex flex-wrap items-start gap-4">
                    <div className="h-[150px] w-[108px] overflow-hidden rounded-md border border-black/[.08] bg-[#efece6]">
                      {draftPortraitPreview && !coverPreviewFailed ? <img src={draftPortraitPreview} alt={`${collectionForm.name || collection.name} portrait preview`} className="h-full w-full object-cover" onError={() => setCoverPreviewFailed(true)} /> : <div className="grid h-full place-items-center px-2 text-center text-xs text-[#7d694d]">{draftCoverError || "No portrait image"}</div>}
                    </div>
                    <label className="min-w-[240px] flex-1 text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Collection Image (Portrait) URL<input value={collectionForm.coverImage} onChange={(event) => { setCoverPreviewFailed(false); setCollectionForm((current) => ({ ...current, coverImage: event.target.value })); }} className={inputClass} /></label>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <h3 className="text-sm font-semibold uppercase tracking-[.14em] text-[#776a5b]">Collection Banner (Landscape)</h3>
                  <p className="mt-2 text-xs leading-5 text-[#8a9098]">The landscape banner appears at the top of the collection page. Use one image for a static banner or add multiple slides for a slideshow. The portrait collection image above is managed separately.</p>
                </div>
                {slug.toLowerCase() !== "aakaar" ? <div className="md:col-span-2 rounded-xl border border-black/[.08] bg-white/70 p-4">
                  <div className="flex items-center justify-between gap-4">
                  <div><p className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">Landscape image configuration</p><p className="mt-1 text-xs text-[#8a9098]">One configured image creates a static landscape hero. Two or more create a slideshow in this order. Removing images updates the behavior automatically.</p></div>
                    <button type="button" onClick={addHeroImage} className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-[9px] uppercase tracking-[.14em]"><Plus size={13} /> Add image</button>
                  </div>
                  <div className="mt-4 space-y-4">
                    {heroImageParseError ? <p className="text-xs text-red-600" role="alert">{heroImageParseError}</p> : null}
                    {heroImages.map((slide, index) => <HeroSlideEditor key={slide.id} slide={slide} index={index} count={heroImages.length} token={token()} savedPreview={(collection.hero?.images || []).find((item) => item.id === slide.id && collection.heroSource?.images?.find((source) => source.id === slide.id)?.image === slide.image)?.image} onChange={(changes) => { if (typeof changes.image === "string") updateHeroImage(index, changes.image); else setHeroImages((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...changes } : item)); }} onMove={(direction) => setHeroImages((items) => { const next = [...items]; const target = index + direction; [next[index], next[target]] = [next[target], next[index]]; return next; })} onRemove={() => setHeroImages((items) => { const next = items.filter((_, itemIndex) => itemIndex !== index); return next.length ? next : [{ id: `draft-${crypto.randomUUID()}`, image: "", mobileImage: "", alt: "", desktopObjectPosition: "center center", mobileObjectPosition: "center center" }]; })} />)}
                    {!heroImages.length ? <div className="rounded-lg border border-dashed border-black/10 px-4 py-6 text-center text-xs text-[#8a9098]">No landscape images configured. Click Add image to create the first editable entry.</div> : null}
                  </div>
                </div> : null}
                <details className="md:col-span-2 rounded-xl border border-black/[.08] bg-white/70 p-4">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-[.14em] text-[#776a5b] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#9a7a4d]">Advanced settings</summary>
                  <p className="mt-2 text-xs leading-5 text-[#8a9098]">Optional campaign media and editorial metadata. Existing values remain unchanged unless edited here.</p>
                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Hero type
                  <select
                    value={collectionForm.heroType}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroType: event.target.value,
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="image">Image</option>
                    <option value="video">Video</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Hero layout
                  <select
                    value={collectionForm.heroLayout}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroLayout: event.target.value,
                      }))
                    }
                    className={inputClass}
                  >
                    <option value="full_bleed">Full bleed</option>
                    <option value="editorial_split">Editorial split</option>
                    <option value="media_dominant">Media dominant</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Small label
                  <input
                    value={collectionForm.heroLabel}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroLabel: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  CTA label
                  <input
                    value={collectionForm.heroCtaLabel}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroCtaLabel: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Desktop Banner Video URL
                  <input
                    value={collectionForm.heroVideo}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroVideo: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Banner Video Poster URL
                  <input
                    value={collectionForm.heroPoster}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroPoster: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Mobile image URL
                  <input
                    value={collectionForm.heroMobileImage}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroMobileImage: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Mobile video URL
                  <input
                    value={collectionForm.heroMobileVideo}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroMobileVideo: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Season
                  <input
                    value={collectionForm.season}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        season: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Year
                  <input
                    type="number"
                    min={1900}
                    max={2200}
                    value={collectionForm.year}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        year: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Collection number
                  <input
                    value={collectionForm.collectionNumber}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        collectionNumber: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098]">
                  Location
                  <input
                    value={collectionForm.location}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        location: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Designer note
                  <textarea
                    rows={2}
                    value={collectionForm.designerNote}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        designerNote: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Campaign information
                  <textarea
                    rows={2}
                    value={collectionForm.campaignInformation}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        campaignInformation: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                  </div>
                </details>
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCollection(false)}
                  className="rounded-lg border border-black/10 px-4 py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  disabled={busy || !collectionDirty}
                  className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Update collection
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </section>
      <section className="mt-6 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[.2em] text-[#9a7a4d]">
              Products
            </p>
            <h3 className="mt-2 text-2xl font-semibold">
              {collection.name} line
            </h3>
            <p className="mt-1 text-xs text-[#8a9098]">
              Ordered references to centralized product records.
            </p>
          </div>
          {canManageProducts && collection.status !== "archived" ? (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white"
            >
              <Plus size={14} />
              Add product
            </button>
          ) : null}
        </div>
        {message ? (
          <p className="mt-5 text-sm text-emerald-700">{message}</p>
        ) : null}
        {error ? (
          <p role="alert" className="mt-5 text-sm text-red-600">
            {error}
          </p>
        ) : null}
        {canManageProducts && collection.status !== "archived" ? <div className="mt-4"><button type="button" onClick={() => setAssigning((current) => !current)} className="text-xs text-[#9a7a4d] underline decoration-[#9a7a4d]/40 underline-offset-4">{assigning ? "Hide existing products" : "Assign an existing product"}</button></div> : null}
        {assigning && canManageProducts ? (
          <div className="mt-4 rounded-xl border border-[#9a7a4d]/20 bg-[#faf8f4] p-5 dark:bg-white/[.025]">
            <section>
              <p className="text-[10px] uppercase tracking-[.16em] text-[#9a7a4d]">
                Assign existing product
              </p>
              <select
                value={existingProductId}
                onChange={(event) => setExistingProductId(event.target.value)}
                className={inputClass}
              >
                <option value="">Choose centralized product</option>
                {data.availableProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} · {parentCode(product)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !existingProductId}
                onClick={() => void assignExisting()}
                className="mt-3 rounded-lg border border-black/10 px-4 py-2.5 text-xs disabled:opacity-40"
              >
                Assign existing
              </button>
            </section>
          </div>
        ) : null}
        {collection.products.length ? (
          <div className="mt-7 overflow-hidden rounded-xl border border-black/[.06] dark:border-white/[.08]">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-black/[.07] text-[9px] uppercase tracking-[.16em] text-[#8a9098]">
                <tr>
                  <th className="w-[46%] px-4 py-3 sm:w-[30%]">Product</th>
                  <th className="hidden w-[18%] px-4 py-3 md:table-cell">
                    Code
                  </th>
                  <th className="w-[28%] px-4 py-3 sm:w-[18%]">Availability</th>
                  <th className="hidden w-[16%] px-4 py-3 text-right sm:table-cell">
                    Price
                  </th>
                  <th className="hidden w-[10%] px-4 py-3 text-right lg:table-cell">
                    Stock
                  </th>
                  {canManageProducts ? (
                    <th className="hidden w-[12%] px-4 py-3 text-right lg:table-cell">
                      Order
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {collection.products.map((product) => (
                  <tr
                    key={product.id}
                    onClick={() => setSelectedId(product.id)}
                    className="cursor-pointer border-b border-black/[.055] transition last:border-b-0 hover:bg-[#faf8f4] dark:hover:bg-white/[.035]"
                  >
                    <td className="px-4 py-4">
                      <span className="block truncate font-medium">
                        {product.name || "Unnamed product"}
                      </span>
                      <span className="mt-1 block truncate text-[10px] text-[#8a9098] md:hidden">
                        {parentCode(product) || "No code"} ·{" "}
                        {product.price === undefined
                          ? "—"
                          : inr.format(product.price)}
                      </span>
                    </td>
                    <td className="hidden truncate px-4 py-4 text-[#6e747d] md:table-cell">
                      {parentCode(product) || "—"}
                    </td>
                    <td className="px-4 py-4 text-xs text-[#6e747d]">
                      {availabilityLabels[product.availability]}
                    </td>
                    <td className="hidden px-4 py-4 text-right tabular-nums text-[#6e747d] sm:table-cell">
                      {product.price === undefined
                        ? "—"
                        : inr.format(product.price)}
                    </td>
                    <td className="hidden px-4 py-4 text-right tabular-nums text-[#6e747d] lg:table-cell">
                      {product.availability === "custom_order"
                        ? "—"
                        : (product.stock ?? "—")}
                    </td>
                    {canManageProducts ? (
                      <td className="hidden px-4 py-3 text-right lg:table-cell">
                        <input
                          aria-label={`Display order for ${product.name}`}
                          type="number"
                          min={0}
                          value={product.displayOrder ?? 0}
                          onClick={(event) => event.stopPropagation()}
                          onChange={(event) =>
                            setData((current) =>
                              current
                                ? {
                                    ...current,
                                    collection: {
                                      ...current.collection,
                                      products: current.collection.products.map(
                                        (item) =>
                                          item.id === product.id
                                            ? {
                                                ...item,
                                                displayOrder: Number(
                                                  event.target.value,
                                                ),
                                              }
                                            : item,
                                      ),
                                    },
                                  }
                                : current,
                            )
                          }
                          onBlur={(event) =>
                            void relationRequest(
                              `/api/staff/collections/${encodeURIComponent(slug)}/products/${product.id}`,
                              {
                                method: "PATCH",
                                body: JSON.stringify({
                                  displayOrder: Number(event.target.value),
                                }),
                              },
                            )
                          }
                          className="w-16 rounded border border-black/10 bg-transparent px-2 py-1 text-right text-xs"
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="mt-7 rounded-xl border border-dashed border-black/10 px-6 py-12 text-center dark:border-white/10">
            <Package size={24} className="mx-auto text-[#9a7a4d]" />
            <p className="mt-3 text-sm font-medium">
              No products in this collection yet.
            </p>
            {canManageProducts && collection.status !== "archived" ? (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="mt-3 text-xs text-[#9a7a4d]"
              >
                Add Product
              </button>
            ) : null}
          </div>
        )}
      </section>
      {selectedProduct ? (
        <ProductDrawer
          key={`${selectedProduct.id}:${productRefreshRevision}`}
          product={selectedProduct}
          collection={collection}
          collections={data.allCollections}
          canManageProducts={canManageProducts}
          canManageInventory={canManageInventory}
          busy={busy}
          initialSection={productOpenTarget?.productId === selectedProduct.id ? "media" : undefined}
          initialVariantId={productOpenTarget?.productId === selectedProduct.id ? productOpenTarget.variantId : undefined}
          onClose={() => { setSelectedId(null); setProductOpenTarget(null); }}
          onReload={async () => {
            const refreshed = await load(true);
            setProductRefreshRevision((current) => current + 1);
            return refreshed;
          }}
          onRemove={async () => {
            const payload = await relationRequest(
              `/api/staff/collections/${encodeURIComponent(slug)}/products/${selectedProduct.id}`,
              { method: "DELETE" },
            );
            if (payload) {
              setSelectedId(null);
              setMessage(
                "Product removed from this collection only; the product record was preserved.",
              );
            }
          }}
        />
      ) : null}
      {adding && canManageProducts ? <CreateProductDrawer collection={collection} busy={busy} onClose={() => setAdding(false)} onCreate={createProduct} onVerify={verifyCreatedProduct} onOpenVariant={openExistingVariant} /> : null}
    </>
  );
}
