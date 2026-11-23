"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ExternalLink, PackageCheck, X } from "lucide-react";
import { PaymentCollectionPanel } from "@/components/orders/payment-collection";
import { apiBaseUrl } from "@/lib/rbac";
import { notificationStatusLabel, notificationReasonLabel, savedWhatsAppRetryEvents } from "@/lib/order-notifications";
import {
  fulfillmentLabels,
  orderStatusLabel,
  inr,
  orderDateTime,
  paymentLabels,
  titleCase,
  type Order,
} from "@/lib/orders";

const fieldClass =
  "mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-2.5 text-xs outline-none focus:border-[#9a7a4d] dark:border-white/10 dark:bg-[#121317]";
const panelClass =
  "rounded-xl border border-black/[.07] bg-[#faf8f4] p-5 dark:border-white/[.08] dark:bg-white/[.025]";
const actionLabels: Record<string, string> = {
  confirmed: "Accept Order",
  processing: "Mark as Processed",
  packed: "Mark as Packed",
  shipped: "Mark as Shipped",
  out_for_delivery: "Mark as Out for Delivery",
  delivered: "Mark as Delivered",
  returned: "Mark Returned",
  refunded: "Mark Refunded",
  shipment_update: "Update Tracking",
  return_accept: "Accept Return",
};
const hasOrderAcceptance = (order: Order) =>
  order.availabilityDecision?.status === "accepted" ||
  order.timeline?.some(event => event.status === "order_accepted" && typeof event.id === "string" && Boolean(event.id.trim()));
const actionLabel = (action: string, order: Order) =>
  action === "cancelled"
    ? hasOrderAcceptance(order) ? "Cancellation Requested" : "Reject Order"
    : actionLabels[action] || titleCase(action);

const whatsappReasons: Record<string, string> = {
  ...Object.fromEntries(['legacy_template_mapping_requires_migration', 'meta_body_correction_required',
    'template_approval_unverified', 'template_components_unverified', 'template_mapping_disabled', 'template_evidence_stale']
    .map(reason => [reason, notificationReasonLabel(reason)])),
  missing_phone: 'No order contact number is available.', invalid_recipient: 'The order contact needs a valid international country code.',
  missing_or_withdrawn_consent: 'Transactional WhatsApp consent is missing, withdrawn, or does not cover this number.',
  template_not_approved_or_enabled: 'Waiting for an enabled Utility template with confirmed Meta approval.',
  shipment_not_recorded: 'Waiting for courier, AWB/tracking number and dispatch date.',
  business_event_not_confirmed: 'The required payment, order or refund result has not been confirmed.',
  automation_disabled: 'Automated WhatsApp messaging is disabled.', disabled_or_configuration_incomplete: 'Messaging is disabled or backend configuration is incomplete.',
  staff_notifications_disabled: 'Customer notifications were switched off for this update.',
  consent_or_event_changed: 'Consent or the business event changed before dispatch.',
  business_event_or_consent_changed: 'The queued event or consent changed; this job will not send.',
  operator_reconciliation_required: 'Delivery outcome needs operator reconciliation before retrying.',
  notification_unavailable: 'The notification service could not queue this event. The order update was saved.',
  queue_expired_or_unavailable: 'The queued notification expired or is no longer available; reconcile before retrying.',
};
const localDispatchValue = (value?: string) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function AdminOrderDetail({ orderId }: { orderId: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryEvent, setRetryEvent] = useState("");
  const [recoveryReason, setRecoveryReason] = useState("");
  const [investigation, setInvestigation] = useState({ operationId: "", findings: "", evidenceReference: "", externalStockCount: "", outcome: "unresolved", followUpStatus: "awaiting_warehouse", supersedesId: "" });
  const [form, setForm] = useState({
    courier: "",
    trackingNumber: "",
    trackingUrl: "",
    shippedAt: "",
    customerNote: "",
    sendCustomerNotification: true,
    receivedBy: "",
    proofPhoto: "",
    signature: "",
    availabilityConfirmed: false,
    rejectionReason: "",
    rejectionExplanation: "",
  });
  const token = () => window.localStorage.getItem("rk_access_token") || "";

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/orders/${orderId}`,
        { headers: { Authorization: `Bearer ${token()}` }, cache: "no-store" },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to load this order.");
      setOrder(payload.order);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Unable to load this order.",
      );
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    void load();
  }, [load]);

  const retryEvents = order ? savedWhatsAppRetryEvents(order) : [];
  const retryOptions = [...retryEvents, ...(order?.paymentTransactions || [])
    .filter(t => ["advance_payment_received", "part_payment_received", "payment_received"].includes(t.event))
    .map(t => `${t.event}|${t.id}`)];
  const retrySelectionValid = retryOptions.includes(retryEvent);
  const retryNotification = async () => {
    if (!order || !retrySelectionValid || busy) return;
    setBusy(true); setError("");
    try {
      const [event, transactionId] = retryEvent.split("|");
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/notifications/retry`, { method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" }, body: JSON.stringify({ event, transactionId, channel: "whatsapp" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to retry notification.");
      setOrder(data.order); setMessage("Notification eligibility rechecked. Review delivery activity.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to retry notification."); }
    finally { setBusy(false); }
  };

  const reconcileInventory = async () => {
    if (!order || busy || recoveryReason.trim().length < 8) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/inventory-reconciliation`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reconcile_product_markers", reason: recoveryReason.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Inventory reconciliation could not be completed.");
      setOrder(data.order); setMessage(data.message || "Inventory evidence reconciled."); setRecoveryReason("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Inventory reconciliation could not be completed."); }
    finally { setBusy(false); }
  };

  const saveInvestigation = async () => {
    if (!order || busy) return;
    const operations = [...(order.inventoryReconciliation?.operations?.capture || []), ...(order.inventoryReconciliation?.operations?.manual || [])];
    const operation = operations.find(row => row.operationId === investigation.operationId);
    if (!operation) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/inventory-investigations`, {
        method: "POST", headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...investigation, reason: recoveryReason.trim(), productId: operation.productId, itemIndex: operation.itemIndex,
          externalStockCount: investigation.externalStockCount.trim() === "" ? null : Number(investigation.externalStockCount), supersedesId: investigation.supersedesId || null }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Investigation could not be recorded.");
      setOrder(data.order); setMessage("Investigation recorded. Stock and fulfilment are unchanged; unresolved cases remain blocked.");
      setInvestigation({ operationId: "", findings: "", evidenceReference: "", externalStockCount: "", outcome: "unresolved", followUpStatus: "awaiting_warehouse", supersedesId: "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Investigation could not be recorded."); }
    finally { setBusy(false); }
  };

  const openAction = (next: string) => {
    if (!order) return;
    setForm({
      courier: order.fulfillment.courier || "",
      trackingNumber: order.fulfillment.trackingNumber || "",
      trackingUrl: order.fulfillment.trackingUrl || "",
      shippedAt: localDispatchValue(order.fulfillment.shippedAt),
      customerNote: "",
      sendCustomerNotification: true,
      receivedBy: "",
      proofPhoto: "",
      signature: "",
      availabilityConfirmed: false,
    rejectionReason: "",
      rejectionExplanation: "",
    });
    setAction(next);
    setError("");
    setMessage("");
  };

  const readProof = (field: "proofPhoto" | "signature", file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 1_800_000) {
      setError("Proof images must be smaller than 1.8 MB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () =>
      setForm((current) => ({
        ...current,
        [field]: String(reader.result || ""),
      }));
    reader.readAsDataURL(file);
  };

  const submit = async () => {
    if (!order || !action) return;
    setBusy(true);
    setError("");
    try {
      const path =
        action === "shipment_update"
          ? "shipment"
          : action === "return_accept"
            ? "return"
            : "fulfillment";
      const body =
        action === "shipment_update"
          ? form
          : action === "return_accept"
            ? form
            : { ...form, status: action, note: form.customerNote };
      const response = await fetch(
        `${apiBaseUrl}/api/staff/orders/${order.id}/${path}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token()}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ ...body, shippedAt: form.shippedAt ? new Date(form.shippedAt).toISOString() : undefined }),
        },
      );
      const payload = await response.json();
      if (!response.ok)
        throw new Error(payload.error || "Unable to update this order.");
      setOrder(payload.order);
      setAction(null);
      setMessage("Order updated successfully.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Unable to update this order.",
      );
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!order) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(
        `${apiBaseUrl}/api/staff/orders/${order.id}/confirmation-email`,
        { method: "POST", headers: { Authorization: `Bearer ${token()}` } },
      );
      const payload = await response.json();
      if (payload.order) setOrder(payload.order);
      if (!response.ok)
        throw new Error(
          payload.error || payload.message || "Email delivery failed.",
        );
      setMessage(payload.message || "Order confirmation sent.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Email delivery failed. The paid order is unchanged.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (loading)
    return (
      <section className="mt-10 h-96 animate-pulse rounded-2xl bg-white dark:bg-[#191a1f]" />
    );
  if (!order)
    return (
      <section className="mt-10 rounded-2xl bg-white p-8 text-sm text-red-600">
        {error || "Order not found."}
      </section>
    );
  const address = order.shippingAddress || order.shipping || {};
  const actionList = order.availableActions || [];
  return (
    <section className="mt-10 rounded-2xl border border-black/[.06] bg-white p-5 shadow-[0_4px_20px_rgba(25,31,38,.035)] dark:border-white/[.08] dark:bg-[#191a1f] sm:p-8">
      <Link
        href="/admin/orders"
        className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[.18em] text-[#9a7a4d]"
      >
        <ArrowLeft size={14} /> Admin orders
      </Link>
      <div className="mt-6 flex flex-col justify-between gap-5 border-b border-black/[.08] pb-7 dark:border-white/[.08] md:flex-row md:items-end">
        <div>
          <p className="text-[9px] uppercase tracking-[.2em] text-[#9a7a4d]">
            Order details
          </p>
          <h1 className="mt-2 text-3xl font-semibold">#{order.orderNumber}</h1>
          <p className="mt-2 text-xs text-[#858b94]">
            Created {orderDateTime(order.createdAt)}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="rounded-full border border-emerald-500/30 px-3 py-1 text-[9px] uppercase tracking-[.14em] text-emerald-700">
            Payment: {paymentLabels[order.paymentStatus]}
          </span>
          <span className="rounded-full border border-[#9a7a4d]/35 px-3 py-1 text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]">
            {orderStatusLabel(order)}
          </span>
        </div>
      </div>
      {message ? (
        <p className="mt-5 text-sm text-emerald-700">{message}</p>
      ) : null}
      {error ? <p className="mt-5 text-sm text-red-600">{error}</p> : null}
      <section
        className={`${panelClass} mt-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-center`}
      >
        <div>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            {order.payment.gateway === "manual" ? "Order received email" : "Order confirmation email"}
          </p>
          <p className="mt-2 text-xs text-[#858b94]">
            Status: {order.confirmationEmail?.status === "sent" ? 'Accepted by provider' : titleCase(order.confirmationEmail?.status || "pending")} ·
            Attempts: {order.confirmationEmail?.attempts || 0}
          </p>
          {order.confirmationEmail?.error ? (
            <p className="mt-1 max-w-2xl text-xs text-red-600">
              {notificationReasonLabel(order.confirmationEmail.error)}
            </p>
          ) : null}
        </div>
        {order.paymentStatus === "paid" ? (
          <button
            type="button"
            disabled={busy || Boolean(order.inventoryReconciliation?.blocked) || ['sent', 'sending', 'held'].includes(order.confirmationEmail?.status || '')}
            onClick={() => void resendConfirmation()}
            className="rounded-lg border border-[#9a7a4d]/40 px-4 py-2.5 text-[9px] uppercase tracking-[.14em] text-[#9a7a4d] disabled:opacity-40"
          >
            {order.confirmationEmail?.status === "sent"
              ? "Email accepted"
              : "Send confirmation"}
          </button>
        ) : null}
      </section>
      <PaymentCollectionPanel order={order} onUpdate={setOrder} />
      {order.inventoryReservation === "reserving" && <p role="alert" className="mt-4 text-red-700">Stock reservation needs staff reconciliation before acceptance can be retried.</p>}
      {order.inventoryReconciliation?.blocked && <section role="alert" className="mt-5 rounded-lg border border-amber-700/30 bg-amber-50 p-4 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
        <h3 className="font-medium">Inventory reconciliation required</h3>
        <p className="mt-1">Fulfillment and success notifications remain blocked until persisted inventory evidence is resolved. Payment evidence is retained.</p>
        <p className="mt-1 text-xs">Capture state: {order.captureFulfillmentStatus || "Not applicable"}. Reservation state: {order.inventoryReservation || "Not started"}.</p>
        {[...(order.inventoryReconciliation.operations?.capture || []), ...(order.inventoryReconciliation.operations?.manual || [])].map((operation) => <div key={operation.operationId} className="mt-2 break-all text-xs">
          Item {operation.itemIndex + 1}: {operation.state}; product marker {operation.productMarkerPresent ? (operation.markerMatches ? "verified" : "does not match") : "not found"}; quantity {operation.quantity}.
          {operation.stockDelta != null ? ` Stock delta ${operation.stockDelta}.` : ""} {operation.createdAt ? ` Recorded ${orderDateTime(operation.createdAt)}.` : ""}
        </div>)}
        <label className="mt-3 block text-xs">Recovery reason<input value={recoveryReason} onChange={(event) => setRecoveryReason(event.target.value)} maxLength={500} className={fieldClass} /></label>
        {order.inventoryReconciliation.markerReconciliationAvailable && <button type="button" disabled={busy || recoveryReason.trim().length < 8} onClick={() => void reconcileInventory()} className="mt-3 rounded border border-amber-800/40 px-3 py-2 text-xs disabled:opacity-40">Reconcile verified product markers</button>}
        {order.inventoryReconciliation.manualInvestigationRequired && <p className="mt-3 text-xs font-medium">The persisted records cannot prove the complete stock operation. This order remains blocked and requires manual inventory investigation.</p>}
        <fieldset className="mt-4 space-y-3 border-t border-amber-800/20 pt-4">
          <legend className="text-sm font-medium">Record warehouse investigation</legend>
          <p className="text-xs">Records findings only. It does not adjust stock, complete recovery or send notifications. Enter inventory facts and internal document IDs; omit customer details and credentials.</p>
          <label className="block text-xs">Inventory operation<select value={investigation.operationId} onChange={e => setInvestigation({ ...investigation, operationId: e.target.value, supersedesId: "" })} className={fieldClass}><option value="">Choose operation</option>{[...(order.inventoryReconciliation.operations?.capture || []), ...(order.inventoryReconciliation.operations?.manual || [])].map(row => <option key={row.operationId} value={row.operationId}>Item {row.itemIndex + 1}: {row.operationId}</option>)}</select></label>
          <label className="block text-xs">Warehouse findings<textarea maxLength={1500} value={investigation.findings} onChange={e => setInvestigation({ ...investigation, findings: e.target.value })} className={fieldClass} /></label>
          <label className="block text-xs">External stock count<input type="number" min="0" step="1" value={investigation.externalStockCount} onChange={e => setInvestigation({ ...investigation, externalStockCount: e.target.value })} className={fieldClass} /></label>
          <label className="block text-xs">Evidence document ID<input maxLength={120} value={investigation.evidenceReference} onChange={e => setInvestigation({ ...investigation, evidenceReference: e.target.value })} className={fieldClass} /></label>
          <label className="block text-xs">Investigation outcome<select value={investigation.outcome} onChange={e => setInvestigation({ ...investigation, outcome: e.target.value })} className={fieldClass}><option value="unresolved">Unresolved</option><option value="evidence_collected">Evidence collected — remains unresolved</option><option value="escalated">Escalated</option></select></label>
          <label className="block text-xs">Follow-up status<select value={investigation.followUpStatus} onChange={e => setInvestigation({ ...investigation, followUpStatus: e.target.value })} className={fieldClass}><option value="awaiting_warehouse">Awaiting warehouse</option><option value="awaiting_administrator">Awaiting administrator</option><option value="under_review">Under review</option></select></label>
          <label className="block text-xs">Correct previous entry<select value={investigation.supersedesId} onChange={e => setInvestigation({ ...investigation, supersedesId: e.target.value })} className={fieldClass}><option value="">New investigation</option>{order.inventoryReconciliation.investigations?.filter(row => row.operationId === investigation.operationId).map(row => <option key={row.id} value={row.id}>{row.id}</option>)}</select></label>
          <button type="button" disabled={busy || !investigation.operationId || recoveryReason.trim().length < 8 || investigation.findings.trim().length < 8 || !investigation.evidenceReference || !investigation.externalStockCount.trim()} onClick={() => void saveInvestigation()} className="rounded border border-amber-800/40 px-3 py-2 text-xs disabled:opacity-40">Record investigation only</button>
        </fieldset>
        {order.inventoryReconciliation.investigations?.map(row => <article key={row.id} className="mt-3 border-t border-amber-800/20 pt-3 text-xs"><p>{orderDateTime(row.recordedAt)} · {row.outcome} · {row.followUpStatus} · Unresolved</p><p>{row.findings}</p><p>Warehouse count: {row.externalStockCount}. Evidence: {row.evidenceReference}. Recorded by staff {row.actorId}.</p>{row.supersedesId && <p>Corrects entry {row.supersedesId}; the original record is retained.</p>}</article>)}
      </section>}
      <div className="mt-5 flex flex-wrap items-end gap-3 text-sm"><label>Retry saved notification<select value={retrySelectionValid ? retryEvent : ""} onChange={e => setRetryEvent(e.target.value)} className={fieldClass}><option value="">Choose event</option>{retryEvents.map(event => <option key={event} value={event}>{titleCase(event)}</option>)}{order.paymentTransactions?.filter(t => ["advance_payment_received", "part_payment_received", "payment_received"].includes(t.event)).map(t => <option key={t.id} value={`${t.event}|${t.id}`}>{titleCase(t.event)} - {inr.format(t.amount)} - {t.id}</option>)}</select></label><button type="button" disabled={busy || !retrySelectionValid} onClick={() => void retryNotification()} className="rounded border border-black/20 px-4 py-2 text-xs disabled:opacity-40">Retry eligible notification</button><p className="text-xs text-[#858b94]">Saved state, consent and template approval are checked again. Successful events remain deduplicated.</p></div>
      <section aria-label="Email activity" className="mt-5 text-xs"><h2 className="font-semibold">Email activity</h2>{order.notificationLog?.map((event, index) => <p key={`${event.key}-${index}`} className="mt-2">{titleCase(event.key)} / {titleCase(event.status)} / {orderDateTime(event.timestamp)}</p>)}</section>
      <div className="mt-7 grid gap-4 md:grid-cols-2">
        <section className={panelClass}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Customer
          </p>
          <p className="mt-4 font-medium">{order.customerName || "Customer"}</p>
          <p className="mt-2 text-xs leading-6 text-[#858b94]">
            {order.email}
            <br />
            {order.phone || "No phone recorded"}
          </p>
        </section>
        <section className={panelClass}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Shipping address
          </p>
          <p className="mt-4 text-xs leading-6 text-[#6e747d]">
            {address.fullName}
            <br />
            {address.line1}
            {address.line2 ? `, ${address.line2}` : ""}
            <br />
            {address.city}, {address.state} {address.postalCode}
            <br />
            {address.country}
            <br />
            {address.phone || order.phone || "No phone recorded"}
          </p>
    </section>
      </div>
    <section className={`${panelClass} mt-4`}>
        <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
          Products
        </p>
        <div className="mt-4 divide-y divide-black/[.07] dark:divide-white/[.07]">
          {order.items.map((item, index) => (
            <div
              key={`${item.productId || item.sku || item.name}-${index}`}
              className="grid gap-4 py-4 sm:grid-cols-[5rem_1fr_auto]"
            >
              <div className="h-20 overflow-hidden bg-[#ece3d4]">
                {item.image ? (
                  <img
                    src={item.image}
                    alt={`${item.name} in ${item.colour || item.variant?.value || "selected colour"}`}
                    className="h-full w-full object-cover"
                  />
                ) : null}
              </div>
        <div>
          <p className="font-medium">{item.name}</p>
                <p className="mt-1 text-xs text-[#858b94]">
                  Parent {item.productCode || item.parentSku || item.name}
                </p>
                <p className="mt-1 text-xs text-[#858b94]">
                  SKU {item.sku || "—"} ·{" "}
                  {item.collection || "Collection not recorded"} ·{" "}
                  {item.colour || item.variant?.value || "Colour not recorded"}
                </p>
                <p className="mt-1 text-xs text-[#858b94]">
                  Qty {item.quantity}
                  {item.size ? ` · Size ${item.size}` : ""}
                  {item.purchaseMode
                    ? ` · ${item.purchaseMode === "custom_size" ? "Custom size order" : "Standard size order"}`
                    : ""}
                </p>
                {item.customSize?.measurements ? (
                  <dl className="mt-2 grid max-w-lg grid-cols-2 gap-x-5 gap-y-1 text-[11px] text-[#858b94]">
                    {Object.entries(item.customSize.measurements).map(
                      ([key, value]) => (
                        <div key={key} className="contents">
                          <dt>{key}</dt>
                          <dd>
                            {value} {item.customSize?.unit || "cm"}
                          </dd>
                        </div>
                      ),
                    )}
                  </dl>
                ) : null}
              </div>
              <p className="text-sm">
                {inr.format(
                  item.lineTotal || (item.unitPrice || 0) * item.quantity,
                )}
              </p>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <section className={panelClass}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Payment
          </p>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Status</dt>
              <dd>{paymentLabels[order.paymentStatus]}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Amount</dt>
              <dd>{inr.format(order.total || 0)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Gateway</dt>
              <dd>{titleCase(order.payment.gateway)}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Razorpay order</dt>
              <dd className="max-w-[14rem] break-all text-right">
                {order.payment.razorpayOrderId || "—"}
              </dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Razorpay payment</dt>
              <dd className="max-w-[14rem] break-all text-right">
                {order.payment.razorpayPaymentId || "—"}
              </dd>
            </div>
          </dl>
        </section>
        <section className={panelClass}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
                Fulfillment
              </p>
              <p className="mt-4 font-medium">
                {orderStatusLabel(order)}
              </p>
            </div>
            {["shipped", "out_for_delivery", "delivered"].includes(
              order.fulfillmentStatus,
            ) ? (
              <button
                onClick={() => openAction("shipment_update")}
                className="text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]"
              >
                Update Tracking
              </button>
            ) : null}
          </div>
          <dl className="mt-4 space-y-3 text-xs">
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Courier</dt>
              <dd>{order.fulfillment.courier || "Not assigned"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">Tracking</dt>
              <dd>{order.fulfillment.trackingNumber || "Not yet available"}</dd>
            </div>
            <div className="flex justify-between gap-4"><dt className="text-[#858b94]">Dispatch date</dt><dd>{order.fulfillment.shippedAt ? orderDateTime(order.fulfillment.shippedAt) : 'Not recorded'}</dd></div>
            <div className="flex justify-between gap-4">
              <dt className="text-[#858b94]">URL</dt>
              <dd>
                {order.fulfillment.trackingUrl ? (
                  <a
                    href={order.fulfillment.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#9a7a4d]"
                  >
                    Open <ExternalLink size={11} />
                  </a>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            {order.fulfillment.delivery?.receivedBy ? (
              <div className="flex justify-between gap-4">
                <dt className="text-[#858b94]">Received by</dt>
                <dd>{order.fulfillment.delivery.receivedBy}</dd>
              </div>
            ) : null}
          </dl>
        </section>
      </div>
      <section className={`${panelClass} mt-4`} aria-labelledby="order-whatsapp-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="order-whatsapp-heading" className="text-sm font-medium">WhatsApp notification activity</h2><button type="button" onClick={() => void load()} className="text-xs underline">Refresh notification activity</button></div>
        <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-2">
          <div><dt className="text-[#858b94]">Customer WhatsApp number</dt><dd>{order.whatsapp?.number || 'No eligible number recorded'}</dd></div>
          <div><dt className="text-[#858b94]">Transactional consent</dt><dd>{order.whatsapp?.consent === 'granted' ? 'Granted for this number' : 'Not eligible (missing or withdrawn consent)'}</dd></div>
          <div><dt className="text-[#858b94]">Order status</dt><dd>{orderStatusLabel(order)}</dd></div>
          <div><dt className="text-[#858b94]">Automated messaging</dt><dd>{order.whatsapp?.automationEnabled ? 'Enabled' : 'Disabled'}</dd></div>
        </dl>
        {order.whatsapp?.eligibilityReason && <p className="mt-3 text-xs">{whatsappReasons[order.whatsapp.eligibilityReason] || titleCase(order.whatsapp.eligibilityReason)}</p>}
        <ul className="mt-4 space-y-1 text-xs">{order.whatsapp?.templates.filter(template => !template.approved || !template.enabled).map(template => <li key={template.event}>Waiting for approved template: {template.name || titleCase(template.event)} · {template.status}</li>)}</ul>
        {order.whatsapp?.activity.length ? <ol className="mt-5 divide-y divide-black/10">{order.whatsapp.activity.map((entry, index) => <li key={`${entry.event}-${index}`} className="space-y-1 py-3 text-xs">
          <p><strong>{index === 0 ? 'Last WhatsApp notification: ' : ''}{titleCase(entry.event)}</strong> · {titleCase(entry.status)}</p>
          {entry.template && <p>Template: {entry.template}</p>}
          <p>{orderDateTime(entry.updatedAt || entry.createdAt)}</p>
          {entry.reason && <p>{whatsappReasons[entry.reason] || titleCase(entry.reason)}</p>}
          {entry.acceptedAt && <p>Meta accepted: {orderDateTime(entry.acceptedAt)}</p>}
          {entry.sentAt && <p>Sent: {orderDateTime(entry.sentAt)}</p>}
          {entry.deliveredAt && <p>Delivered: {orderDateTime(entry.deliveredAt)}</p>}
          {entry.readAt ? <p>Read receipt received: {orderDateTime(entry.readAt)}</p> : <p>No read receipt received yet; reading is not inferred from delivery.</p>}
          {entry.failedAt && <p>Failed: {orderDateTime(entry.failedAt)}</p>}
          {entry.error?.kind && <p>Provider detail: {titleCase(entry.error.kind)}{entry.error.code ? ` · Meta code ${entry.error.code}` : ''}</p>}
          {entry.nextAttemptAt && <p>Next retry: {orderDateTime(entry.nextAttemptAt)}</p>}
        </li>)}</ol> : <p className="mt-4 text-xs text-[#858b94]">No WhatsApp notification event recorded for this order.</p>}
      </section>
      {order.requiresAvailabilityConfirmation ? (
        <section className={`${panelClass} mt-4`}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Availability confirmation
          </p>
          <p className="mt-4 text-sm">
            {order.availabilityDecision?.status
              ? titleCase(order.availabilityDecision.status)
              : "Staff decision required"}
          </p>
          {order.availabilityDecision?.reason ? (
            <p className="mt-2 text-xs text-[#858b94]">
              {titleCase(order.availabilityDecision.reason)}
              {order.availabilityDecision.explanation
                ? ` · ${order.availabilityDecision.explanation}`
                : ""}
            </p>
          ) : null}
        </section>
      ) : null}
      {order.returnRequest ? (
        <section className={`${panelClass} mt-4`}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Return status
          </p>
          <p className="mt-4 text-sm">
            {titleCase(order.returnRequest.status)}
          </p>
          <p className="mt-2 text-xs text-[#858b94]">
            {order.returnRequest.shipment
              ? `${order.returnRequest.shipment.courier} · LR ${order.returnRequest.shipment.lrNumber}`
              : "Return shipment details: Awaiting customer"}
          </p>
        </section>
      ) : null}
      {actionList.length ? (
        <section className={`${panelClass} mt-4`}>
          <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
            Valid next actions
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            {actionList.map((next) => (
              <button
                key={next}
                onClick={() => openAction(next)}
                className="rounded-lg bg-[#24211e] px-4 py-2.5 text-xs text-white hover:bg-[#9a7a4d]"
              >
                {actionLabel(next, order)}
              </button>
            ))}
          </div>
        </section>
      ) : null}
      <section className={`${panelClass} mt-4`}>
        <div className="flex items-center gap-3">
          <PackageCheck size={17} className="text-[#9a7a4d]" />
          <div>
            <p className="text-[9px] uppercase tracking-[.18em] text-[#9a7a4d]">
              Timeline
            </p>
            <p className="mt-1 text-xs text-[#858b94]">
              Status changes and customer communication history.
            </p>
          </div>
        </div>
        <div className="mt-5 divide-y divide-black/[.07] dark:divide-white/[.07]">
          {[...order.timeline].reverse().map((event) => (
            <div
              key={event.id}
              className="grid gap-2 py-4 sm:grid-cols-[11rem_1fr_auto]"
            >
              <time className="text-[10px] text-[#858b94]">
                {orderDateTime(event.timestamp)}
              </time>
              <div>
                <p className="text-xs font-medium">{event.label}</p>
                {event.note ? (
                  <p className="mt-1 text-[11px] text-[#858b94]">
                    {event.note}
                  </p>
                ) : null}
                {event.notificationOutcomes?.length ? <ul aria-label="Notification outcomes" className="mt-2 space-y-2 text-[11px]">
                  {event.notificationOutcomes.map((outcome, index) => <li key={`${outcome.channel}-${index}`}>
                    <p>{outcome.channel === 'whatsapp' ? 'WhatsApp' : 'Email'}: {notificationStatusLabel(outcome.status)}</p>
                    {outcome.reason ? <p className="mt-1 text-[#727780]">{notificationReasonLabel(outcome.reason)}</p> : null}
                    {outcome.submission ? <p className="mt-1 text-[#727780]">Customer recipients: {outcome.submission.customerAccepted ?? 0} accepted, {outcome.submission.customerRefused ?? 0} refused. Copy recipients: {outcome.submission.otherAccepted ?? 0} accepted, {outcome.submission.otherRefused ?? 0} refused.</p> : null}
                    {outcome.updatedAt ? <time className="text-[10px] text-[#858b94]">{orderDateTime(outcome.updatedAt)}</time> : null}
                  </li>)}
                </ul> : event.notifyCustomer ? <p className="mt-1 text-[10px] text-[#858b94]">Notification requested; channel outcome unavailable.</p> : null}
              </div>
              <span className="text-[9px] uppercase tracking-[.14em] text-[#9a7a4d]">
                {event.actor.name || event.actor.type}
              </span>
            </div>
          ))}
        </div>
      </section>
      {action ? (
        <div className="fixed inset-0 z-[300] grid place-items-center bg-black/65 p-4">
          <section className="w-full max-w-xl rounded-2xl bg-[#f8f7f4] p-6 shadow-2xl dark:bg-[#191a1f] sm:p-8">
            <div className="flex justify-between">
              <div>
                <p className="text-[9px] uppercase tracking-[.2em] text-[#9a7a4d]">
                  Order action
                </p>
                <h2 className="mt-2 text-xl font-semibold">
                  {actionLabel(action, order)}
                </h2>
              </div>
              <button onClick={() => setAction(null)}>
                <X size={18} />
              </button>
            </div>
            {action === "confirmed" && order.requiresAvailabilityConfirmation && <label className="mt-5 flex gap-3 text-sm"><input type="checkbox" checked={form.availabilityConfirmed} onChange={e => setForm(current => ({ ...current, availabilityConfirmed: e.target.checked }))} />I have confirmed availability and production for the requested items.</label>}
            {action === "shipment_update" || action === "shipped" ? (
              <div className="mt-6 grid gap-4">
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Courier
                  <input
                    value={form.courier}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        courier: event.target.value,
                      }))
                    }
                    className={fieldClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Tracking number
                  <input
                    value={form.trackingNumber}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        trackingNumber: event.target.value,
                      }))
                    }
                    className={fieldClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Tracking URL
                  <input
                    value={form.trackingUrl}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        trackingUrl: event.target.value,
                      }))
                    }
                    className={fieldClass}
                  />
                </label>
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">Shipment dispatch date and time<input type="datetime-local" value={form.shippedAt} onChange={event => setForm(current => ({ ...current, shippedAt: event.target.value }))} className={fieldClass} /></label>
              </div>
            ) : null}
            {action === "cancelled" && !hasOrderAcceptance(order) &&
            ["order_placed", "awaiting_confirmation"].includes(order.fulfillment.status || order.fulfillmentStatus) ? (
              <div className="mt-6 grid gap-4">
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Rejection reason
                  <select
                    required
                    value={form.rejectionReason}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        rejectionReason: event.target.value,
                      }))
                    }
                    className={fieldClass}
                  >
                    <option value="">Choose a reason</option>
                    <option value="requested_size_unavailable">
                      Requested size unavailable
                    </option>
                    <option value="fabric_or_material_unavailable">
                      Fabric or material unavailable
                    </option>
                    <option value="production_or_fulfilment_limitation">
                      Production/fulfilment limitation
                    </option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Explanation
                  {form.rejectionReason === "other"
                    ? " · required"
                    : " · optional"}
                  <textarea
                    required={form.rejectionReason === "other"}
                    value={form.rejectionExplanation}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        rejectionExplanation: event.target.value,
                      }))
                    }
                    rows={3}
                    className={fieldClass}
                  />
                </label>
              </div>
            ) : null}
            {action !== "return_accept" ? (
              <div className="mt-5 grid gap-4">
                <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                  Customer note · optional
                  <textarea
                    value={form.customerNote}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        customerNote: event.target.value,
                      }))
                    }
                    rows={3}
                    className={fieldClass}
                  />
                </label>
                <label className="flex items-center gap-3 text-xs">
                  <input
                    type="checkbox"
                    checked={form.sendCustomerNotification}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        sendCustomerNotification: event.target.checked,
                      }))
                    }
                  />
                  Send customer notification
                </label>
                {action === "delivered" ? (
                  <>
                    <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                      Received by
                      <input
                        value={form.receivedBy}
                        onChange={(event) =>
                          setForm((current) => ({
                            ...current,
                            receivedBy: event.target.value,
                          }))
                        }
                        className={fieldClass}
                      />
                    </label>
                    <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                      Proof photo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          readProof("proofPhoto", event.target.files?.[0])
                        }
                        className="mt-2 block w-full text-xs"
                      />
                    </label>
                    <label className="text-[9px] uppercase tracking-[.16em] text-[#858b94]">
                      Signature
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={(event) =>
                          readProof("signature", event.target.files?.[0])
                        }
                        className="mt-2 block w-full text-xs"
                      />
                    </label>
                  </>
                ) : null}
              </div>
            ) : null}
            <div className="mt-7 flex justify-end gap-3">
              <button
                onClick={() => setAction(null)}
                className="rounded-lg border border-black/10 px-5 py-3 text-xs"
              >
                Cancel
              </button>
              <button
                disabled={busy}
                onClick={() => void submit()}
                className="rounded-lg bg-[#24211e] px-5 py-3 text-xs text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Confirm"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
