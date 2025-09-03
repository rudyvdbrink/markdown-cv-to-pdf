# markdown-cv-to-pdf

Convert a CV written in Markdown into a cleanly formatted PDF. Preserve structured content to ensure machine readability and prevent hiring algorithms from missing important information. Choose from built-in templates (modern, classic, minimal) or provide your own template.

## Features

- Markdown + YAML frontmatter support
- Three built-in templates (switch with `-t`)
- Custom templates via `-T path/to/template`
- Primary color customization (`-c`)
- Uses Puppeteer to print to PDF (A4 by default)
- Optionally dump intermediate HTML for tweaking

## Quick start

1) Install dependencies

```bash
npm install
```

2) Generate PDF from the example

```bash
npm run example
# => cv.pdf
```

Or on your own file:

```bash
node bin/mdcv.js path/to/your-cv.md -o my-cv.pdf -t modern
```

To install globally:

```bash
npm install -g .
mdcv path/to/your-cv.md -o my-cv.pdf -t classic
```

## CLI

```
mdcv <input>

Options:
  -o, --output <path>          Output PDF path (default: "cv.pdf")
  -t, --template <name>        Template name: modern | classic | minimal (default: "modern")
  -T, --template-path <path>   Path to a custom template folder (index.hbs + style.css)
  -c, --primary-color <hex>    Primary color (default: "#0f172a")
  --debug-html <path>          Write the intermediate HTML to a file
  --page-size <format>         PDF page size ("A4", "Letter", ...) (default: "A4")
  --no-headers                 Disable template header (if supported)
  --no-footers                 Disable template footer (if supported)
```

## Writing your CV

Put structured data in YAML frontmatter and/or write freeform Markdown body content. See `example/cv.md`.

Frontmatter keys supported by the built-in templates:

- name, title, location, email, phone, website, linkedin, github, summary
- skills (string[])
- languages (string[])
- tools (string[])
- experience (array of items with: role, company, location, start, end, summary, highlights[])
- projects (array with: name, link, summary, highlights[], stack[])
- education (array with: degree, school, location, start, end, summary)
- certifications (string[])
- photo (URL or local path, optional)

If no frontmatter is present, the Markdown body will still be rendered under the content section.

## Custom templates

Provide a folder with:

- index.hbs — HTML Handlebars template
- style.css — CSS applied inline

These values are available in the template:

- `css`: The contents of your `style.css` (inlined into a `<style>` tag)
- `primaryColor`: The color passed via CLI (`-c`)
- `showHeader`, `showFooter`: Flags controlled by `--no-headers` and `--no-footers`
- `data`: Frontmatter object
- `contentHtml`: The rendered Markdown body

Helpers available:

- `{{join arr ", "}}`
- `{{daterange start end}}` — formats e.g. `2019 — Present`
- `{{ifAny a b c}}` — truthy OR
- `{{lower str}}`
- `{{{safe html}}}` — render pre-escaped HTML

Example minimal `index.hbs`:

```hbs
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>{{{css}}}</style>
  <style>:root { --primary: {{primaryColor}}; }</style>
</head>
<body>
  <h1>{{data.name}}</h1>
  {{{safe contentHtml}}}
</body>
</html>
```

## Notes

- Images: Use absolute file paths or data URLs for `photo` to ensure Puppeteer can load them.
- Fonts: Templates use system font stacks for reliability; you can embed custom fonts in your `style.css` with `@font-face`.
- Page size: Use `--page-size Letter` if you prefer US Letter.
- Debug: Use `--debug-html out.html` to tweak styles and iterate quickly.

## License

MIT
