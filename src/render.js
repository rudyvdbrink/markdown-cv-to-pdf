const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const Handlebars = require('handlebars');
const MarkdownIt = require('markdown-it');

const BUILTIN_TEMPLATES_DIR = path.join(__dirname, '..', 'templates');

function loadTemplateDir({ templateName, templatePath }) {
  if (templatePath) {
    const dir = templatePath;
    const indexPath = path.join(dir, 'index.hbs');
    const stylePath = path.join(dir, 'style.css');
    if (!fs.existsSync(indexPath) || !fs.existsSync(stylePath)) {
      throw new Error('Custom template must contain index.hbs and style.css');
    }
    return { dir, indexPath, stylePath };
  }

  const dir = path.join(BUILTIN_TEMPLATES_DIR, templateName);
  const indexPath = path.join(dir, 'index.hbs');
  const stylePath = path.join(dir, 'style.css');
  if (!fs.existsSync(indexPath) || !fs.existsSync(stylePath)) {
    throw new Error(`Unknown template "${templateName}". Available: modern, classic, minimal`);
  }
  return { dir, indexPath, stylePath };
}

function registerHelpers() {
  Handlebars.registerHelper('join', function (arr, sep) {
    if (!Array.isArray(arr)) return '';
    return arr.join(sep || ', ');
  });

  Handlebars.registerHelper('daterange', function (start, end, options) {
    const fmt = (v) => (v ? String(v) : '');
    const s = fmt(start);
    const e = fmt(end) || 'Present';
    if (!s && !e) return '';
    return s && e ? `${s} — ${e}` : s || e;
  });

  Handlebars.registerHelper('ifAny', function (...args) {
    const options = args.pop();
    return args.some(Boolean) ? options.fn(this) : options.inverse(this);
  });

  Handlebars.registerHelper('lower', function (str) {
    return (str || '').toLowerCase();
  });

  Handlebars.registerHelper('safe', function (str) {
    return new Handlebars.SafeString(str || '');
  });

  // Remove surrounding single or double quotes if present
  Handlebars.registerHelper('unquote', function (str) {
    const s = (str == null ? '' : String(str)).trim();
    return s.replace(/^["']+|["']+$/g, '');
  });
}

function buildMarkdownRenderer() {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    typographer: true
  });

  // Normalize hrefs so that links without https:// get it added to the href,
  // while keeping the visible text unchanged.
  const normalizeHref = (input) => {
    const s = (input == null ? '' : String(input)).trim();
    if (!s) return s;

    const lower = s.toLowerCase();

    // Keep mailto: and tel: untouched
    if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return s;

    // Upgrade http:// to https://
    if (lower.startsWith('http://')) return 'https://' + s.slice(7);

    // Already has a scheme (https, ftp, etc.): leave as-is
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;

    // Protocol-relative URL
    if (s.startsWith('//')) return 'https:' + s;

    // Anchors and root-relative paths: leave as-is
    if (s.startsWith('#') || s.startsWith('/')) return s;

    // Bare domain or path: prefix https://
    return 'https://' + s.replace(/^\/+/, '');
  };

  // Apply at parser level
  md.normalizeLink = normalizeHref;

  // Double-ensure at render time for any links created by plugins
  const defaultLinkOpen =
    md.renderer.rules.link_open ||
    function (tokens, idx, options, env, self) {
      return self.renderToken(tokens, idx, options);
    };
  md.renderer.rules.link_open = function (tokens, idx, options, env, self) {
    const hrefIndex = tokens[idx].attrIndex('href');
    if (hrefIndex >= 0 && tokens[idx].attrs && tokens[idx].attrs[hrefIndex]) {
      const href = tokens[idx].attrs[hrefIndex][1];
      tokens[idx].attrs[hrefIndex][1] = normalizeHref(href);
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  return md;
}

/**
 * Lightweight Markdown helpers
 */
function stripMd(s) {
  if (!s) return '';
  // Remove bold/italic
  s = s.replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/_(.*?)_/g, '$1');
  // Turn links into text
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1');
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

function splitSectionsByH2(md) {
  const lines = md.split(/\r?\n/);
  const sections = [];
  let current = { title: null, lines: [] };
  for (const line of lines) {
    const m = line.match(/^##\s+(.*)$/);
    if (m) {
      if (current.title || current.lines.length) sections.push(current);
      current = { title: m[1].trim().toUpperCase(), lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.title || current.lines.length) sections.push(current);
  const out = {};
  for (const s of sections) {
    if (!s.title) continue;
    out[s.title] = s.lines;
  }
  return out;
}

function collectH3Blocks(lines) {
  // Returns array of {heading, bodyLines}
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const m = line.match(/^###\s+(.*)$/);
    if (m) {
      if (cur) blocks.push(cur);
      cur = { heading: m[1].trim(), bodyLines: [] };
      continue;
    }
    if (!cur) continue;
    cur.bodyLines.push(line);
  }
  if (cur) blocks.push(cur);
  return blocks;
}

function parseKeyValueLines(lines) {
  const data = {};
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z][A-Za-z \-]*)\s*:\s*(.+)$/);
    if (m) {
      const key = m[1].toLowerCase().replace(/\s+/g, ' ').trim();
      const val = stripMd(m[2].trim());
      if (['name', 'title', 'degree', 'location', 'email', 'phone'].includes(key)) {
        data[key] = val;
      }
    }
  }
  return data;
}

function parseWebPresence(lines) {
  const links = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)/);
    if (m) links.push({ text: m[1].trim(), url: m[2].trim() });
    else {
      const m2 = raw.match(/^\s*-\s*(https?:\/\/\S+)/);
      if (m2) links.push({ text: m2[1], url: m2[1] });
    }
  }
  const out = {};
  for (const { text, url } of links) {
    const u = url.toLowerCase();
    if (u.includes('github.com')) out.github = text || url;
    else if (u.includes('linkedin.com')) out.linkedin = text || url;
    else if (u.includes('bsky.app')) out.bluesky = text || url; // keep for future use
  }
  const site = links.find(
    (l) => !/github\.com|linkedin\.com|bsky\.app/.test(l.url.toLowerCase())
  );
  if (site) out.website = site.text || site.url;
  return out;
}

function parseDateRange(line) {
  const cleaned = stripMd(line).trim();

  // en dash (–), em dash (—), or hyphen (-)
  let m = cleaned.match(/^\s*(.+?)\s*[–—-]\s*(.+?)\s*$/);
  if (m) {
    const start = m[1].trim();
    let end = m[2].trim();
    if (/^present$/i.test(end)) end = 'Present';
    return { start, end };
  }

  // textual "to"/"until"
  m = cleaned.match(/^\s*(.+?)\s+(?:to|until)\s+(.+?)\s*$/i);
  if (m) {
    const start = m[1].trim();
    let end = m[2].trim();
    if (/^present$/i.test(end)) end = 'Present';
    return { start, end };
  }

  return { start: cleaned, end: '' };
}

function parseBullets(lines) {
  const out = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*-\s+(.*)$/);
    if (m) out.push(stripMd(m[1]));
  }
  return out;
}

function parseExperience(lines) {
  const items = [];
  const blocks = collectH3Blocks(lines);
  for (const b of blocks) {
    let company = '';
    let role = '';
    const header = stripMd(b.heading);
    if (header.includes(':')) {
      const [left, right] = header.split(':');
      company = left.trim();
      role = right.trim();
    } else {
      const m = header.match(/^(.*?)\s+at\s+(.*)$/i);
      if (m) { role = m[1].trim(); company = m[2].trim(); }
      else { role = header; }
    }
    const body = b.bodyLines.filter((l) => l.trim() !== '');
    let dateLine = '';
    const nonBullet = body.find((l) => !/^\s*-\s+/.test(l));
    if (nonBullet) dateLine = nonBullet;
    const { start, end } = dateLine ? parseDateRange(dateLine) : { start: '', end: '' };
    const highlights = parseBullets(body);
    items.push({ role, company, start, end, location: '', summary: '', highlights });
  }
  return items;
}

function parseEducation(lines) {
  const items = [];
  const blocks = collectH3Blocks(lines);
  for (const b of blocks) {
    let school = '';
    let degree = '';
    const header = stripMd(b.heading);
    if (header.includes(':')) {
      const [left, right] = header.split(':');
      school = left.trim();
      degree = right.trim();
    } else {
      const m = header.match(/^(.*?)\s+at\s+(.*)$/i);
      if (m) { degree = m[1].trim(); school = m[2].trim(); }
      else { degree = header; }
    }
    const body = b.bodyLines.filter((l) => l.trim() !== '');
    let dateLine = '';
    const nonBullet = body.find((l) => !/^\s*-\s+/.test(l));
    if (nonBullet) dateLine = nonBullet;
    const { start, end } = dateLine ? parseDateRange(dateLine) : { start: '', end: '' };
    const bullets = parseBullets(body);
    const summary = bullets.join(' • ');
    items.push({ degree, school, start, end, location: '', summary });
  }
  return items;
}

function parseProductsProjects(lines) {
  const items = [];
  for (const raw of lines) {
    const m = raw.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*:\s*(.*)$/);
    if (m) {
      items.push({ name: stripMd(m[1]), link: m[2].trim(), summary: stripMd(m[3]) });
      continue;
    }
    const m2 = raw.match(/^\s*-\s*\[([^\]]+)\]\(([^)]+)\)\s*(.*)$/);
    if (m2) {
      items.push({ name: stripMd(m2[1]), link: m2[2].trim(), summary: stripMd(m2[3] || '') });
      continue;
    }
  }
  return items;
}

// Preserve structure of KEY SKILLS bullets (categories + nested bullets)
function parseKeySkillsStructured(lines) {
  const items = [];
  let current = null;

  for (const raw of lines) {
    if (!/^\s*-\s+/.test(raw)) continue;

    const indent = (raw.match(/^\s*/)?.[0] || '').replace(/\t/g, '    ').length;
    const text = raw.replace(/^\s*-\s+/, '');
    const cleaned = stripMd(text);

    if (indent <= 1) {
      // Top-level category
      let category = '';
      let rest = cleaned;

      const bold = cleaned.match(/^\*\*([^*]+)\*\*\s*:?\s*(.*)$/);
      if (bold) {
        category = bold[1].trim();
        rest = bold[2].trim();
      } else {
        const colon = cleaned.match(/^([^:]+):\s*(.*)$/);
        if (colon) {
          category = colon[1].trim();
          rest = colon[2].trim();
        } else {
          category = cleaned.trim();
          rest = '';
        }
      }

      const list =
        rest ? rest.split(/,|\band\b/).map((s) => stripMd(s).trim()).filter(Boolean) : [];

      current = { category, items: list, subitems: [] };
      items.push(current);
    } else {
      // Nested bullet under the last category
      if (!current) continue;
      const sub = cleaned;
      const i = sub.indexOf(':');
      if (i !== -1) {
        const label = sub.slice(0, i).trim();
        const vals = sub
          .slice(i + 1)
          .split(/,|\band\b/)
          .map((s) => stripMd(s).trim())
          .filter(Boolean);
        current.subitems.push({ label, items: vals });
      } else {
        current.subitems.push({ label: '', text: sub });
      }
    }
  }

  return items;
}

function parseKeySkills(lines) {
  // Flat list for tags/back-compat
  const skills = [];
  const scan = (arr) => {
    for (const raw of arr) {
      const m = raw.match(/^\s*-\s*(?:\*\*([^*]+)\*\*|([^:]+))\s*:\s*(.+)$/);
      if (m) {
        const list = (m[3] || '')
          .split(/,|\band\b/)
          .map((s) => stripMd(s))
          .map((s) => s.trim())
          .filter(Boolean);
        skills.push(...list);
      } else {
        const n = raw.match(/^\s*-\s*(.+)$/);
        if (n && n[1].includes(':')) {
          const after = n[1].split(':').slice(1).join(':');
          const list = after
            .split(/,|\band\b/)
            .map((s) => stripMd(s))
            .map((s) => s.trim())
            .filter(Boolean);
          skills.push(...list);
        }
      }
    }
  };
  scan(lines);
  return Array.from(new Set(skills));
}

function parseSummary(lines) {
  const text = stripMd(lines.join(' ').replace(/\s+/g, ' ').trim());
  return text;
}

// Helper: flatten top-level "- " bullets with soft-wrapped lines into plain strings
function flattenBulletedParagraphs(lines) {
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw || '';
    if (/^\s*-\s+/.test(line)) {
      if (cur && cur.trim()) out.push(stripMd(cur.trim()));
      cur = line.replace(/^\s*-\s+/, '').trim();
      continue;
    }
    if (cur) {
      if (line.trim() === '') {
        out.push(stripMd(cur.trim()));
        cur = null;
      } else {
        cur += ' ' + line.trim();
      }
    }
  }
  if (cur && cur.trim()) out.push(stripMd(cur.trim()));
  return out;
}

/**
 * Parse publications preserving nested "+ ..." descriptions.
 * Returns array of objects: [{ html }, ...]
 */
function parsePublications(lines, md) {
  const items = [];
  let cur = null;

  function pushCur() {
    if (!cur) return;
    const main = (cur.mainParts.join(' ').replace(/\s+/g, ' ').trim()) || '';
    const descs = cur.descs.map((s) => s.replace(/^\s*\+\s+/, '').trim()).filter(Boolean);

    if (main) {
      const mainHtml = md.renderInline(main);
      let html = mainHtml;
      for (const d of descs) {
        const descInline = md.renderInline(d);
        html += `<div class="pub-description"><em>${descInline}</em></div>`;
      }
      items.push({ html });
    }
    cur = null;
  }

  for (const raw of lines) {
    const line = raw || '';
    const trimmed = line.trim();

    if (!trimmed) {
      // blank line ends current item
      pushCur();
      continue;
    }

    const top = line.match(/^\s*-\s+(.*)$/);
    if (top) {
      // start new publication
      pushCur();
      cur = { mainParts: [top[1].trim()], descs: [] };
      continue;
    }

    if (cur) {
      const nestedPlus = line.match(/^\s{1,}\+\s+(.*)$/);
      if (nestedPlus) {
        cur.descs.push(nestedPlus[1]);
      } else {
        // continuation of main line
        cur.mainParts.push(trimmed);
      }
    }
  }
  pushCur();

  return items;
}

// Parse presentations into structured items with years and title/text
function parsePresentations(lines) {
  const entries = flattenBulletedParagraphs(lines);
  const items = [];
  for (const sRaw of entries) {
    const s = sRaw.trim();

    // Match leading years (single year, comma list, or range) followed by a colon
    let m = s.match(/^(\d{4}(?:\s*[–—-]\s*\d{4}|(?:\s*,\s*\d{4})*)?)\s*:\s*(.+)$/);
    if (m) {
      const years = m[1].replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
      const title = m[2].trim();
      items.push({ years, title });
      continue;
    }

    // Fallback: if it starts with years but no colon, split on whitespace
    m = s.match(/^(\d{4}(?:\s*[–—-]\s*\d{4}|(?:\s*,\s*\d{4})*)?)\s+(.*)$/);
    if (m) {
      const years = m[1].replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ').trim();
      const title = m[2].trim();
      items.push({ years, title });
      continue;
    }

    // Last fallback: extract any years present for the meta, keep full text as title
    const yearsFound = (s.match(/\b\d{4}\b/g) || []).join(', ');
    items.push({ years: yearsFound, title: s });
  }
  return items;
}

function toAbsoluteUrl(s) {
  const v = (s == null ? '' : String(s)).trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower.startsWith('mailto:') || lower.startsWith('tel:')) return v;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://');
  if (v.startsWith('//')) return 'https:' + v;
  if (v.startsWith('#') || v.startsWith('/')) return v; // anchors/paths unchanged
  return 'https://' + v.replace(/^\/+/, '');
}

function toWebsiteHref(s) {
  const href = toAbsoluteUrl(s);
  try {
    const u = new URL(href);
    const host = u.hostname;
    // Add www. if there is no subdomain already (simple heuristic: exactly two labels)
    if (!/^www\./i.test(host)) {
      const labels = host.split('.');
      if (labels.length === 2) {
        u.hostname = 'www.' + host;
      }
    }
    return u.toString();
  } catch {
    // Fallback: if somehow not a valid URL, at least ensure https://www.
    const v = (s == null ? '' : String(s)).trim().replace(/^https?:\/\//i, '');
    if (!v) return '';
    return 'https://www.' + v.replace(/^www\./i, '');
  }
}

function toGithubHref(s) {
  const v = (s == null ? '' : String(s)).trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://');
  const noScheme = v.replace(/^https?:\/\//i, '');
  if (/^([^/]*\.)?github\.com/i.test(noScheme)) return 'https://' + noScheme;
  const username = v.replace(/^@/, '').replace(/^github\.com\//i, '');
  return 'https://github.com/' + username;
}

function toLinkedinHref(s) {
  const v = (s == null ? '' : String(s)).trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v.replace(/^http:\/\//i, 'https://');
  const noScheme = v.replace(/^https?:\/\//i, '');
  if (/^([^/]*\.)?linkedin\.com/i.test(noScheme)) {
    // Ensure www. for LinkedIn
    const hostAndPath = noScheme.replace(/^linkedin\.com/i, 'www.linkedin.com');
    return 'https://' + hostAndPath;
  }
  const handle = v.replace(/^@/, '').replace(/^linkedin\.com\/in\//i, '');
  return 'https://www.linkedin.com/in/' + handle;
}

function parseStructuredFromMarkdown(mdSource, mdRenderer) {
  const sections = splitSectionsByH2(mdSource);
  const result = {
    // top-level identity
    name: '',
    title: '',
    degree: '',
    location: '',
    email: '',
    phone: '',
    website: '',
    github: '',
    linkedin: '',
    // sidebar content
    summary: '',
    // skills
    keySkills: [],
    skills: [],
    languages: [],
    tools: [],
    // main content
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    publications: [],
    presentations: []
  };

  let any = false;

  if (sections['CONTACT']) {
    const kv = parseKeyValueLines(sections['CONTACT']);
    Object.assign(result, kv);
    any = any || Object.keys(kv).length > 0;
  }
  if (sections['WEB PRESENCE']) {
    const wp = parseWebPresence(sections['WEB PRESENCE']);
    Object.assign(result, wp);
    any = any || Object.keys(wp).length > 0;
  }
  if (sections['SUMMARY']) {
    const s = parseSummary(sections['SUMMARY']);
    if (s) { result.summary = s; any = true; }
  }
  if (sections['EXPERIENCE']) {
    const ex = parseExperience(sections['EXPERIENCE']);
    if (ex.length) { result.experience = ex; any = true; }
  }
  if (sections['EDUCATION']) {
    const ed = parseEducation(sections['EDUCATION']);
    if (ed.length) { result.education = ed; any = true; }
  }
  if (
    sections['PRODUCTS AND OPEN SOURCE SOFTWARE'] ||
    sections['PRODUCTS'] ||
    sections['OPEN SOURCE SOFTWARE']
  ) {
    const lines =
      sections['PRODUCTS AND OPEN SOURCE SOFTWARE'] ||
      sections['PRODUCTS'] ||
      sections['OPEN SOURCE SOFTWARE'] ||
      [];
    const proj = parseProductsProjects(lines);
    if (proj.length) { result.projects = proj; any = true; }
  }
  if (sections['KEY SKILLS'] || sections['SKILLS']) {
    const src = sections['KEY SKILLS'] || sections['SKILLS'] || [];
    const ksFlat = parseKeySkills(src);
    const ksStruct = parseKeySkillsStructured(src);
    if (ksFlat.length) { result.skills = ksFlat; any = true; }
    if (ksStruct.length) { result.keySkills = ksStruct; any = true; }
  }
  if (sections['LANGUAGES']) {
    const langs = parseBullets(sections['LANGUAGES']);
    if (langs.length) { result.languages = langs; any = true; }
  }
  if (sections['SELECTED CONFERENCE PRESENTATIONS'] || sections['CONFERENCE PRESENTATIONS'] || sections['PRESENTATIONS']) {
    const lines =
      sections['SELECTED CONFERENCE PRESENTATIONS'] ||
      sections['CONFERENCE PRESENTATIONS'] ||
      sections['PRESENTATIONS'] ||
      [];
    const pres = parsePresentations(lines);
    if (pres.length) { result.presentations = pres; any = true; }
  }
  if (sections['KEY SCIENTIFIC PUBLICATIONS'] || sections['PUBLICATIONS']) {
    const pubs = parsePublications(
      sections['KEY SCIENTIFIC PUBLICATIONS'] || sections['PUBLICATIONS'] || [],
      mdRenderer || buildMarkdownRenderer()
    );
    if (pubs.length) { result.publications = pubs; any = true; }
  }

  return { data: result, hasStructured: any };
}

async function renderHtml({
  markdownPath,
  templateName,
  templatePath,
  primaryColor = '#0f172a',
  showHeader = true,
  showFooter = true
}) {
  registerHelpers();

  const raw = fs.readFileSync(markdownPath, 'utf8');
  const { data: frontmatter, content: md } = matter(raw);

  const mdIt = buildMarkdownRenderer();
  const contentHtml = mdIt.render(md);

  const { indexPath, stylePath } = loadTemplateDir({ templateName, templatePath });
  const templateSrc = fs.readFileSync(indexPath, 'utf8');
  const css = fs.readFileSync(stylePath, 'utf8');

  const template = Handlebars.compile(templateSrc, { noEscape: false });

  // Try to parse structured data from Markdown if frontmatter is missing/partial
  const { data: parsed, hasStructured } = parseStructuredFromMarkdown(md, mdIt);

  const mergedData = {
    ...parsed,
    ...(frontmatter || {})
  };

  // Derive absolute hrefs for personal links (display text remains as provided)
  const websiteHref = toWebsiteHref(mergedData.website || '');
  const githubHref = toGithubHref(mergedData.github || '');
  const linkedinHref = toLinkedinHref(mergedData.linkedin || '');

  // Normalize project links to clickable hrefs
  const projects = Array.isArray(mergedData.projects)
    ? mergedData.projects.map((p) => ({
        ...p,
        linkHref: toAbsoluteUrl(p.link || '')
      }))
    : [];

  const model = {
    css,
    primaryColor,
    showHeader,
    showFooter,
    data: {
      ...mergedData,
      websiteHref,
      githubHref,
      linkedinHref,
      projects
    },
    // If we have structured data, suppress full markdown body to avoid duplication
    contentHtml: hasStructured ? '' : contentHtml
  };

  // Safe defaults
  model.data.name = model.data.name || '';
  model.data.title = model.data.title || '';
  model.data.degree = model.data.degree || '';
  model.data.location = model.data.location || '';
  model.data.email = model.data.email || '';
  model.data.phone = model.data.phone || '';

  const html = template(model);
  return html;
}

module.exports = { renderHtml };