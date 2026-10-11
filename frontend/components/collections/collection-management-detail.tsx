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

type DetailPayload = {
  collection: ManagedCollection & { products: CatalogProduct[] };
  availableProducts: CatalogProduct[];
  allCollections: ManagedCollection[];
  permissions: StaffPermission[];
};

const inputClass =
  "admin-field mt-2 text-sm";
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
}) {
  const attributes = product.attributes ?? {};
  const [editing, setEditing] = useState(false);
  const [activeSection, setActiveSection] = useState<"overview" | "media" | "details" | "pricing">("overview");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adjustment, setAdjustment] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [targetCollection, setTargetCollection] = useState("");
  const [cleanupBusy, setCleanupBusy] = useState(false);
  const [deletingMediaId, setDeletingMediaId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);
  const [baseline, setBaseline] = useState(product);
  const [form, setForm] = useState<ProductDraft>(() => productDraftFrom(product));
  const token = () => window.localStorage.getItem("rk_access_token") ?? "";
  const mediaGroups = adminMediaGroups(product);
  const cleanupPlan = guardedMediaCleanupPlan(product, T1_ID, T1_STALE_MEDIA_IDS);
  const canCleanT1Media = cleanupPlan !== null;
  const editDirty = editing && JSON.stringify(form) !== JSON.stringify(productDraftFrom(baseline));
  const requestClose = () => {
    if (saveInFlight.current) return;
    if (editDirty && !window.confirm("Discard unsaved product changes?")) return;
    onClose();
  };
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
              {product.media?.[0] ? (
                <img
                  src={product.media[0]}
                  alt={product.name || "Product"}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full place-items-center text-center text-[#9a7a4d]">
                  <div>
                    <ImageIcon size={26} className="mx-auto" />
                    <p className="mt-2 text-[10px] uppercase tracking-[.15em]">
                      Image placeholder
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
                {configuredMediaEntries(product).length} relationship
                {configuredMediaEntries(product).length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] uppercase tracking-[.12em] text-[#8a9098]">
              {(product.variants || []).map((variant) => <span key={variant.id}>{variant.colour || variant.id}: {mediaGroups.variants[variant.id]?.length || 0}</span>)}
              <span>Unassigned: {mediaGroups.unassigned.length}</span>
            </div>
            {configuredMediaEntries(product).length ? (
              <ol className="mt-4 space-y-2">
                {configuredMediaEntries(product).map((entry, index) => (
                  <li
                    key={entry.identity}
                    className="flex items-center gap-3 rounded-lg border border-black/[.06] px-3 py-2 text-xs"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-[#efece6] text-[10px] text-[#9a7a4d]">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate">
                      {entry.label || `WorkDrive image ${index + 1}`} · {entry.scope}
                    </span>
                    {index === 0 ? (
                      <span className="text-[9px] uppercase tracking-[.12em] text-emerald-700">
                        Primary
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={`Remove ${entry.label || `image ${index + 1}`} from ${entry.scope}`}
                      title={`Remove from ${entry.scope}`}
                      disabled={Boolean(deletingMediaId)}
                      onClick={() => void removeMediaRelationship(entry)}
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-red-200 text-red-600 transition hover:border-red-300 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:cursor-wait disabled:opacity-40"
                    >
                      <Trash2 size={14} className={deletingMediaId === entry.identity ? "animate-pulse" : ""} />
                    </button>
                  </li>
                ))}
              </ol>
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
            <VariantMediaEditor productId={product.id} variants={product.variants} token={token} onSaved={onReload} />
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
  const [editingCollection, setEditingCollection] = useState(false);
  const [adding, setAdding] = useState(false);
  const [existingProductId, setExistingProductId] = useState("");
  const [collectionForm, setCollectionForm] = useState({
    name: "",
    status: "collection",
    description: "",
    heroType: "image",
    heroLayout: "media_dominant",
    heroImage: "",
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
  const [newProduct, setNewProduct] = useState({
    name: "",
    sku: "",
    price: "",
    stock: "0",
    availability: "in_stock" as ProductAvailability,
  });
  const token = () => window.localStorage.getItem("rk_access_token") ?? "";

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
      setCollectionForm({
        name: collection.name,
        status: collection.status,
        description: collection.description ?? "",
        heroType: collection.hero?.type ?? "image",
        heroLayout: collection.hero?.layout ?? "media_dominant",
        heroImage: collection.hero?.image ?? collection.heroImage ?? "",
        heroVideo: collection.hero?.video ?? "",
        heroPoster: collection.hero?.poster ?? collection.heroImage ?? "",
        heroMobileImage: collection.hero?.mobileImage ?? "",
        heroMobileVideo: collection.hero?.mobileVideo ?? "",
        heroLabel: collection.hero?.label ?? "The Collection",
        heroCtaLabel: collection.hero?.ctaLabel ?? "Explore Collection",
        season: collection.season ?? "",
        year: collection.year ? String(collection.year) : "",
        designerNote: collection.designerNote ?? "",
        collectionNumber: collection.collectionNumber ?? "",
        location: collection.location ?? "",
        campaignInformation: collection.campaignInformation ?? "",
      });
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
      setData(payload as DetailPayload);
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
    const payload = await relationRequest(
      `/api/staff/collections/${encodeURIComponent(slug)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          name: collectionForm.name,
          status: collectionForm.status,
          description: collectionForm.description,
          season: collectionForm.season,
          year: collectionForm.year || null,
          designerNote: collectionForm.designerNote,
          collectionNumber: collectionForm.collectionNumber,
          location: collectionForm.location,
          campaignInformation: collectionForm.campaignInformation,
      hero: {
            type: collectionForm.heroType,
            layout: collectionForm.heroLayout,
            image: collectionForm.heroImage,
            video: collectionForm.heroVideo,
            poster: collectionForm.heroPoster,
            mobileImage: collectionForm.heroMobileImage,
            mobileVideo: collectionForm.heroMobileVideo,
            label: collectionForm.heroLabel,
            ctaLabel: collectionForm.heroCtaLabel,
      },
        }),
      },
    );
    if (payload) {
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

  const createAndAssign = async (event: FormEvent) => {
    event.preventDefault();
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
          body: JSON.stringify({
            ...newProduct,
            price: Number(newProduct.price),
            stock: Number(newProduct.stock),
            status: "draft",
          }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error ?? "Unable to create product.");
      const assigned = await relationRequest(
        `/api/staff/collections/${encodeURIComponent(slug)}/products`,
        {
          method: "POST",
          body: JSON.stringify({ productId: payload.item.id }),
        },
      );
      if (assigned) {
        setNewProduct({
          name: "",
          sku: "",
          price: "",
          stock: "0",
          availability: "in_stock",
        });
        setAdding(false);
        setMessage("Product created once and assigned to this collection.");
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Unable to create product.",
      );
    } finally {
      setBusy(false);
    }
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
          <div className="grid lg:grid-cols-[1fr_20rem]">
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
                {canManageProducts ? (
                  <button
                    type="button"
                    onClick={() => setEditingCollection((current) => !current)}
                    className="rounded-lg border border-black/10 px-4 py-2.5 text-xs transition hover:border-[#9a7a4d]"
                  >
                    Edit collection
                  </button>
                ) : null}
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
            <div className="min-h-56 border-t border-black/[.06] bg-[#efece6] dark:border-white/[.08] dark:bg-white/[.03] lg:border-l lg:border-t-0">
              {collection.hero?.type === "video" && collection.hero.video ? (
                <video
                  muted
                  playsInline
                  controls
                  poster={collection.hero.poster || collection.hero.image}
                  className="h-full max-h-80 w-full object-cover lg:max-h-none"
                >
                  <source src={collection.hero.video} />
                </video>
              ) : collection.hero?.image || collection.heroImage ? (
                <img
                  src={collection.hero?.image || collection.heroImage}
                  alt={`${collection.name} collection`}
                  className="h-full max-h-80 w-full object-cover lg:max-h-none"
                />
              ) : (
                <div className="grid h-full min-h-56 place-items-center text-center text-[#9a7a4d]">
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
                  Desktop image URL
                  <input
                    value={collectionForm.heroImage}
                    onChange={(event) =>
                      setCollectionForm((current) => ({
                        ...current,
                        heroImage: event.target.value,
                      }))
                    }
                    className={inputClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.14em] text-[#8a9098] md:col-span-2">
                  Desktop video URL
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
                  Video poster URL
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
              <div className="mt-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingCollection(false)}
                  className="rounded-lg border border-black/10 px-4 py-2 text-xs"
                >
                  Cancel
                </button>
                <button
                  disabled={busy}
                  className="rounded-lg bg-[#24211e] px-4 py-2 text-xs text-white disabled:opacity-40"
                >
                  Save collection
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
          {canManageProducts ? (
            <button
              type="button"
              onClick={() => setAdding((current) => !current)}
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
        {adding && canManageProducts ? (
          <div className="mt-6 grid gap-5 rounded-xl border border-[#9a7a4d]/20 bg-[#faf8f4] p-5 dark:bg-white/[.025] lg:grid-cols-2">
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
            <form onSubmit={createAndAssign}>
              <p className="text-[10px] uppercase tracking-[.16em] text-[#9a7a4d]">
                Create one centralized product
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <input
                  required
                  placeholder="Product name"
                  value={newProduct.name}
                  onChange={(event) =>
                    setNewProduct((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
                <input
                  required
                  placeholder="Code / SKU"
                  value={newProduct.sku}
                  onChange={(event) =>
                    setNewProduct((current) => ({
                      ...current,
                      sku: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
                <input
                  required
                  type="number"
                  min={0}
                  placeholder="INR price"
                  value={newProduct.price}
                  onChange={(event) =>
                    setNewProduct((current) => ({
                      ...current,
                      price: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
                <input
                  required
                  type="number"
                  min={0}
                  placeholder="Quantity"
                  value={newProduct.stock}
                  onChange={(event) =>
                    setNewProduct((current) => ({
                      ...current,
                      stock: event.target.value,
                    }))
                  }
                  className={inputClass}
                />
                <select
                  value={newProduct.availability}
                  onChange={(event) =>
                    setNewProduct((current) => ({
                      ...current,
                      availability: event.target.value as ProductAvailability,
                    }))
                  }
                  className={inputClass}
                >
                  {availabilityOptions.map((option) => (
                    <option key={option} value={option}>
                      {availabilityLabels[option]}
                    </option>
                  ))}
                </select>
              </div>
              <button
                disabled={busy}
                className="mt-3 rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white disabled:opacity-40"
              >
                Create and assign
              </button>
            </form>
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
            {canManageProducts ? (
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
          key={selectedProduct.id}
          product={selectedProduct}
          collection={collection}
          collections={data.allCollections}
          canManageProducts={canManageProducts}
          canManageInventory={canManageInventory}
          busy={busy}
          onClose={() => setSelectedId(null)}
          onReload={() => load(true)}
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
    </>
  );
}
