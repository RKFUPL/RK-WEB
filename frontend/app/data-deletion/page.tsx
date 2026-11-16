import { LegalPage } from '@/components/site/legal-page';
import { legalIdentity } from '@/lib/legal-identity';
import { pageMetadata } from '@/lib/site-metadata';

const sections = [
  {
    title: 'How to Request Deletion',
    body: `Email ${legalIdentity.customerCareEmail} with the subject line: Personal Data Deletion Request. Include the email address associated with your account and enough information for us to identify the account or records covered by your request. Do not include passwords, payment card details, or one-time verification codes.`,
  },
  {
    title: 'Identity Verification',
    body: 'We may ask for additional information or contact you through an existing account contact method to verify that you are authorized to make the request. Information supplied for verification will be used to assess and respond to your request.',
  },
  {
    title: 'Review and Exceptions',
    body: 'We will review your request and the records it covers. Some transaction, tax, accounting, security, legal compliance, or dispute records may need to be retained where applicable. Other information may be deleted or retained where a lawful exception applies. We do not state a processing deadline on this page.',
  },
  {
    title: 'WhatsApp Opt-Out Is Separate',
    body: 'A WhatsApp STOP or unsubscribe request withdraws WhatsApp messaging consent. It does not itself request deletion of your account or other personal information. A personal-data deletion request does not automatically opt you out of WhatsApp messages. Contact us separately if you want both actions.',
  },
  {
    title: 'No Automated Deletion Portal',
    body: 'Submit requests by email using the instructions above. This page does not provide an automated account-deletion feature.',
  },
].map(({ title, body }) => ({ title, body }));

export const metadata = pageMetadata(
  'Personal Data Deletion',
  'How to request deletion of personal information held by Rashi Kapoor.',
  '/data-deletion',
);

export default function DataDeletionPage() {
  return (
    <LegalPage
      eyebrow="Rashi Kapoor / Privacy"
      title="Personal Data Deletion"
      intro="How to contact us to request deletion of personal information connected with your Rashi Kapoor account or use of our services."
      updated="16 November 2026"
      sections={sections}
    />
  );
}
