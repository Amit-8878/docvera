const puppeteer = require('puppeteer');

/**
 * @param {string} html
 * @returns {Promise<Buffer>}
 */
async function generatePDF(html) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    const buf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '10mm', right: '10mm' },
    });
    return Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  } finally {
    await browser.close();
  }
}

module.exports = {
  generatePDF,
};
