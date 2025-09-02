const puppeteer = require('puppeteer');

async function htmlToPdf(html, { outputPath, format = 'A4' } = {}) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: ['domcontentloaded', 'load'] });

    // Ensure fonts and images are loaded
    await page.evaluateHandle('document.fonts.ready');

    await page.pdf({
      path: outputPath,
      format,
      printBackground: true,
      // Let CSS @page control the margin to guarantee 12px all around
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
      displayHeaderFooter: false
    });
  } finally {
    await browser.close();
  }
}

module.exports = { htmlToPdf };