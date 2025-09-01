#!/usr/bin/env node
const { Command } = require('commander');
const path = require('path');
const fs = require('fs');
const { renderHtml } = require('../src/render');
const { htmlToPdf } = require('../src/pdf');

const program = new Command();

program
  .name('mdcv')
  .description('Convert a Markdown CV to a PDF using templates.')
  .argument('<input>', 'Path to the Markdown CV file')
  .option('-o, --output <path>', 'Output PDF path', 'cv.pdf')
  .option('-t, --template <name>', 'Template name: modern | classic | minimal', 'modern')
  .option('-T, --template-path <path>', 'Path to a custom template folder (overrides --template)')
  .option('-c, --primary-color <hex>', 'Primary color hex (e.g. #4f46e5)', '#0f172a')
  .option('--debug-html <path>', 'Write the intermediate HTML to given path for debugging')
  .option('--page-size <format>', 'PDF page size (A4, Letter, Legal)', 'A4')
  .option('--no-headers', 'Disable header area on template (if supported)')
  .option('--no-footers', 'Disable footer area on template (if supported)')
  .action(async (input, options) => {
    try {
      const inputPath = path.resolve(process.cwd(), input);
      if (!fs.existsSync(inputPath)) {
        console.error(`Input file not found: ${inputPath}`);
        process.exit(1);
      }

      const html = await renderHtml({
        markdownPath: inputPath,
        templateName: options.template,
        templatePath: options.templatePath ? path.resolve(process.cwd(), options.templatePath) : null,
        primaryColor: options.primaryColor,
        showHeader: options.headers,
        showFooter: options.footers
      });

      if (options.debugHtml) {
        const debugPath = path.resolve(process.cwd(), options.debugHtml);
        fs.writeFileSync(debugPath, html, 'utf8');
        console.log(`Wrote debug HTML: ${debugPath}`);
      }

      const outputPdfPath = path.resolve(process.cwd(), options.output);
      await htmlToPdf(html, {
        outputPath: outputPdfPath,
        format: options.pageSize,
      });

      console.log(`✅ PDF generated: ${outputPdfPath}`);
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  });

program.parse(process.argv);