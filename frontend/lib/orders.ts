import { formatDate, formatDateTime, formatLongDate } from "@/lib/date-time";

export type PaymentStatus = "pending" | "partial" | "overdue" | "paid" | "failed" | "refunded";
export type FulfillmentStatus =
  | "order_placed"
  | "awaiting_confirmation"
  | "confirmed"
  | "processing"
  | "packed"
  | "shipped"
  | "out_for_delivery"
  | "delivered"
  | "cancelled"
  | "return_requested"
  | "returned"
  | "refunded";

export type OrderActor = {
  type: "customer" | "staff" | "system";
  userId?: string;
  name?: string;
};
export type OrderTimelineEvent = {
  id: string;
  status: string;
  label: string;
  timestamp: string;
  actor: OrderActor;
  note?: string;
  customerNote?: string;
  internalNote?: string;
  notifyCustomer?: boolean;
  metadata?: { courier?: string; trackingNumber?: string };
};
export type OrderItem = {
  productId?: string;
  productCode?: string;
  parentSku?: string;
  variantId?: string;
  name: string;
  sku?: string;
  collection?: string;
  collectionSlug?: string;
  colour?: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
  image?: string;
  size?: string;
  purchaseMode?: "standard_size" | "custom_size";
  customSize?: { unit?: string; measurements?: Record<string, string> } | null;
  variantStatus?: string;
  variant?: { id?: string; sku?: string; name?: string; value?: string } | null;
  requiresAvailabilityConfirmation?: boolean;
};
export type ShippingAddress = {
  fullName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
};
export type OrderPayment = {
  status: PaymentStatus;
  gateway?: string;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  verifiedAt?: string;
};
export type OrderFulfillment = {
  status: FulfillmentStatus;
  courier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  shippingNote?: string;
  shippedAt?: string;
  deliveredAt?: string;
  delivery?: {
    receivedBy?: string;
    proofPhoto?: string;
    signature?: string;
    deliveredAt?: string;
  };
};
export type ConfirmationEmailState = {
  status?: "pending" | "sending" | "sent" | "failed";
  attempts?: number;
  lastAttemptAt?: string;
  sentAt?: string;
  providerId?: string;
  error?: string | null;
};

export type PaymentTransaction = { reverses?: string; id: string; amount: number; amountPaise: number; method: string; reference?: string; note?: string; timestamp: string; recordedBy: string; event: string };
export type PaymentCollection = { total: number; received: number; balanceDue: number; status: PaymentStatus; dueAt?: string; instructions?: string };
export type Order = {
  whatsappUpdates?: { number?: string | null; enabled: boolean };
  paymentCollection?: PaymentCollection;
  paymentTransactions?: PaymentTransaction[];
  inventoryReservation?: string;
  notificationLog?: { key: string; status: string; timestamp: string; error?: string }[];
  id: string;
  refunds?: { id: string; status: string; amountPaise: number; currency: string; processedAt?: string }[];
  orderNumber: string;
  customerName?: string;
  email?: string;
  phone?: string;
  whatsapp?: {
    number?: string | null; contactSource?: string; consent: string; eligibilityReason?: string;
    automationEnabled: boolean;
    templates: { event: string; name: string; approved: boolean; enabled: boolean; status: string }[];
    activity: { event: string; status: string; reason?: string; createdAt?: string; updatedAt?: string;
      acceptedAt?: string; sentAt?: string; deliveredAt?: string; readAt?: string; failedAt?: string;
      nextAttemptAt?: string; providerId?: string; error?: { kind?: string; code?: number; subcode?: number } }[];
  };
  shipping?: ShippingAddress;
  shippingAddress?: ShippingAddress;
  items: OrderItem[];
  subtotal?: number;
  shippingCharge?: number;
  tax?: number;
  discount?: number;
  total: number;
  currency?: string;
  payment: OrderPayment;
  paymentStatus: PaymentStatus;
  fulfillment: OrderFulfillment;
  fulfillmentStatus: FulfillmentStatus;
  timeline: OrderTimelineEvent[];
  latestStatus?: OrderTimelineEvent | null;
  availableActions: Array<
    FulfillmentStatus | "shipment_update" | "return_accept"
  >;
  returnRequest?: {
    status?: string;
    reason?: string;
    shipment?: {
      courier?: string;
      lrNumber?: string;
      dispatchDate?: string;
      note?: string;
    } | null;
  };
  confirmationEmail?: ConfirmationEmailState;
  requiresAvailabilityConfirmation?: boolean;
  availabilityDecision?: {
    status?: "accepted" | "rejected";
    reason?: string | null;
    explanation?: string | null;
    decidedAt?: string;
    decidedBy?: string;
  };
  createdAt: string;
  updatedAt?: string;
};

export const paymentLabels: Record<PaymentStatus, string> = {
  pending: "Pending",
  partial: "Partially paid / balance due",
  overdue: "Overdue",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
};
export const fulfillmentLabels: Record<FulfillmentStatus, string> = {
  order_placed: "Order Placed",
  awaiting_confirmation: "Awaiting Availability Confirmation",
  confirmed: "Confirmed",
  processing: "Processing",
  packed: "Packed",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
  return_requested: "Return Requested",
  returned: "Returned",
  refunded: "Refunded",
};

export const fulfillmentSteps: Array<{ status: string; label: string }> = [
  { status: "order_placed", label: "Order Placed" },
  { status: "payment_confirmed", label: "Payment Confirmed" },
  { status: "awaiting_confirmation", label: "Availability Confirmation" },
  { status: "confirmed", label: "Order Confirmed" },
  { status: "processing", label: "Processing" },
  { status: "packed", label: "Packed" },
  { status: "shipped", label: "Shipped" },
  { status: "out_for_delivery", label: "Out for Delivery" },
  { status: "delivered", label: "Delivered" },
];

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
export const orderDate = (value?: string, long = false) =>
  long ? formatLongDate(value) : formatDate(value);
export const orderDateTime = (value?: string) => formatDateTime(value);
export const titleCase = (value?: string) =>
  value
    ? value
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase())
    : "—";


export function orderStatusLabel(order: Order) {
  if (order.payment.gateway === "manual" && order.fulfillmentStatus === "confirmed") return "Accepted";
  if (order.fulfillmentStatus === "cancelled" && order.availabilityDecision?.status === "rejected") return "Rejected";
  return fulfillmentLabels[order.fulfillmentStatus];
}
