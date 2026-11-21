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
  draftExplanation?: string;
  versionOf?: string;
};

const DRAFT_DISPOSITIONS: Record<string, { status: string; availability: string }> = {
  rk_order_placed: {
    status: 'Superseded',
    availability: 'Superseded by order_received. This local draft must not be submitted to Meta and is unavailable for sending.',
  },
  rk_order_status_update: {
    status: 'Superseded',
    availability: 'Superseded by order_and_payment_update. This local draft must not be submitted to Meta and is unavailable for sending.',
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

export function templateLibraryDraftExplanation(template: TemplateLibraryEntry, marketingEnabled: boolean): string {
  // Known dispositions take priority over older API submission instructions.
  return DRAFT_DISPOSITIONS[template.name]?.availability
    ?? template.draftExplanation
    ?? templateLibraryAvailability(template, marketingEnabled);
}

export function visibleTemplateLibraryEntries<T extends TemplateLibraryEntry>(templates: T[]): T[] {
  // Production's unused legacy test event defaults to rk_test / UTILITY / en_US.
  // Suppress only its absent, unmapped draft; preserve real Meta Marketing rows
  // and any actually configured or present Utility template with that name.
  return templates.filter(template => !(template.name === 'rk_test' && template.category === 'UTILITY'
    && template.localDraft === true && template.presentInMeta !== true && !template.locallyMapped
    && !template.mappingEnabled && !template.enabled && !template.approved));
}

export function templateLibraryCounts(templates: TemplateLibraryEntry[]) {
  const counts = { approved: 0, review: 0, unknown: 0, drafts: 0 };
  const unique = new Map(visibleTemplateLibraryEntries(templates)
    .filter(template => !template.versionOf).map(template => [`${template.name}:${template.language}`, template]));
  for (const template of unique.values()) {
    if (template.localDraft) {
      counts.drafts++;
      continue;
    }
    const status = templateLibraryStatus(template);
    if (status === 'APPROVED') counts.approved++;
    else if (status.toUpperCase().startsWith('PENDING')) counts.review++;
    else if (status === 'MISSING_OR_UNKNOWN' || status === 'UNKNOWN') counts.unknown++;
  }
  return counts;
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
