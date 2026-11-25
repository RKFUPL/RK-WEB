"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Check,
  Heart,
  Image as ImageIcon,
  Mail,
  Minus,
  Plus,
  Ruler,
  ShoppingBag,
  X,
  ZoomIn,
  ZoomOut,
  MessageCircle, Scissors, Layers, Video, Truck,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Footer } from "@/components/home/footer";
import { StickyHeader } from "@/components/home/sticky-header";
import { CollectionProductCard } from "@/components/collections/collection-product-card";
import { ShippingTimeline } from "@/components/commerce/shipping-timeline";
import { SizeChartPopover } from "@/components/products/size-chart-popover";
import { trackAnalyticsEvent } from "@/lib/analytics";
import {
  availabilityLabels,
  availableGalleryMedia,
  normalizeColour,
  variantMediaSources,
  variantPrimaryAndHoverSources,
  type CatalogProduct,
  type ManagedCollection,
} from "@/lib/catalog";
import { apiBaseUrl } from "@/lib/rbac";
import { addStoredCartItem } from "@/lib/storefront-cart";
import { productShippingTimeline } from "@/lib/shipping-timeline";
import {
  readWishlist,
  toggleWishlist,
  wishlistChangedEvent,
} from "@/lib/storefront-wishlist";
import { cloudinaryImageUrl } from "@/lib/utils";
import { useSalePrice } from '@/lib/sale-price';
import { PriceCurrencyRow } from "@/components/commerce/price-currency-row";
import { AiTryon } from "@/components/products/ai-tryon";
import { colourSwatchValue, useColourSwatches } from "@/lib/colour-swatches";
import { productDisclaimerText } from "@/lib/product-editor";
import { FloatingProductChat } from "@/components/products/floating-product-chat";
import { SizeSelectionDialog } from "@/components/products/size-selection-dialog";
import { productWhatsappHref, useProductWhatsapp } from "@/lib/product-assistance";

const productDetailLabelClass = "text-xs uppercase tracking-[0.24em] text-charcoal/45";

function textValue(value: unknown) {
  if (Array.isArray(value)) return value.filter(Boolean).join(", ");
  return value === undefined || value === null ? "" : String(value);
}

const defaultCustomSizeFields = [
  "Bust",
  "Waist",
  "Hip",
  "Shoulder",
  "Armhole",
  "Sleeve Length",
  "Height",
  "Blouse/Top Length",
  "Bottom Length",
  "Inseam",
];

const standardSizes = ["XS", "S", "M", "L", "XL"];

function belongsToCollection(
  collection: ManagedCollection,
  collectionName: string,
) {
  const matcher = new RegExp(
    `(^|[\\s_-])${collectionName.toLowerCase()}($|[\\s_-])`,
  );
  return [
    collection.collectionType,
    collection.name,
    collection.slug,
    collection.status,
  ].some((value) =>
    matcher.test(
      String(value || "")
        .trim()
        .toLowerCase(),
    ),
  );
}

function isRunwayCollection(collection: ManagedCollection) {
  const identity = [
    collection.collectionType,
    collection.name,
    collection.slug,
    collection.status,
  ]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .join(" ");
  return /runway|lfw/.test(identity) || /espiritu[\s_-]+libre/.test(identity);
}

export function ProductDetailPage({ productId, initialVariantId = "" }: { productId: string; initialVariantId?: string }) {
  const colourSwatches = useColourSwatches();
  const whatsappNumber = useProductWhatsapp();
  const router = useRouter();
  const [sizePromptOpen, setSizePromptOpen] = useState(false);
  const pendingPurchase = useRef<"cart" | "buy" | null>(null);
  const purchaseBusy = useRef(false);
  const [productUrl, setProductUrl] = useState("");
  useEffect(() => { setProductUrl(window.location.href); }, [productId, initialVariantId]);
  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [collections, setCollections] = useState<ManagedCollection[]>([]);
  const [relatedProducts, setRelatedProducts] = useState<CatalogProduct[]>([]);
  const [relatedProductsLoading, setRelatedProductsLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [selectedVariantId, setSelectedVariantId] = useState("");
  const [selectedSize, setSelectedSize] = useState("");
  const [customSizeOpen, setCustomSizeOpen] = useState(false);
  const customSizeDialogRef = useRef<HTMLDivElement>(null);
  const [customSizeError, setCustomSizeError] = useState("");
  const [customOrderOpen, setCustomOrderOpen] = useState(false);
  const [customOrderName, setCustomOrderName] = useState("");
  const [customOrderEmail, setCustomOrderEmail] = useState("");
  const [customOrderPhone, setCustomOrderPhone] = useState("");
  const [customOrderSize, setCustomOrderSize] = useState("");
  const [customOrderMessage, setCustomOrderMessage] = useState("");
  const [customOrderError, setCustomOrderError] = useState("");
  const [customOrderBusy, setCustomOrderBusy] = useState(false);
  const [customSizeUnit, setCustomSizeUnit] = useState<"cm" | "in">("cm");
  const [customMeasurements, setCustomMeasurements] = useState<
    Record<string, string>
  >({});
  const [activeImage, setActiveImage] = useState(0);
  const [failedMedia, setFailedMedia] = useState<Set<string>>(() => new Set());
  const mainImageFrameRef = useRef<HTMLDivElement>(null);
  const thumbnailRailRef = useRef<HTMLDivElement>(null);
  const thumbnailRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [thumbnailViewportHeight, setThumbnailViewportHeight] =
    useState<number>();
  const [quantity, setQuantity] = useState(1);
  const [inlineZoomed, setInlineZoomed] = useState(false);
  const [zoomOrigin, setZoomOrigin] = useState("50% 50%");
  const [openSection, setOpenSection] = useState("");
  const [message, setMessage] = useState("");
  const [notFound, setNotFound] = useState(false);
  const variantOptions = (product?.variants ?? []).filter(
    (variant) => variant.status !== "remove",
  );
  const selectedVariant =
    variantOptions.find((variant) => variant.id === selectedVariantId) ??
    variantOptions.find((variant) => variant.status === "active") ??
    variantOptions[0];
  // Prefer the selected variant's images, but keep product-level catalog media
  // as the safe fallback when a variant exists without its own photography.
  const galleryMedia = product
    ? availableGalleryMedia(variantMediaSources(product, selectedVariant), failedMedia)
    : [];

  useEffect(() => {
    if (!product || !selectedVariant || !galleryMedia.length) {
      setActiveImage(0);
      return;
    }
    const primary = variantPrimaryAndHoverSources(product, selectedVariant).primary;
    const primaryIndex = primary ? galleryMedia.indexOf(primary) : -1;
    setActiveImage(primaryIndex >= 0 ? primaryIndex : 0);
    setInlineZoomed(false);
    thumbnailRefs.current = [];
  }, [product, selectedVariantId]);

  useEffect(() => {
    pendingPurchase.current = null;
    setSizePromptOpen(false);
    setProduct(null);
    setCollections([]);
    setRelatedProducts([]);
    setRelatedProductsLoading(false);
    setNotFound(false);
    setSelectedVariantId("");
    setSelectedSize("");
    setCustomMeasurements({});
    setActiveImage(0);
    setFailedMedia(new Set());
    setQuantity(1);
    fetch(
      `${apiBaseUrl}/api/catalog/products/${encodeURIComponent(productId)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Product not found.");
        return payload;
      })
      .then((payload) => {
        const nextProduct = payload.product as CatalogProduct;
        const initialVariant =
          nextProduct.variants?.find((variant) => variant.id === initialVariantId && variant.status !== "remove") ??
          nextProduct.variants?.filter((variant) => variant.status !== "remove").find(
            (variant) => variant.status === "active",
          ) ?? nextProduct.variants?.find((variant) => variant.status !== "remove");
        setProduct(nextProduct);
        setSelectedVariantId(initialVariant?.id ?? "");
        setCollections(payload.collections || []);
        trackAnalyticsEvent("product_view", {
          productId,
          productName: nextProduct.name,
          currency: "INR",
          value: initialVariant?.price ?? nextProduct.price,
        });
      })
      .catch(() => setNotFound(true));
  }, [initialVariantId, productId]);

  useEffect(() => {
    const collectionSlug = collections[0]?.slug;
    if (!collectionSlug) {
      setRelatedProducts([]);
      setRelatedProductsLoading(false);
      return undefined;
    }

    let active = true;
    setRelatedProductsLoading(true);
    fetch(
      `${apiBaseUrl}/api/catalog/collections/${encodeURIComponent(collectionSlug)}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok)
          throw new Error(payload.error || "Unable to load related products.");
        return payload.collection as ManagedCollection & {
          products?: CatalogProduct[];
        };
      })
      .then((collection) => {
        if (!active) return;
        setRelatedProducts(
          (collection.products || [])
            .filter((item) => item.id !== productId)
            .slice(0, 4),
        );
      })
      .catch(() => {
        if (active) setRelatedProducts([]);
      })
      .finally(() => {
        if (active) setRelatedProductsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [collections, productId]);

  useEffect(() => {
    if (!customSizeOpen && !customOrderOpen) return undefined;
    setCustomSizeError("");
    setCustomOrderError("");
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [customOrderOpen, customSizeOpen]);

  useEffect(() => {
    if (!customSizeOpen) return;
    const dialog = customSizeDialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]') || []);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        pendingPurchase.current = null;
        setCustomSizeOpen(false);
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); previous?.focus(); };
  }, [customSizeOpen]);

  useEffect(() => {
    const sync = () =>
      setSaved(readWishlist().some((item) => item.productId === productId));
    sync();
    window.addEventListener(wishlistChangedEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(wishlistChangedEvent, sync);
      window.removeEventListener("storage", sync);
    };
  }, [productId]);

  useEffect(() => {
    setInlineZoomed(false);
    setZoomOrigin("50% 50%");
  }, [activeImage, selectedVariantId]);

  useEffect(() => {
    if (!inlineZoomed) return undefined;
    const dismissOutside = (event: PointerEvent) => {
      if (!mainImageFrameRef.current?.contains(event.target as Node)) setInlineZoomed(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInlineZoomed(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [inlineZoomed]);

  useEffect(() => {
    const viewport = mainImageFrameRef.current;
    if (!viewport || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) setInlineZoomed(false);
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const rail = thumbnailRailRef.current;
    const thumbnail = thumbnailRefs.current[activeImage];
    if (!rail || !thumbnail) return;

    const vertical = window.matchMedia("(min-width: 1024px)").matches;
    const itemStart = vertical ? thumbnail.offsetTop : thumbnail.offsetLeft;
    const itemSize = vertical ? thumbnail.offsetHeight : thumbnail.offsetWidth;
    const viewportStart = vertical ? rail.scrollTop : rail.scrollLeft;
    const viewportSize = vertical ? rail.clientHeight : rail.clientWidth;
    const itemEnd = itemStart + itemSize;
    const viewportEnd = viewportStart + viewportSize;

    if (itemStart < viewportStart || itemEnd > viewportEnd) {
      rail.scrollTo(
        vertical
          ? { top: itemStart, behavior: "smooth" }
          : { left: itemStart, behavior: "smooth" },
      );
    }
  }, [activeImage]);

  useEffect(() => {
    const mainImageFrame = mainImageFrameRef.current;
    const rail = thumbnailRailRef.current;
    const firstThumbnail = thumbnailRefs.current[0];
    if (!mainImageFrame || !rail || !firstThumbnail || galleryMedia.length < 2)
      return undefined;

    const updateViewportHeight = () => {
      if (!window.matchMedia("(min-width: 1024px)").matches) {
        setThumbnailViewportHeight(undefined);
        return;
      }

      const availableHeight = mainImageFrame.getBoundingClientRect().height;
      const thumbnailHeight = firstThumbnail.getBoundingClientRect().height;
      const styles = window.getComputedStyle(rail);
      const gap = Number.parseFloat(styles.rowGap || styles.gap) || 0;
      const thumbnailCount = galleryMedia.length;
      const completeContentHeight =
        thumbnailCount * thumbnailHeight +
        Math.max(0, thumbnailCount - 1) * gap;
      const visibleCount = Math.max(
        1,
        Math.floor((availableHeight + gap) / (thumbnailHeight + gap)),
      );
      const completeViewportHeight =
        visibleCount * thumbnailHeight + Math.max(0, visibleCount - 1) * gap;

      setThumbnailViewportHeight(
        Math.min(completeContentHeight, completeViewportHeight),
      );
    };

    const resizeObserver = new ResizeObserver(updateViewportHeight);
    resizeObserver.observe(mainImageFrame);
    resizeObserver.observe(firstThumbnail);
    updateViewportHeight();

    return () => resizeObserver.disconnect();
  }, [galleryMedia.length]);

  useEffect(() => {
    setActiveImage((index) => index < galleryMedia.length ? index : 0);
  }, [galleryMedia.length, selectedVariant?.id]);

  const currentPrice = useSalePrice(selectedVariant?.price ?? product?.price, selectedVariant?.sale ?? product?.sale, productId, selectedVariant?.id);

  if (notFound)
    return (
      <main className="min-h-screen bg-ivory text-charcoal">
        <StickyHeader />
        <div className="mx-auto max-w-3xl px-6 pb-24 pt-40 text-center">
          <p className="text-[0.6rem] uppercase tracking-[0.35em] text-gold">
            Product unavailable
          </p>
          <h1 className="mt-5 font-display text-5xl">
            This piece could not be found.
          </h1>
          <Link
            href="/collections"
            className="mt-10 inline-flex border-b border-charcoal/40 pb-2 text-xs uppercase tracking-[0.28em]"
          >
            Explore collections
          </Link>
        </div>
        <Footer />
      </main>
    );
  if (!product)
    return (
      <main className="min-h-screen bg-ivory text-charcoal">
        <StickyHeader />
        <div className="mx-auto grid max-w-[100rem] animate-pulse gap-10 px-6 pb-24 pt-32 lg:grid-cols-2 lg:px-12">
          <div className="aspect-[4/5] rounded-[14px] bg-sand" />
          <div className="space-y-5 py-10">
            <div className="h-3 w-24 bg-sand" />
            <div className="h-16 w-3/4 bg-sand" />
            <div className="h-4 w-32 bg-sand" />
          </div>
        </div>
      </main>
    );

  const media = galleryMedia;
  const sizeInventory =
    selectedVariant?.sizeInventory ?? product.sizeInventory ?? [];
  const sizeConfigured =
    Boolean(selectedVariant) || product.sizeInventoryConfigured === true;
  const isAnamikaProduct = collections.some((collection) =>
    belongsToCollection(collection, "anamika"),
  );
  const isRunwayProduct = collections.some(isRunwayCollection);
  const attributeSizes = Array.isArray(product.attributes?.sizes)
    ? product.attributes.sizes
        .map((size) => String(size).trim().toUpperCase())
        .filter(Boolean)
    : [];
  const sizes = selectedVariant?.sizes?.length
    ? selectedVariant.sizes
    : isAnamikaProduct
      ? standardSizes
      : sizeConfigured
        ? sizeInventory.map((item) => item.size)
        : attributeSizes;
  const showSizeSelector = sizes.length > 0;
  const configuredCustomSizeFields = Array.isArray(
    product.customSizeConfig?.fields,
  )
    ? product.customSizeConfig.fields
    : [];
  const customSizeExplicitlyEnabled =
    typeof product.customSizeConfig?.enabled === "boolean"
      ? product.customSizeConfig.enabled
      : undefined;
  const selectedAvailability = selectedVariant
    ? selectedVariant.status === "active"
      ? "in_stock"
      : "sold_out"
    : product.availability;
  const selectedPrice = currentPrice.amount;
  const selectedSku = selectedVariant?.sku || product.sku || "";
  const selectedColour = normalizeColour(
    selectedVariant?.colour ||
    textValue(product.attributes?.colors || product.attributes?.color),
  );
  const customSizeEnabled =
    customSizeExplicitlyEnabled ??
    (configuredCustomSizeFields.length > 0 ||
      sizeConfigured ||
      isAnamikaProduct ||
      selectedAvailability === "custom_order");
  const customSizeFields = customSizeEnabled
    ? configuredCustomSizeFields.length
      ? configuredCustomSizeFields
      : defaultCustomSizeFields
    : [];
  const backCollection = collections[0];
  const backCollectionHref =
    backCollection?.slug === "aakaar"
      ? "/collections/aakaar"
      : backCollection
        ? `/collections/${backCollection.slug}`
        : "";
  const route = `/products/${product.id}`;
  const currentImage = media[activeImage] || media[0];
  const currentMainImage = cloudinaryImageUrl(currentImage, 1600);
  const soldOut = selectedAvailability === "sold_out";
  const runwayCustomOrder =
    isRunwayProduct && selectedAvailability !== "in_stock";
  const shippingTimeline = productShippingTimeline(product, selectedVariant, Boolean(customMeasurements._customReady));
  const requireSignIn = () => {
    if (window.localStorage.getItem("rk_access_token")) return true;
    window.alert("Please sign in to use your wishlist or shopping bag.");
    return false;
  };
  const previousImage = () =>
    setActiveImage((index) =>
      media.length ? (index - 1 + media.length) % media.length : 0,
    );
  const nextImage = () =>
    setActiveImage((index) => (media.length ? (index + 1) % media.length : 0));
  const requestCustomOrder = () => {
    setCustomOrderError("");
    setCustomOrderOpen(true);
  };
  const chooseVariant = (variantId: string) => {
    pendingPurchase.current = null;
    setSizePromptOpen(false);
    setSelectedVariantId(variantId);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("variant", variantId);
    window.history.replaceState(window.history.state, "", nextUrl);
    setProductUrl(nextUrl.href);
    setActiveImage(0);
    setSelectedSize("");
    setCustomMeasurements({});
    setQuantity(1);
    setMessage("");
    setInlineZoomed(false);
    thumbnailRefs.current = [];
  };
  const markImageUnavailable = (source: string) => {
    setFailedMedia((current) => {
      if (current.has(source)) return current;
      const next = new Set(current);
      next.add(source);
      return next;
    });
  };
  const saveProduct = () => {
    if (!requireSignIn()) return;
    const added = toggleWishlist({
      productId: product.id,
      variantId: selectedVariant?.id,
      sku: selectedSku,
      colour: selectedColour,
      name: product.name || "Untitled piece",
      price: selectedPrice,
      image: media[0],
      category: product.category || "Couture",
      availability: availabilityLabels[selectedAvailability],
      stock: selectedVariant?.stock ?? product.stock,
      sizeOptions: sizes,
      sizeStock: Object.fromEntries(
        sizeInventory.map((entry) => [entry.size, entry.stock]),
      ),
      route,
    });
    setSaved(added);
    if (added)
      trackAnalyticsEvent("wishlist_add", {
        productId: product.id,
        productName: product.name,
        currency: "INR",
        value: selectedPrice,
      });
  };
  const addToCart = (action: "cart" | "buy" = "cart", size = selectedSize, measurements = customMeasurements) => {
    if (purchaseBusy.current) return;
    if (showSizeSelector && !size && !measurements._customReady) {
      pendingPurchase.current = action;
      setSizePromptOpen(true);
      return;
    }
    if (!requireSignIn()) return;
    if (!selectedVariant || selectedVariant.status !== "active") {
      setMessage("Please choose an available colour.");
      return;
    }
    if (selectedPrice === undefined) {
      setMessage("This colour does not have a valid price yet.");
      return;
    }
    const customSize = measurements._customReady
      ? {
          unit: customSizeUnit,
          measurements: Object.fromEntries(
            Object.entries(measurements).filter(
              ([key]) => key !== "_customReady",
            ),
          ),
        }
      : undefined;
    purchaseBusy.current = true;
    window.setTimeout(() => { purchaseBusy.current = false; }, 400);
    addStoredCartItem({
      productId: product.id,
      productCode:
        product.productCode || product.parentSku || product.name || "",
      variantId: selectedVariant.id,
      sku: selectedVariant.sku,
      collection: backCollection?.name || "",
      colour: selectedVariant.colour,
      name: product.name || "Untitled piece",
      price: Number(selectedPrice),
      sale: currentPrice.sale,
      quantity,
      image: media[0],
      availability: availabilityLabels[selectedAvailability],
      shippingMode: productShippingTimeline(product, selectedVariant, Boolean(measurements._customReady)).mode,
      size: size || undefined,
      sizeOptions: sizes,
      sizeStock: Object.fromEntries(
        sizeInventory.map((entry) => [entry.size, entry.stock]),
      ),
      inventoryMode: "variant",
      purchaseMode: customSize ? "custom_size" : "standard_size",
      customSize,
      variant: {
        id: selectedVariant.id,
        sku: selectedVariant.sku,
        colour: selectedVariant.colour,
        name: "Colour",
        value: selectedVariant.colour || "Default",
        status: selectedVariant.status,
      },
    });
    trackAnalyticsEvent("add_to_bag", {
      productId: product.id,
      productName: product.name,
      currency: "INR",
      value: selectedPrice,
      quantity,
    });
    setMessage("Added to your shopping bag.");
    if (action === "buy") router.push("/checkout");
  };
  const submitCustomOrder = async () => {
    if (!customOrderName.trim()) {
      setCustomOrderError("Enter your name.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(customOrderEmail.trim())) {
      setCustomOrderError("Enter a valid email address.");
      return;
    }

    setCustomOrderBusy(true);
    setCustomOrderError("");
    const measurements = Object.fromEntries(
      Object.entries(customMeasurements).filter(
        ([key, value]) => key !== "_customReady" && value.trim(),
      ),
    );
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/catalog/custom-order-requests`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json", ...(window.localStorage.getItem("rk_access_token") ? { Authorization: `Bearer ${window.localStorage.getItem("rk_access_token")}` } : {}) },
        body: JSON.stringify({
          productId: product.id,
          variantId: selectedVariant?.id,
          name: customOrderName,
          email: customOrderEmail,
          phone: customOrderPhone,
          requestedSize: customOrderSize,
          measurements,
          message: customOrderMessage,
        }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(payload.error || "The request could not be sent.");
      setCustomOrderOpen(false);
      setCustomOrderName("");
      setCustomOrderEmail("");
      setCustomOrderPhone("");
      setCustomOrderSize("");
      setCustomOrderMessage("");
      setCustomMeasurements({});
      setMessage(
        payload.message ||
          "Request received. The RK team will get back to you by email.",
      );
    } catch (error) {
      setCustomOrderError(
        error instanceof Error
          ? error.message
          : "The request could not be sent.",
      );
    } finally {
      setCustomOrderBusy(false);
    }
  };
  const saveCustomMeasurements = () => {
    if (customSizeFields.some((field) => !customMeasurements[field]?.trim())) {
      setCustomSizeError("Complete every custom measurement.");
      return;
    }
    const invalidField = customSizeFields.find((field) => {
      const value = Number(customMeasurements[field]);
      return !Number.isFinite(value) || value <= 0 || value > 500;
    });
    if (invalidField) {
      setCustomSizeError(`Enter a valid number for ${invalidField}.`);
      return;
    }
    setCustomSizeError("");
    setSelectedSize("");
    setCustomMeasurements((current) => ({ ...current, _customReady: "true" }));
    setCustomSizeOpen(false);
    setMessage("Custom measurements saved.");
    const action = pendingPurchase.current;
    pendingPurchase.current = null;
    if (action) addToCart(action, "", { ...customMeasurements, _customReady: "true" });
  };
  const attributes = product.attributes || {};
  const attributeText = (...keys: string[]) => keys.map((key) => textValue(attributes[key])).find(Boolean) || '';
  const shortDescription = textValue(product.shortDescription);
  const productDescription = textValue(product.description);
  const detailedDescription = textValue(
    attributes.detailedDescription ||
      attributes.descriptionDetails ||
      attributes.longDescription,
  );
  const material = attributeText('material');
  const construction = attributeText('customizationInformation');
  const setContents = attributeText('components', 'setContents', 'includes', 'productIncludes');
  const fit = attributeText('fit', 'fitDetails', 'silhouette');
  const garmentMeasurements = attributeText('garmentMeasurements', 'measurements', 'measurementNotes');
  const care = attributeText('care', 'careInstructions');
  const assistance = attributeText('madeToOrder', 'madeToOrderInformation', 'clientService');
  const composition = attributeText('composition', 'fabricComposition', 'fabric');
  const productAttributes = [['Components', setContents], ['Fit', fit], ['Composition', composition], ['Care', care]].filter(([, value]) => value.trim());
  const disclaimer = productDisclaimerText(product);
  const whatsappHref = productWhatsappHref(whatsappNumber, product.name || 'this piece', productUrl);
  const informationSections = [
    ...(garmentMeasurements ? [{ id: 'measurements', label: 'Fit & Measurements', content: <p className="text-sm leading-7 text-charcoal/65">{garmentMeasurements}</p> }] : []),
    ...(assistance ? [{ id: 'assistance', label: 'Made to Order & Assistance', content: <p className="text-sm leading-7 text-charcoal/65">{assistance}</p> }] : []),
  ];

  return (
    <main className="bg-ivory text-charcoal">
      <StickyHeader />
    <section className="mx-auto max-w-[100rem] px-4 pb-20 pt-28 sm:px-8 lg:px-12 lg:pb-28 lg:pt-32">
        {backCollection ? (
          <Link
            href={backCollectionHref}
            className="mb-7 inline-flex items-center gap-2 text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/55 transition hover:text-gold"
          >
            <ArrowLeft size={14} />
            {backCollection.name}
          </Link>
        ) : null}
      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,35rem)_5.5rem_minmax(20rem,1fr)] lg:gap-x-3 xl:grid-cols-[minmax(0,35rem)_6.5rem_minmax(22rem,1fr)] xl:gap-x-4">
        <div className="flex justify-center lg:justify-start">
            <div
              ref={mainImageFrameRef}
              data-testid="product-image-viewport"
              className="isolate relative aspect-[3/4] h-auto w-full max-w-[35rem] overflow-hidden rounded-lg bg-sand"
              style={{ borderRadius: 8, clipPath: "inset(0 round 8px)" }}
            >
              {currentMainImage ? (
                <div
                  role="button"
                  data-testid="product-image-interaction-layer"
                  tabIndex={0}
                  aria-label={inlineZoomed ? "Return to normal product image" : "Zoom product image inline"}
                  aria-pressed={inlineZoomed}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (!inlineZoomed) {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setZoomOrigin(`${Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))}% ${Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))}%`);
                    }
                    setInlineZoomed((value) => !value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setInlineZoomed((value) => !value);
                    }
                    if (event.key === "Escape") setInlineZoomed(false);
                  }}
                  onPointerDown={(event) => { if (inlineZoomed) event.currentTarget.setPointerCapture(event.pointerId); }}
                  onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
                  onPointerMove={(event) => {
                    if (!inlineZoomed) return;
                    const rect = event.currentTarget.getBoundingClientRect();
                    setZoomOrigin(`${Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100))}% ${Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))}%`);
                  }}
                  className={`absolute inset-0 ${inlineZoomed ? "touch-none cursor-zoom-out" : "touch-pan-y cursor-zoom-in"}`}
                  style={{ borderRadius: 8 }}
                >
                  <Image
                    src={currentMainImage}
                    alt={product.name || "Product"}
                    fill
                    priority
                    data-testid="product-image-layer"
                    className={`h-full w-full rounded-lg object-contain transition-transform duration-300 ease-out ${inlineZoomed ? "scale-[1.7]" : "scale-100"}`}
                    style={{ borderRadius: 8, clipPath: "inset(0 round 8px)", transformOrigin: zoomOrigin }}
                    sizes="(max-width: 1024px) 100vw, 58vw"
                    onError={() => markImageUnavailable(currentImage)}
                  />
                </div>
              ) : (
                <div className="grid h-full place-items-center text-center text-charcoal/40">
                  <div>
                    <ImageIcon
                      size={30}
                      strokeWidth={1.2}
                      className="mx-auto"
                    />
                    <p className="mt-4 text-[0.58rem] uppercase tracking-[0.3em]">
                      Product image coming soon
                    </p>
                  </div>
                </div>
              )}
              {currentMainImage ? (
                <button
                  data-testid="product-image-zoom-control"
                  type="button"
                  onClick={(event) => { event.preventDefault(); event.stopPropagation(); setInlineZoomed((value) => !value); }}
                  aria-label={inlineZoomed ? "Back to normal product image" : "Zoom in on product image"}
                  className="absolute bottom-3 right-3 z-[1] inline-flex min-h-9 items-center gap-2 rounded-full bg-ink/70 px-3 text-[0.5rem] uppercase tracking-[0.14em] text-ivory backdrop-blur-sm transition hover:bg-ink/85 hover:text-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-4 sm:right-4"
                >
                  {inlineZoomed ? <><ZoomOut size={15} /> Back to image</> : <><ZoomIn size={15} /> Zoom</>}
                </button>
              ) : null}
              {media.length > 1 && !inlineZoomed ? (
                <>
                  <button
                    type="button"
                    onClick={previousImage}
                    aria-label="Previous product image"
                    className="absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    onClick={nextImage}
                    aria-label="Next product image"
                    className="absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-ivory/85 text-charcoal shadow-sm backdrop-blur-sm transition hover:text-gold"
                  >
                    <ChevronRight size={18} />
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {media.length > 1 ? (
            <div
              ref={thumbnailRailRef}
              style={
                thumbnailViewportHeight
                  ? { maxHeight: `${thumbnailViewportHeight}px` }
                  : undefined
              }
              className="rk-product-thumbnail-rail rk-gallery-scroll flex max-w-full snap-x gap-3 overflow-x-auto overflow-y-hidden pb-1 lg:w-[5.5rem] lg:snap-y lg:flex-col lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 xl:w-[6.5rem]"
            >
              {media.map((image, index) => (
                <button
                  ref={(node) => {
                    thumbnailRefs.current[index] = node;
                  }}
                  key={image + index}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  aria-label={`Show product image ${index + 1}`}
                  aria-current={activeImage === index}
                  className={
                    activeImage === index
                      ? "relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand ring-1 ring-gold ring-offset-2 ring-offset-ivory lg:w-full"
                      : "relative aspect-[3/4] w-[5.5rem] shrink-0 snap-start overflow-hidden rounded-[12px] bg-sand opacity-65 transition hover:opacity-100 lg:w-full"
                  }
                >
                  <Image
                    src={cloudinaryImageUrl(image, 240) || image}
                    alt=""
                    fill
                    className="object-contain object-center"
                    sizes="(max-width: 1023px) 5.5rem, 6.5rem"
                    onError={() => markImageUnavailable(image)}
                  />
                </button>
              ))}
            </div>
          ) : null}
          <div
            className={
              media.length > 1
                ? "lg:sticky lg:top-28 lg:self-start lg:pl-[clamp(4rem,5vw,6.25rem)] lg:pt-2"
                : "lg:sticky lg:top-28 lg:col-start-3 lg:self-start lg:pl-[clamp(4rem,5vw,6.25rem)] lg:pt-2"
            }
          >
            <p className="text-xs font-normal uppercase tracking-[0.28em] text-gold">
              {product.category || "Couture"}
            </p>
            {backCollection ? (
              <p className="mt-4 font-display text-[clamp(1.35rem,1.6vw,1.7rem)] leading-none text-charcoal/85">
                {backCollection.name}
              </p>
            ) : null}
            <h1 className="mt-4 font-display text-[clamp(2.625rem,4vw,3.25rem)] leading-[0.95]">
              {product.name || "Untitled piece"}
            </h1>
            {shortDescription ? (
              <p className="mt-5 text-sm font-semibold uppercase leading-6 tracking-[0.02em] text-charcoal sm:text-base">
                {shortDescription}
              </p>
            ) : null}
            {product.styleCode || selectedSku ? (
              <p className={`mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 ${productDetailLabelClass}`}>
                {product.styleCode ? <span>Style Code: {product.styleCode}</span> : null}
                {selectedSku ? <span className="inline-flex items-center gap-x-3">{product.styleCode ? <span aria-hidden="true">|</span> : null}<span>SKU: {selectedSku}</span></span> : null}
              </p>
            ) : null}
            {productDescription || detailedDescription ? (
              <p className="mt-6 text-[0.95rem] leading-7 text-charcoal/68">
                {productDescription || detailedDescription}
              </p>
            ) : null}
            {material || construction ? (
              <dl aria-label="Material and construction" className="mt-6 grid grid-cols-1 items-baseline gap-x-3 gap-y-3 border-t border-black/10 pt-5 text-sm leading-7 text-charcoal/68 sm:grid-cols-[9rem_minmax(0,1fr)]">
                {material ? <><dt className={productDetailLabelClass}>Material:</dt><dd className="min-w-0 break-words">{material}</dd></> : null}
                {construction ? <><dt className={productDetailLabelClass}>Construction:</dt><dd className="min-w-0 break-words">{construction}</dd></> : null}
              </dl>
            ) : null}
            {productAttributes.length ? <dl aria-label="Product attributes" className="mt-5 grid grid-cols-1 gap-x-6 gap-y-4 border-y border-black/10 py-5 min-[380px]:grid-cols-2 xl:grid-cols-3">
              {productAttributes.map(([label, value]) => <div key={label} className="min-w-0"><dt className={productDetailLabelClass}>{label}:</dt><dd className="mt-2 break-words text-sm leading-6 text-charcoal/68">{value}</dd></div>)}
            </dl> : null}

            {variantOptions.length ? (
              <div role="group" aria-labelledby="product-colour-label" data-product-selection-controls className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
                <span id="product-colour-label" className={productDetailLabelClass}>Colour:</span>
                <div className="flex flex-wrap items-center">
                  {variantOptions.map((variant) => {
                    const colour = normalizeColour(variant.colour) || "DEFAULT";
                    const label = `${colour}${variant.status === "inactive" ? " — Sold out" : ""}`;
                    return (
                      <label key={variant.id} title={label} className="relative inline-flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center">
                        <input
                          type="radio"
                          name="product-colour"
                          value={variant.id}
                          checked={selectedVariant?.id === variant.id}
                          onChange={() => chooseVariant(variant.id)}
                          aria-label={label}
                          className="peer sr-only"
                        />
                        <span
                          aria-hidden="true"
                          className="h-5 w-5 rounded-full border border-black/20 ring-offset-2 ring-offset-ivory transition peer-checked:ring-1 peer-checked:ring-charcoal peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-[5px] peer-focus-visible:outline-charcoal"
                          style={{ backgroundColor: colourSwatchValue(variant.colour, colourSwatches) || "#b7aa99" }}
                        />
                      </label>
                    );
                  })}
                </div>
                <span aria-live="polite" className="text-xs text-charcoal/68">{selectedColour || "DEFAULT"}{soldOut ? " — Sold out" : ""}</span>
              </div>
            ) : selectedColour ? (
              <p className="mt-2 text-xs text-charcoal/68">
                <span className={productDetailLabelClass}>Colour:</span>{" "}
                {selectedColour}
              </p>
            ) : null}
          <div className="mt-7 border-t border-black/12 pt-5 dark:border-white/15">
              <PriceCurrencyRow amount={selectedPrice} sale={currentPrice.sale} className="text-lg" />
              <p className="mt-3 text-[0.58rem] uppercase tracking-[0.25em] text-gold">
                {availabilityLabels[selectedAvailability]}
              </p>
            </div>
            {runwayCustomOrder ? (
              <div className="mt-6 border border-gold/35 bg-gold/[.06] p-4">
                <p className="text-[0.58rem] uppercase tracking-[0.25em] text-gold">
                  Custom orders considered
                </p>
                <p className="mt-3 text-sm leading-6 text-charcoal/65">
                  This Runway piece is made available by request. The RK team
                  will review your custom order and get back to you by email.
                </p>
              </div>
            ) : null}
            <div data-product-selection-controls className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              <div className="min-w-0 flex-1">
            {showSizeSelector ? (
              <fieldset className="min-w-0">
                <legend className="sr-only">Choose a size</legend>
                <div data-product-size-options className="w-fit max-w-full">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">
                    Size
                  </span>
                  <SizeChartPopover />
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {sizes.map((size) => {
                    const unavailable = soldOut;
                    return (
                      <button
                        key={size}
                        type="button"
                        disabled={unavailable}
                        onClick={() => {
                          setSelectedSize(size);
                          setCustomMeasurements({});
                          setQuantity(1);
                          setMessage("");
                        }}
                        aria-label={`${size}${unavailable ? ", unavailable" : ""}`}
                        className={`min-w-12 border px-3 py-2.5 text-xs transition ${selectedSize === size ? "border-gold bg-gold text-ink" : "border-black/15 hover:border-gold dark:border-white/20"} ${unavailable ? "cursor-not-allowed opacity-30" : ""}`}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
                </div>
                {customSizeFields.length && !soldOut ? (
                  <button
                    type="button"
                    onClick={() => setCustomSizeOpen(true)}
                    className="mt-3 inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"
                  >
                    <Ruler size={14} />
                    Want a custom size?
                  </button>
                ) : null}
              </fieldset>
            ) : customSizeFields.length && !soldOut ? (
              <button
                type="button"
                onClick={() => setCustomSizeOpen(true)}
                className="inline-flex items-center gap-2 border-b border-charcoal/30 pb-2 text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/70 transition hover:border-gold hover:text-gold"
              >
                <Ruler size={14} />
                Want a custom size?
              </button>
            ) : null}
            {customMeasurements._customReady ? (
              <p className="mt-2 text-xs text-gold">
                Custom measurements added to this piece.
              </p>
            ) : null}
              </div>
            {!soldOut && !runwayCustomOrder ? (
              <div role="group" aria-labelledby="product-quantity-label" className="flex shrink-0 flex-col items-start sm:items-end">
                <span id="product-quantity-label" className="text-[0.58rem] uppercase tracking-[0.28em] text-charcoal/50">
                  Quantity
                </span>
                <div className="mt-3 flex h-[2.625rem] items-center gap-3">
                  <button
                    type="button"
                    disabled={quantity <= 1}
                    onClick={() =>
                      setQuantity((value) => Math.max(1, value - 1))
                    }
                    aria-label="Decrease quantity"
                    className="grid h-10 w-10 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"
                  >
                    <Minus size={13} />
                  </button>
                  <output aria-live="polite" aria-label="Selected quantity" className="min-w-5 text-center text-sm">
                    {quantity}
                  </output>
                  <button
                    type="button"
                    disabled={quantity >= 50}
                    onClick={() =>
                      setQuantity((value) => Math.min(50, value + 1))
                    }
                    aria-label="Increase quantity"
                    className="grid h-10 w-10 place-items-center border border-black/15 transition hover:border-gold disabled:cursor-not-allowed disabled:opacity-35 dark:border-white/20"
                  >
                    <Plus size={13} />
                  </button>
                </div>
              </div>
            ) : null}
            </div>
            <div data-product-purchase-controls className="mt-5 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 sm:gap-3">
              {!runwayCustomOrder ? <button type="button" disabled={soldOut} onClick={() => addToCart("buy")} className="min-h-12 bg-ink px-3 py-3.5 text-[0.62rem] uppercase tracking-[0.18em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-not-allowed disabled:opacity-45">Buy now</button> : null}
              <button
                type="button"
                disabled={soldOut && !runwayCustomOrder}
                onClick={runwayCustomOrder ? requestCustomOrder : () => addToCart()}
                className={`inline-flex min-h-12 items-center justify-center gap-2 border border-charcoal/30 px-3 py-3.5 text-[0.62rem] uppercase tracking-[0.16em] text-charcoal transition hover:border-gold hover:text-gold disabled:cursor-not-allowed disabled:opacity-45 ${runwayCustomOrder ? "col-span-2" : ""}`}
              >
                {runwayCustomOrder ? (
                  <Mail size={16} />
                ) : (
                  <ShoppingBag size={16} />
                )}
                {runwayCustomOrder
                  ? "Request custom order"
                  : soldOut
                    ? "Sold out"
                    : "Add to cart"}
              </button>
              <button
                type="button"
                onClick={saveProduct}
                aria-pressed={saved}
                aria-label={saved ? "Remove from wishlist" : "Add to wishlist"}
                className="grid w-11 place-items-center border border-black/15 transition hover:border-gold hover:text-gold dark:border-white/20"
              >
                <Heart
                  size={18}
                  className={saved ? "fill-gold text-gold" : ""}
                />
              </button>
            </div>
            <AiTryon product={product} variantId={selectedVariant?.id} productImage={currentMainImage || media[0] || ""} />
            {message ? (
              <p className="mt-4 text-xs text-gold">{message}</p>
            ) : null}
            <div className="mt-6"><ShippingTimeline timeline={shippingTimeline} explainModels collapsible /></div>
            {disclaimer ? <section aria-label="Disclaimer" className="mt-5 border-b border-black/10 pb-5"><h2 className={productDetailLabelClass}>Disclaimer:</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-charcoal/65">{disclaimer}</p></section> : null}
            <section aria-label="Product assistance" className="mt-5 grid bg-sand/30 xl:grid-cols-[minmax(0,1fr)_11rem]">
              <div className="grid gap-5 p-4 sm:grid-cols-2">{[
                { Icon: Scissors, title: 'Customisations', copy: 'Same style in a bespoke color' },
                { Icon: Layers, title: "Don't want the whole set?", copy: 'Buy only one item from the look' },
                { Icon: Video, title: 'Live Product Preview', copy: 'Call us to see the product live.' },
                { Icon: Truck, title: 'Early Delivery', copy: 'Need the product sooner?' },
              ].map(({ Icon, title, copy }) => <div key={title} className="flex items-start gap-3"><Icon aria-hidden="true" size={17} strokeWidth={1.25} className="mt-0.5 shrink-0 text-charcoal/55" /><div><h3 className="text-xs font-medium leading-5">{title}</h3><p className="mt-1 text-xs leading-5 text-charcoal/65">{copy}</p></div></div>)}</div>
              {whatsappHref ? <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch border-t border-black/10 xl:flex xl:flex-col xl:border-l xl:border-t-0"><p className="p-4 text-xs leading-5 text-charcoal/65">Do you need help with customisation or shipping of this product?</p><a href={whatsappHref} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 border-l border-black/10 bg-sand/25 px-3 xl:mt-auto xl:border-l-0 xl:border-t xl:py-3 text-[0.58rem] uppercase tracking-[0.14em] hover:border-gold hover:text-gold"><MessageCircle size={14} />Chat with us</a></div> : null}
            </section>
            {informationSections.length ? (
              <div className="mt-8 border-t border-black/12 dark:border-white/15">
                {informationSections.map((section) => (
                  <div
                    key={section.id}
                    className="border-b border-black/12 dark:border-white/15"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setOpenSection((current) =>
                          current === section.id ? "" : section.id,
                        )
                      }
                      aria-expanded={openSection === section.id}
                      className="flex w-full items-center justify-between py-4 text-left text-[0.6rem] uppercase tracking-[0.28em]"
                    >
                      <span>{section.label}</span>
                      <Plus
                        size={15}
                        className={`transition-transform ${openSection === section.id ? "rotate-45" : ""}`}
                      />
                    </button>
                    <AnimatePresence initial={false}>
                      {openSection === section.id ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="pb-5">{section.content}</div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                ))}
          </div>
            ) : null}
        </div>
      </div>
    </section>
      {relatedProductsLoading || relatedProducts.length ? (
        <section className="border-t border-black/10 bg-ivory px-4 pb-20 pt-16 text-charcoal dark:border-white/10 sm:px-8 sm:pb-24 lg:px-12 lg:pt-20">
      <div className="mx-auto max-w-[100rem]">
            <p className="text-xs uppercase tracking-[0.3em] text-gold">
              From the collection
            </p>
            <h2 className="mt-4 font-display text-4xl uppercase leading-none tracking-[0.03em] sm:text-5xl">
              YOU MAY ALSO LIKE
            </h2>
            {relatedProductsLoading ? (
              <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 lg:grid-cols-4 lg:gap-x-7">
                {Array.from({ length: 4 }, (_, index) => (
                  <div key={index} className="animate-pulse">
                    <div className="aspect-[3/4] bg-sand" />
                    <div className="mt-4 h-3 w-1/3 bg-sand" />
                    <div className="mt-3 h-5 w-3/4 bg-sand" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-10 grid grid-cols-2 gap-x-3 gap-y-10 md:grid-cols-3 md:gap-x-6 md:gap-y-14 lg:grid-cols-4 lg:gap-x-7">
                {relatedProducts.map((relatedProduct) => (
                  <CollectionProductCard
                    key={relatedProduct.id}
                    product={relatedProduct}
                  />
                ))}
      </div>
            )}
          </div>
        </section>
      ) : null}
    <Footer />
    <FloatingProductChat href={whatsappHref} hidden={sizePromptOpen || customSizeOpen || customOrderOpen} />
    <SizeSelectionDialog open={sizePromptOpen} sizes={sizes} custom={Boolean(customSizeFields.length)} onClose={() => { setSizePromptOpen(false); pendingPurchase.current = null; }} onSelect={size => {
      const action = pendingPurchase.current;
      pendingPurchase.current = null;
      setSelectedSize(size); setCustomMeasurements({}); setMessage(""); setSizePromptOpen(false);
      if (action) addToCart(action, size, {});
    }} onCustom={() => { setSizePromptOpen(false); setCustomSizeOpen(true); }} />
    <AnimatePresence>
        {customSizeOpen ? (
          <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] grid place-items-center bg-ink/65 p-4"
        onClick={() => { pendingPurchase.current = null; setCustomSizeOpen(false); }}
      >
        <motion.div
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Enter custom measurements"
          ref={customSizeDialogRef}
          className="max-h-[90vh] w-full max-w-lg overflow-y-auto bg-ivory p-6 text-charcoal shadow-2xl sm:p-8"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
                  <p className="text-[0.58rem] uppercase tracking-[0.28em] text-gold">
                    Made for you
                  </p>
                  <h2 className="mt-3 font-display text-3xl">
                    Custom measurements
                  </h2>
            </div>
                <button
                  type="button"
                  onClick={() => { pendingPurchase.current = null; setCustomSizeOpen(false); }}
                  aria-label="Close custom measurements"
                >
                  <X size={19} />
                </button>
          </div>
              <p className="mt-4 text-sm leading-6 text-charcoal/60">
                Enter the measurements requested for this piece. They will
                remain attached to your order for the RK team.
              </p>
          <label className="mt-6 block text-[0.58rem] uppercase tracking-[0.22em] text-charcoal/50">
            Unit
                <select
                  value={customSizeUnit}
                  onChange={(event) =>
                    setCustomSizeUnit(event.target.value as "cm" | "in")
                  }
                  className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm outline-none"
                >
              <option value="cm">Centimetres (cm)</option>
              <option value="in">Inches (in)</option>
            </select>
          </label>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
                {customSizeFields.map((field) => (
                  <label
                    key={field}
                    className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50"
                  >
              {field}
              <input
                inputMode="decimal"
                      value={customMeasurements[field] ?? ""}
                      onChange={(event) =>
                        setCustomMeasurements((current) => ({
                          ...current,
                          [field]: event.target.value,
                          _customReady: "",
                        }))
                      }
                className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
              />
                  </label>
                ))}
          </div>
              {customSizeError ? (
                <p role="alert" className="mt-5 text-sm text-red-700">
                  {customSizeError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={saveCustomMeasurements}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.24em] text-ivory transition hover:bg-gold hover:text-ink"
              >
                <Check size={14} />
                Use these measurements
              </button>
        </motion.div>
          </motion.div>
        ) : null}
    </AnimatePresence>
    <AnimatePresence>
        {customOrderOpen ? (
          <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[110] grid place-items-center bg-ink/65 p-4"
        onClick={() => setCustomOrderOpen(false)}
      >
        <motion.div
          initial={{ y: 18, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 18, opacity: 0 }}
          onClick={(event) => event.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Request a custom order"
          className="max-h-[92vh] w-full max-w-xl overflow-y-auto bg-ivory p-6 text-charcoal shadow-2xl sm:p-8"
        >
          <div className="flex items-start justify-between gap-5">
            <div>
                  <p className="text-[0.58rem] uppercase tracking-[0.28em] text-gold">
                    Made on request
                  </p>
                  <h2 className="mt-3 font-display text-3xl">
                    Request a custom order
                  </h2>
            </div>
                <button
                  type="button"
                  onClick={() => setCustomOrderOpen(false)}
                  aria-label="Close custom order request"
                >
                  <X size={19} />
                </button>
          </div>
              <p className="mt-4 text-sm leading-6 text-charcoal/60">
                Tell us how you would like this piece made. The RK team will
                review your request and get back to you by email.
              </p>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
                  Name
                  <input
                    value={customOrderName}
                    onChange={(event) => setCustomOrderName(event.target.value)}
                    className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
                    autoComplete="name"
                  />
                </label>
                <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
                  Email
                  <input
                    type="email"
                    value={customOrderEmail}
                    onChange={(event) =>
                      setCustomOrderEmail(event.target.value)
                    }
                    className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
                    autoComplete="email"
                  />
                </label>
                <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
                  Phone{" "}
                  <span className="normal-case tracking-normal text-charcoal/35">
                    (optional)
                  </span>
                  <input
                    value={customOrderPhone}
                    onChange={(event) =>
                      setCustomOrderPhone(event.target.value)
                    }
                    className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
                    autoComplete="tel"
                  />
                </label>
                <label className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
                  Preferred size{" "}
                  <span className="normal-case tracking-normal text-charcoal/35">
                    (optional)
                  </span>
                  <select
                    value={customOrderSize}
                    onChange={(event) => setCustomOrderSize(event.target.value)}
                    className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
                  >
                    <option value="">Tell us in the request</option>
                    {sizes.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                    <option value="Custom measurements">
                      Custom measurements
                    </option>
                  </select>
                </label>
              </div>
              {customSizeFields.length ? (
                <div className="mt-6">
                  <p className="text-[0.58rem] uppercase tracking-[0.2em] text-charcoal/50">
                    Measurements{" "}
                    <span className="normal-case tracking-normal text-charcoal/35">
                      (optional)
                    </span>
                  </p>
                  <div className="mt-3 grid gap-5 sm:grid-cols-2">
                    {customSizeFields.map((field) => (
                      <label
                        key={field}
                        className="text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50"
                      >
                        {field}
                        <input
                          inputMode="decimal"
                          value={customMeasurements[field] ?? ""}
                          onChange={(event) =>
                            setCustomMeasurements((current) => ({
                              ...current,
                              [field]: event.target.value,
                              _customReady: "",
                            }))
                          }
                          className="mt-2 w-full border-b border-black/15 bg-transparent py-3 text-sm normal-case tracking-normal outline-none"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}
              <label className="mt-6 block text-[0.58rem] uppercase tracking-[0.18em] text-charcoal/50">
                Request details{" "}
                <span className="normal-case tracking-normal text-charcoal/35">
                  (optional)
                </span>
                <textarea
                  value={customOrderMessage}
                  onChange={(event) =>
                    setCustomOrderMessage(event.target.value)
                  }
                  rows={4}
                  placeholder="Share your preferred fit, occasion, or any details for the RK team."
                  className="mt-2 w-full resize-none border border-black/15 bg-transparent p-3 text-sm normal-case tracking-normal outline-none placeholder:text-charcoal/35"
                />
              </label>
              {customOrderError ? (
                <p role="alert" className="mt-5 text-sm text-red-700">
                  {customOrderError}
                </p>
              ) : null}
              <button
                type="button"
                onClick={submitCustomOrder}
                disabled={customOrderBusy}
                className="mt-8 inline-flex w-full items-center justify-center gap-2 bg-ink px-5 py-4 text-[0.6rem] uppercase tracking-[0.24em] text-ivory transition hover:bg-gold hover:text-ink disabled:cursor-wait disabled:opacity-50"
              >
                <Mail size={14} />
                {customOrderBusy
                  ? "Sending request..."
                  : "Send custom order request"}
              </button>
            </motion.div>
        </motion.div>
        ) : null}
    </AnimatePresence>
    </main>
  );
}
