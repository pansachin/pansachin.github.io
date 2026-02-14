const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Zero-dependency markdown & front-matter parsing
// ---------------------------------------------------------------------------

function parseFrontMatter(raw) {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { attributes: {}, body: raw };

  const yamlBlock = match[1];
  const body = match[2];
  const attributes = {};

  for (const line of yamlBlock.split('\n')) {
    const m = line.match(/^(\w+):\s*(.+)$/);
    if (m) {
      let value = m[2].trim();
      // Parse arrays: [tag1, tag2]
      if (value.startsWith('[') && value.endsWith(']')) {
        value = value.slice(1, -1).split(',').map(s => s.trim());
      }
      attributes[m[1]] = value;
    }
  }

  return { attributes, body };
}

function markdownToHtml(md) {
  let html = md;

  // Fenced code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    const escaped = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return `<pre><code class="language-${lang || 'text'}">${escaped}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>');
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Horizontal rule
  html = html.replace(/^---$/gm, '<hr>');

  // Bold and italic
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Links
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  // Images
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />');

  // Unordered lists
  html = html.replace(/^(?:- (.+)\n?)+/gm, (match) => {
    const items = match.trim().split('\n').map(line => {
      const content = line.replace(/^- /, '');
      return `  <li>${content}</li>`;
    });
    return `<ul>\n${items.join('\n')}\n</ul>`;
  });

  // Blockquotes
  html = html.replace(/^> (.+)$/gm, '<blockquote><p>$1</p></blockquote>');

  // Paragraphs: wrap remaining bare text lines
  html = html.replace(/^(?!<[a-z/]|$)(.+)$/gm, '<p>$1</p>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  // Merge adjacent blockquotes
  html = html.replace(/<\/blockquote>\s*<blockquote>/g, '\n');

  return html.trim();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const POSTS_DIR = path.join(__dirname, 'blog', 'posts');
const TEMPLATES_DIR = path.join(__dirname, 'blog', 'templates');
const OUTPUT_BLOG_DIR = path.join(__dirname, 'blog');

function slugify(filename) {
  return filename.replace(/\.md$/, '');
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function isoDate(dateStr) {
  return new Date(dateStr).toISOString().split('T')[0];
}

function renderTags(tags) {
  if (!tags || tags.length === 0) return '';
  const arr = Array.isArray(tags) ? tags : [tags];
  return arr.map(t => `<span class="tag">${t}</span>`).join(' ');
}

function renderTemplate(template, vars) {
  let html = template;
  for (const [key, value] of Object.entries(vars)) {
    html = html.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'g'), value);
  }
  return html;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Parse all markdown posts
// ---------------------------------------------------------------------------

function getPosts() {
  const files = fs.readdirSync(POSTS_DIR).filter(f => f.endsWith('.md'));
  const posts = [];

  for (const file of files) {
    const raw = fs.readFileSync(path.join(POSTS_DIR, file), 'utf-8');
    const { attributes, body } = parseFrontMatter(raw);

    if (!attributes.title || !attributes.date) {
      console.warn(`  Skipping ${file}: missing title or date`);
      continue;
    }

    const slug = slugify(file);
    const htmlContent = markdownToHtml(body);

    posts.push({
      slug,
      title: attributes.title,
      date: attributes.date,
      description: attributes.description || '',
      tags: attributes.tags || [],
      formattedDate: formatDate(attributes.date),
      isoDate: isoDate(attributes.date),
      tagsHtml: renderTags(attributes.tags),
      content: htmlContent,
      url: `/blog/posts/${slug}/`,
    });
  }

  posts.sort((a, b) => new Date(b.date) - new Date(a.date));
  return posts;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildPosts(posts) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'post.html'), 'utf-8');

  for (const post of posts) {
    const html = renderTemplate(template, {
      title: post.title,
      description: post.description,
      formattedDate: post.formattedDate,
      isoDate: post.isoDate,
      tags: post.tagsHtml,
      content: post.content,
    });

    const outDir = path.join(OUTPUT_BLOG_DIR, 'posts', post.slug);
    ensureDir(outDir);
    fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf-8');
    console.log(`  Built: /blog/posts/${post.slug}/`);
  }
}

function buildListing(posts) {
  const template = fs.readFileSync(path.join(TEMPLATES_DIR, 'listing.html'), 'utf-8');

  const postCards = posts
    .map(p => `
      <article class="post-card">
        <a href="${p.url}" class="post-card-link">
          <h2>${p.title}</h2>
          <p class="post-excerpt">${p.description}</p>
          <div class="post-card-meta">
            <time datetime="${p.isoDate}">${p.formattedDate}</time>
            ${p.tagsHtml}
          </div>
        </a>
      </article>`)
    .join('\n');

  const html = renderTemplate(template, { posts: postCards });
  fs.writeFileSync(path.join(OUTPUT_BLOG_DIR, 'index.html'), html, 'utf-8');
  console.log('  Built: /blog/index.html');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log('Building blog...\n');

  const posts = getPosts();
  console.log(`Found ${posts.length} post(s)\n`);

  if (posts.length === 0) {
    console.log('No posts found. Add .md files to blog/posts/');
    return;
  }

  buildPosts(posts);
  buildListing(posts);

  console.log('\nBlog build complete!');
}

main();
