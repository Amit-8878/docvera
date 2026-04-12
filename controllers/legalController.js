/**
 * Static legal copy for API + future CMS swap.
 * GET /api/legal/content
 */

const TERMS_TEXT = `DOCVERA — Terms of Service (Summary / Placeholder)

1. Service
DOCVERA connects users with document-related services and agents. Features may change over time.

2. Accounts
You are responsible for your account credentials and for activity under your account.

3. Acceptable use
You agree not to misuse the platform, submit false information, or violate applicable laws.

4. Limitation
Services are provided "as available." We are not liable for indirect damages to the extent permitted by law.

5. Changes
We may update these terms; continued use after notice constitutes acceptance.

Last updated: placeholder — replace with counsel-approved text before production.
`;

const PRIVACY_TEXT = `DOCVERA — Privacy Policy (Summary / Placeholder)

1. Data we process
We process information you provide (e.g. name, contact, order details, uploads) to deliver and improve services.

2. Purpose
Processing includes order fulfilment, communication, fraud prevention, and legal compliance.

3. Sharing
We may share data with agents assigned to your orders and service providers as needed to complete the work.

4. Security
We use reasonable technical and organisational measures. No system is perfectly secure.

5. Your rights
Depending on jurisdiction, you may have rights to access, correct, or delete personal data. Contact support for requests.

Last updated: placeholder — replace with counsel-approved text before production.
`;

function getLegalContent(req, res) {
  return res.status(200).json({
    terms: TERMS_TEXT,
    privacy: PRIVACY_TEXT,
  });
}

module.exports = {
  getLegalContent,
};
