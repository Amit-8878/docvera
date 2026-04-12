function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(d) {
  if (!d) return '';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const LAYOUT_KEYS = [
  'logo',
  'company',
  'title',
  'customer',
  'table',
  'terms',
  'signature',
  'stamp',
  'footer',
];
const LAYOUT_SET = new Set(LAYOUT_KEYS);

/** Legacy: single `footer` meant signature + stamp + note. */
function expandRawLayout(raw) {
  const arr = Array.isArray(raw) ? raw.map((x) => String(x || '').trim()) : [];
  const hasSig = arr.includes('signature');
  const hasStamp = arr.includes('stamp');
  const out = [];
  for (const k of arr) {
    if (k === 'footer' && !hasSig && !hasStamp) {
      out.push('signature', 'stamp', 'footer');
    } else {
      out.push(k);
    }
  }
  return out;
}

function layoutOrderFromTemplate(t) {
  const raw = t && t.layout;
  if (!Array.isArray(raw) || raw.length === 0) return [...LAYOUT_KEYS];
  const expanded = expandRawLayout(raw);
  const seen = new Set();
  const order = [];
  for (const k of expanded) {
    if (LAYOUT_SET.has(k) && !seen.has(k)) {
      order.push(k);
      seen.add(k);
    }
  }
  return order.length ? order : [...LAYOUT_KEYS];
}

function invoiceStyles() {
  return `
    * { box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      margin: 0;
      padding: 0;
      line-height: 1.45;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 0 auto;
      padding: 12mm 14mm 14mm;
      border: 1px solid #c8c8c8;
      display: flex;
      flex-direction: column;
      background: #fff;
    }
    .page-body { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; }
    .block-section { margin-bottom: 10px; }
    .block-section.block-logo {
      padding-bottom: 6px;
      border-bottom: 1px solid #e0e0e0;
    }
    .block-section.block-company {
      padding-bottom: 8px;
      border-bottom: 2px solid #1a1a1a;
    }
    .logo-wrap { min-height: 36px; }
    .logo { max-width: 140px; max-height: 80px; object-fit: contain; display: block; }
    .company-name { font-size: 17px; font-weight: 700; letter-spacing: 0.03em; margin-bottom: 3px; color: #111; }
    .company-addr { font-size: 10px; color: #333; white-space: pre-line; line-height: 1.5; }
    .contact { margin-top: 5px; font-size: 10px; color: #444; line-height: 1.45; }
    .gst-line { margin-top: 4px; font-size: 10px; font-weight: 600; color: #222; }
    .title {
      text-align: center;
      font-size: 20px;
      font-weight: 700;
      letter-spacing: 0.22em;
      margin: 8px 0 10px;
      color: #111;
    }
    .meta {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 2px;
      font-size: 10px;
    }
    .meta-box {
      flex: 1;
      border: 1px solid #d4d4d4;
      padding: 8px 10px;
      background: #f9f9f9;
    }
    .meta-box strong { display: block; margin-bottom: 4px; font-size: 8px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
    table.invoice-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 8px;
      font-size: 10px;
    }
    .invoice-table th {
      background: #1a1a1a;
      color: #fff;
      text-align: left;
      padding: 7px 9px;
      font-weight: 600;
    }
    .invoice-table td {
      border: 1px solid #ddd;
      padding: 7px 9px;
      vertical-align: top;
    }
    .invoice-table td.amount { text-align: right; font-weight: 600; white-space: nowrap; }
    .total-row td {
      border: none;
      padding-top: 6px;
    }
    .total-label { text-align: right; font-weight: 700; font-size: 11px; }
    .total-value { text-align: right; font-weight: 700; font-size: 12px; }
    .terms { margin-top: 2px; font-size: 9px; color: #333; line-height: 1.4; }
    .section-title { font-weight: 700; margin-bottom: 5px; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: #333; }
    .terms ol { margin: 0; padding-left: 16px; }
    .terms li { margin-bottom: 3px; }
    .block-signature, .block-stamp {
      display: flex;
      justify-content: flex-end;
      margin-top: 4px;
    }
    .sig { text-align: center; }
    .sig-img { max-height: 52px; max-width: 180px; object-fit: contain; display: block; margin: 0 auto 3px; }
    .sig-label { font-size: 8px; color: #555; }
    .stamp-img { max-height: 76px; max-width: 92px; object-fit: contain; display: block; }
    .block-footer {
      margin-top: 6px;
      padding-top: 8px;
      border-top: 1px solid #e5e5e5;
    }
    .footer-note { width: 100%; font-size: 8px; color: #555; text-align: right; line-height: 1.35; }
  `;
}

/**
 * @param {object} data — order/customer line items for the invoice body
 * @param {object} template — letterhead fields from DB (may be empty)
 */
function generateInvoiceHTML(data, template) {
  const t = template && typeof template === 'object' ? template : {};
  const companyName = escapeHtml(t.companyName || '');
  const address = escapeHtml(t.address || '');
  const email = escapeHtml(t.email || '');
  const phone = escapeHtml(t.phone || '');
  const website = escapeHtml(t.website || '');
  const gstin = escapeHtml(t.gstin || '');
  const footerNote = escapeHtml(t.footerNote || '');
  const logoUrl = t.logoUrl ? escapeHtml(t.logoUrl) : '';
  const signatureUrl = t.signatureUrl ? escapeHtml(t.signatureUrl) : '';
  const stampUrl = t.stampUrl ? escapeHtml(t.stampUrl) : '';

  const orderId = escapeHtml(data.orderId || '');
  const invoiceDate = escapeHtml(formatDate(data.invoiceDate));
  const customerName = escapeHtml(data.customerName || '');
  const customerEmail = escapeHtml(data.customerEmail || '');
  const serviceName = escapeHtml(data.serviceName || '');
  const description = escapeHtml(data.description || '—');
  const amountStr = escapeHtml(data.amountLabel || '');

  const terms = Array.isArray(t.terms) ? t.terms.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const termsHtml =
    terms.length > 0
      ? `<div class="terms"><div class="section-title">Terms &amp; Conditions</div><ol>${terms
          .map((line) => `<li>${escapeHtml(line)}</li>`)
          .join('')}</ol></div>`
      : '';

  const contactLines = [email, phone, website].filter(Boolean);
  const contactHtml = contactLines.length
    ? `<div class="contact">${contactLines.map((c) => `<div>${c}</div>`).join('')}</div>`
    : '';
  const gstHtml = gstin ? `<div class="gst-line">GSTIN: ${gstin}</div>` : '';

  const sigInner = signatureUrl
    ? `<div class="sig"><img class="sig-img" src="${signatureUrl}" alt="" /><div class="sig-label">Authorized signature</div></div>`
    : '';
  const stampInner = stampUrl
    ? `<div class="stamp"><img class="stamp-img" src="${stampUrl}" alt="" /></div>`
    : '';

  const blocks = {
    logo: () => {
      const inner = logoUrl
        ? `<div class="logo-wrap"><img class="logo" src="${logoUrl}" alt="" /></div>`
        : '<div class="logo-wrap"></div>';
      return `<div class="block-section block-logo">${inner}</div>`;
    },
    company: () => {
      const inner = `
        <div class="company-name">${companyName || '&nbsp;'}</div>
        ${address ? `<div class="company-addr">${address}</div>` : ''}
        ${contactHtml}
        ${gstHtml}`;
      return `<div class="block-section block-company">${inner}</div>`;
    },
    title: () => `<div class="block-section block-title"><div class="title">INVOICE</div></div>`,
    customer: () =>
      `<div class="block-section block-customer"><div class="meta">
      <div class="meta-box">
        <strong>Bill to</strong>
        <div>${customerName || '—'}</div>
        <div>${customerEmail || ''}</div>
      </div>
      <div class="meta-box">
        <strong>Invoice details</strong>
        <div>Order ID: ${orderId}</div>
        <div>Date: ${invoiceDate}</div>
      </div>
    </div></div>`,
    table: () =>
      `<div class="block-section block-table">
    <table class="invoice-table">
      <thead>
        <tr>
          <th style="width:22%">Service</th>
          <th>Description</th>
          <th style="width:18%">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>${serviceName || '—'}</td>
          <td>${description}</td>
          <td class="amount">${amountStr}</td>
        </tr>
      </tbody>
    </table>
    <table class="invoice-table" style="border:none;">
      <tr class="total-row">
        <td colspan="2" class="total-label">Total amount</td>
        <td class="total-value amount">${amountStr}</td>
      </tr>
    </table>
    </div>`,
    terms: () => (termsHtml ? `<div class="block-section block-terms">${termsHtml}</div>` : ''),
    signature: () =>
      sigInner ? `<div class="block-section block-signature">${sigInner}</div>` : '',
    stamp: () => (stampInner ? `<div class="block-section block-stamp">${stampInner}</div>` : ''),
    footer: () =>
      footerNote
        ? `<div class="block-section block-footer"><div class="footer-note">${footerNote}</div></div>`
        : '',
  };

  const order = layoutOrderFromTemplate(t);
  const inner = order.map((key) => blocks[key] && blocks[key]()).filter(Boolean).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>${invoiceStyles()}</style>
</head>
<body>
  <div class="page">
    <div class="page-body">${inner}</div>
  </div>
</body>
</html>`;
}

module.exports = {
  generateInvoiceHTML,
  LAYOUT_KEYS,
};
