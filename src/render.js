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
}

function buildMarkdownRenderer() {
  return new MarkdownIt({
    html: true,
    linkify: true,
    breaks: false,
    typographer: true
  });
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
      if (['name', 'title', 'location', 'email', 'phone'].includes(key)) {
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
  const site = links.find(l => !/github\.com|linkedin\.com|bsky\.app/.test(l.url.toLowerCase()));
  if (site) out.website = site.text || site.url;
  return out;
}

function parseDateRange(line) {
  const cleaned = stripMd(line);
  const m = cleaned.match(/(.+?)\s*[–-]\s*(.+)/); // en dash or hyphen
  if (m) {
    return { start: m[1].trim(), end: m[2].trim() };
  }
  return { start: cleaned.trim(), end: '' };
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
    const body = b.bodyLines.filter(l => l.trim() !== '');
    let dateLine = '';
    const nonBullet = body.find(l => !/^\s*-\s+/.test(l));
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
    const body = b.bodyLines.filter(l => l.trim() !== '');
    let dateLine = '';
    const nonBullet = body.find(l => !/^\s*-\s+/.test(l));
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

function parseKeySkills(lines) {
  const skills = [];
  const scan = (arr) => {
    for (const raw of arr) {
      const m = raw.match(/^\s*-\s*(?:\*\*([^*]+)\*\*|([^:]+))\s*:\s*(.+)$/);
      if (m) {
        const list = (m[3] || '').split(/,|\band\b/).map(s => stripMd(s)).map(s => s.trim()).filter(Boolean);
        skills.push(...list);
      } else {
        const n = raw.match(/^\s*-\s*(.+)$/);
        if (n && n[1].includes(':')) {
          const after = n[1].split(':').slice(1).join(':');
          const list = after.split(/,|\band\b/).map(s => stripMd(s)).map(s => s.trim()).filter(Boolean);
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

function parsePublications(lines) {
  // Collect multi-line bullet paragraphs into single strings
  const pubs = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw || '';
    if (/^\s*-\s+/.test(line)) {
      // finalize previous
      if (cur && cur.trim()) pubs.push(stripMd(cur.trim()));
      cur = line.replace(/^\s*-\s+/, '').trim();
      continue;
    }
    if (cur) {
      if (line.trim() === '') {
        // blank line ends the current bullet
        pubs.push(stripMd(cur.trim()));
        cur = null;
      } else {
        cur += ' ' + line.trim();
      }
    }
  }
  if (cur && cur.trim()) pubs.push(stripMd(cur.trim()));
  return pubs;
}

function parseStructuredFromMarkdown(md) {
  const sections = splitSectionsByH2(md);
  const result = {
    // top-level identity
    name: '',
    title: '',
    location: '',
    email: '',
    phone: '',
    website: '',
    github: '',
    linkedin: '',
    // sidebar content
    summary: '',
    skills: [],
    languages: [],
    tools: [],
    // main content
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    publications: []
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
  if (sections['PRODUCTS AND OPEN SOURCE SOFTWARE'] || sections['PRODUCTS'] || sections['OPEN SOURCE SOFTWARE']) {
    const lines = sections['PRODUCTS AND OPEN SOURCE SOFTWARE'] || sections['PRODUCTS'] || sections['OPEN SOURCE SOFTWARE'] || [];
    const proj = parseProductsProjects(lines);
    if (proj.length) { result.projects = proj; any = true; }
  }
  if (sections['KEY SKILLS'] || sections['SKILLS']) {
    const ks = parseKeySkills(sections['KEY SKILLS'] || sections['SKILLS'] || []);
    if (ks.length) { result.skills = ks; any = true; }
  }
  if (sections['KEY SCIENTIFIC PUBLICATIONS'] || sections['PUBLICATIONS']) {
    const pubs = parsePublications(sections['KEY SCIENTIFIC PUBLICATIONS'] || sections['PUBLICATIONS'] || []);
    if (pubs.length) { result.publications = pubs; any = true; }
  }

  return { data: result, hasStructured: any };
}

async function renderHtml({ markdownPath, templateName, templatePath, primaryColor = '#0f172a', showHeader = true, showFooter = true }) {
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
  const { data: parsed, hasStructured } = parseStructuredFromMarkdown(md);

  const mergedData = {
    ...parsed,
    ...(frontmatter || {})
  };

  const model = {
    css,
    primaryColor,
    showHeader,
    showFooter,
    data: mergedData,
    // If we have structured data, suppress full markdown body to avoid duplication
    contentHtml: hasStructured ? '' : contentHtml
  };

  // Safe defaults
  model.data.name = model.data.name || '';
  model.data.title = model.data.title || '';
  model.data.location = model.data.location || '';
  model.data.email = model.data.email || '';
  model.data.phone = model.data.phone || '';

  const html = template(model);
  return html;
}

module.exports = { renderHtml };