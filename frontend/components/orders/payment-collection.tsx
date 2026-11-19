"use client";

import { useRef, useState } from "react";
import { apiBaseUrl } from "@/lib/rbac";
import { inr, orderDateTime, paymentLabels, titleCase, type Order } from "@/lib/orders";

export function PaymentCollectionPanel({ order, onUpdate }: { order: Order; onUpdate?: (order: Order) => void }) {
  const summary = order.paymentCollection;
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [reverses, setReverses] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [dueAt, setDueAt] = useState(summary?.dueAt?.slice(0, 10) || "");
  const [instructions, setInstructions] = useState(summary?.instructions || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const transactionId = useRef("");
  const submitting = useRef(false);
  if (!summary) return null;
  const manual = order.payment.gateway === "manual";
  const field = "mt-2 w-full rounded border border-black/15 bg-transparent px-3 py-2 text-sm focus-visible:outline-gold";
  async function save(action?: string, terms = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true); setError("");
    if (!transactionId.current) transactionId.current = crypto.randomUUID();
    try {
      const response = await fetch(`${apiBaseUrl}/api/staff/orders/${order.id}/${terms ? "payment-instructions" : action === "reverse" ? "payments/reversal" : "payments"}`, {
        method: terms ? "PATCH" : "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${localStorage.getItem("rk_access_token") || ""}` },
        body: JSON.stringify(terms ? { dueAt, instructions } : { transactionId: transactionId.current, amount, action, method, reference, note: action === "reverse" ? correctionReason : note, reverses }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save payment.");
      onUpdate?.(data.order);
      transactionId.current = ""; setAmount(""); setReference(""); setNote(""); setReverses(""); setCorrectionReason("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save payment."); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section aria-label="Payment collection" className="mt-6 rounded-xl border border-black/10 p-5">
    <h2 className="font-display text-2xl">Payment Collection</h2>
    <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
      <div><dt>Total</dt><dd>{inr.format(summary.total)}</dd></div><div><dt>Received</dt><dd>{inr.format(summary.received)}</dd></div>
      <div><dt>Balance due</dt><dd>{inr.format(summary.balanceDue)}</dd></div><div><dt>Payment status</dt><dd>{paymentLabels[summary.status]}</dd></div>
    </dl>
    {summary.dueAt && <p className="mt-3 text-sm">Payment due: {orderDateTime(summary.dueAt)}</p>}
    {summary.instructions && <p className="mt-3 whitespace-pre-wrap text-sm">{summary.instructions}</p>}
    {onUpdate && manual && <>
      <div className="mt-5 grid gap-4 sm:grid-cols-2"><label>Due date<input type="date" value={dueAt} onChange={e => setDueAt(e.target.value)} className={field} /></label>
        <label>Payment instructions<textarea maxLength={1000} value={instructions} onChange={e => setInstructions(e.target.value)} className={field} /></label></div>
      <button disabled={busy} type="button" onClick={() => void save(undefined, true)} className="mt-3 border border-black/20 px-4 py-2 text-sm disabled:opacity-40">Save payment instructions</button>
      <h3 className="mt-5 text-sm font-semibold">Payment history</h3>
      <ul className="mt-2 space-y-3 text-xs">{(order.paymentTransactions || []).map(t => <li key={t.id} className="border-b border-black/10 pb-3"><p>{titleCase(t.event)} / {inr.format(t.amount)} · {titleCase(t.method)} · {orderDateTime(t.timestamp)}</p><p>Recorded by {t.recordedBy} · {t.reference || "No reference"}</p>{t.note && <p>{t.note}</p>}<p>Transaction {t.id}</p></li>)}</ul>
      {(order.paymentTransactions || []).some(t => t.amount > 0) && <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2"><label>Correct a recorded payment<select value={reverses} onChange={e => setReverses(e.target.value)} className={field}><option value="">Choose original payment</option>{order.paymentTransactions?.filter(t => t.amount > 0 && !order.paymentTransactions?.some(reversal => reversal.reverses === t.id)).map(t => <option key={t.id} value={t.id}>{inr.format(t.amount)} - {t.id}</option>)}</select></label><label>Correction reason<input maxLength={500} value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} className={field} /></label><button type="button" disabled={busy || !reverses || !correctionReason.trim()} onClick={() => void save("reverse")} className="w-fit border border-black/20 px-4 py-2 disabled:opacity-40">Record audited reversal</button></div>}
      {!order.paymentTransactions?.length && <p className="mt-2 text-sm">No payments recorded.</p>}
      {summary.balanceDue > 0 && !["cancelled", "refunded"].includes(order.fulfillmentStatus) && <form className="mt-5" onSubmit={e => { e.preventDefault(); void save(); }}>
        <div className="grid gap-4 sm:grid-cols-2"><label>Amount (INR)<input type="number" min="0.01" step="0.01" max={summary.balanceDue} required value={amount} onChange={e => setAmount(e.target.value)} className={field} /></label>
          <label>Payment method<select value={method} onChange={e => setMethod(e.target.value)} className={field}>{["upi", "bank_transfer", "cash", "cheque", "other"].map(m => <option key={m} value={m}>{titleCase(m)}</option>)}</select></label>
          <label>Reference<input maxLength={160} value={reference} onChange={e => setReference(e.target.value)} className={field} /></label><label>Staff note<input maxLength={500} value={note} onChange={e => setNote(e.target.value)} className={field} /></label></div>
        <div className="mt-4 flex flex-wrap gap-3 text-xs">{[["advance", "Record advance"], ["half", "Record 50% payment"], ["remaining", "Record remaining balance"]].map(([action, label]) => <button type="button" disabled={busy} key={action} onClick={() => void save(action)} className="border border-black/20 px-3 py-2 disabled:opacity-40">{label}</button>)}<button disabled={busy} className="bg-ink px-4 py-2 text-ivory disabled:opacity-40">Record payment</button></div>
      </form>}
      {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    </>}
  </section>;
}
