export type TemplateLibraryEntry = {
  name: string;
  category: string;
  language: string;
  parameters: string[];
  enabled: boolean;
  approved: boolean;
  observedStatus?: string;
  approvalStatus?: string;
  localDraft?: boolean;
  locallyMapped?: boolean;
  mappingEnabled?: boolean;
  templateGroup?: string;
  qualityRating?: 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | null;
  approvalCheckedAt?: string;
  statusEvidence?: string;
  presentInMeta?: boolean;
  componentsVerified?: boolean;
  statusStale?: boolean;
};

const DRAFT_DISPOSITIONS: Record<string, { status: string; availability: string }> = {
  rk_order_placed: {
    status: 'Superseded',
    availability: 'Superseded by order_received; retained for reference and unavailable for sending.',
  },
  rk_order_status_update: {
    status: 'Superseded',
    availability: 'Superseded by order_and_payment_update; retained for reference and unavailable for sending.',
  },
  rk_authentication_otp: {
    status: 'Blocked',
    availability: 'Meta has denied Authentication-template creation for this WABA. WhatsApp OTP is unavailable; email OTP remains available.',
  },
  rk_exclusive_offer: {
    status: 'Blocked',
    availability: 'Blocked until the coupon and promotion system is implemented.',
  },
  rk_admin_notification: {
    status: 'Internal only',
    availability: 'Internal-only template; unavailable for customer messaging.',
  },
};

export function templateLibraryStatus(template: TemplateLibraryEntry): string {
  if (template.name === 'order_received') return 'Pending Meta Review';
  const status = DRAFT_DISPOSITIONS[template.name]?.status
    ?? template.observedStatus
    ?? template.approvalStatus
    ?? 'MISSING_OR_UNKNOWN';
  if (status === 'NOT_CHECKED' || status === 'NOT_SUBMITTED') return 'MISSING_OR_UNKNOWN';
  if (status === 'PENDING' || status === 'IN_REVIEW') return 'PENDING / IN_REVIEW';
  if (status === 'PENDING_CONFIRMATION') return 'PENDING / REFRESH REQUIRED';
  return status;
}

export function templateLibraryAvailability(template: TemplateLibraryEntry, marketingEnabled: boolean): string {
  if (template.name === 'order_received') {
    return 'Unavailable for sending until Meta approves the corrected template and its components are freshly verified.';
  }
  if (template.name === 'rk_test') {
    return marketingEnabled
      ? 'Marketing template; transactional automation is not available.'
      : 'Marketing gate is disabled; unavailable for sending.';
  }
  if (DRAFT_DISPOSITIONS[template.name]) return DRAFT_DISPOSITIONS[template.name].availability;
  if (template.locallyMapped) return template.mappingEnabled ? 'Mapped and enabled' : 'Mapped but disabled';
  return 'Not mapped locally; unavailable for sending.';
}

export function marketingInventoryRow(item: {
  name: string;
  language: string;
  category: string;
  status: string;
  qualityRating?: string | null;
  checkedAt?: string;
}): TemplateLibraryEntry {
  return {
    name: item.name,
    language: item.language,
    category: item.category,
    observedStatus: item.status,
    statusEvidence: 'found',
    presentInMeta: true,
    qualityRating: ['GREEN', 'YELLOW', 'RED', 'UNKNOWN'].includes(item.qualityRating ?? '')
      ? item.qualityRating as 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN'
      : null,
    approvalCheckedAt: item.checkedAt,
    parameters: [],
    templateGroup: 'Marketing',
    enabled: false,
    approved: false,
    locallyMapped: false,
    mappingEnabled: false,
    componentsVerified: false,
    localDraft: false,
  };
}
