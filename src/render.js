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

  const model = {
    css,
    primaryColor,
    showHeader,
    showFooter,
    // frontmatter structured fields (optional)
    data: frontmatter || {},
    // fallback: rendered markdown content
    contentHtml
  };

  // Add some safe defaults so templates can rely on structure
  model.data.name = model.data.name || '';
  model.data.title = model.data.title || '';
  model.data.location = model.data.location || '';
  model.data.email = model.data.email || '';
  model.data.phone = model.data.phone || '';
  model.data.website = model.data.website || '';
  model.data.linkedin = model.data.linkedin || '';
  model.data.github = model.data.github || '';
  model.data.summary = model.data.summary || '';
  model.data.skills = model.data.skills || [];
  model.data.languages = model.data.languages || [];
  model.data.tools = model.data.tools || [];
  model.data.projects = model.data.projects || [];
  model.data.experience = model.data.experience || [];
  model.data.education = model.data.education || [];
  model.data.certifications = model.data.certifications || [];
  model.data.photo = model.data.photo || '';
  model.data.theme = model.data.theme || {};

  return template(model);
}

module.exports = {
  renderHtml
};