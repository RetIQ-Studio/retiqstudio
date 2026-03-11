#!/usr/bin/env node
/**
 * RetIQ Build Script
 * 
 * Minifies the single-file HTML app for production deployment.
 * - Extracts <style> and <script> blocks
 * - Minifies JS (variable mangling, dead code removal, whitespace stripping)
 * - Minifies CSS (shorthand collapsing, whitespace stripping)
 * - Compresses HTML shell
 * - Reassembles into dist/index.html
 * 
 * Usage:  node build.js
 * Output: dist/ folder ready for Cloudflare Pages deploy
 */

const fs = require('fs');
const path = require('path');
// Try to find esbuild: local install first, then common global paths
let esbuild;
const tryPaths = [
  'esbuild',  // local node_modules or global npm
  path.join(process.env.HOME || '', '.npm-global/lib/node_modules/tsx/node_modules/esbuild'),
  '/home/claude/.npm-global/lib/node_modules/tsx/node_modules/esbuild',
];
for (const p of tryPaths) {
  try { esbuild = require(p); break; } catch {}
}
if (!esbuild) {
  console.error('❌ esbuild not found. Install it:\n   npm install esbuild --save-dev');
  process.exit(1);
}
const { transformSync } = esbuild;

const SRC = path.join(__dirname, 'app-index.html');
const DEPLOY = path.join(__dirname, 'retiq-deploy');
const APP_DIR = path.join(DEPLOY, 'app');

// App files → retiq-deploy/app/
const APP_SUPPORT = ['offline.html', 'success.html'];
const APP_COPY = ['service-worker.js', 'manifest.webmanifest'];
const APP_COPY_DIRS = ['icons', 'fonts'];

// Site files → retiq-deploy/ (root)
const SITE_FILES = ['index.html', 'manual.html', 'features.html', 'terms.html', 'privacy.html', 'security.html', 'validation.html'];
const SITE_COPY = ['robots.txt'];

// ── Helpers ──────────────────────────────────────────────────────────

function minifyJS(code) {
  const result = transformSync(code, {
    loader: 'js',
    minify: true,
    target: 'es2020',
    // Mangle all local variable names
    mangleProps: undefined,  // don't mangle property access (breaks DOM APIs)
  });
  return result.code;
}

function minifyCSS(code) {
  const result = transformSync(code, {
    loader: 'css',
    minify: true,
    target: 'chrome90',
  });
  return result.code;
}

function minifyHTML(html) {
  return html
    // Collapse runs of whitespace between tags (but not inside <pre>/<script>/<style>)
    .replace(/>\s+</g, '><')
    // Trim leading/trailing whitespace per line
    .replace(/^\s+/gm, '')
    // Remove HTML comments (but not IE conditionals)
    .replace(/<!--(?!\[if)[\s\S]*?-->/g, '')
    .trim();
}

// ── Extract & replace blocks ────────────────────────────────────────

function processMainApp(html) {
  let output = html;
  let jsCount = 0, cssCount = 0;
  let jsSavedBytes = 0, cssSavedBytes = 0;

  // Process <style>...</style> blocks (top-level only, not inside JS strings)
  // We need to be careful: the PDF export has <style> inside a template literal
  // Strategy: only minify <style> blocks that START at the beginning of a line
  output = output.replace(/^(<style>)([\s\S]*?)(<\/style>)/gm, (match, open, css, close) => {
    const original = css.length;
    try {
      const minified = minifyCSS(css);
      cssSavedBytes += original - minified.length;
      cssCount++;
      return open + minified + close;
    } catch (e) {
      console.warn('  ⚠ CSS minification failed, keeping original:', e.message);
      return match;
    }
  });

  // Process <script>...</script> blocks
  output = output.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (match, open, js, close) => {
    const original = js.length;
    try {
      const minified = minifyJS(js);
      jsSavedBytes += original - minified.length;
      jsCount++;
      return open + minified + close;
    } catch (e) {
      console.warn('  ⚠ JS minification failed, keeping original:', e.message);
      return match;
    }
  });

  // Minify the HTML shell (between tags)
  const beforeSize = output.length;
  output = minifyHTML(output);
  const htmlSaved = beforeSize - output.length;

  return { output, jsCount, cssCount, jsSavedBytes, cssSavedBytes, htmlSaved };
}

function processSupportFile(html) {
  let output = html;

  // Minify inline <style>
  output = output.replace(/(<style>)([\s\S]*?)(<\/style>)/g, (match, open, css, close) => {
    try { return open + minifyCSS(css) + close; }
    catch { return match; }
  });

  // Minify inline <script> if any
  output = output.replace(/(<script>)([\s\S]*?)(<\/script>)/g, (match, open, js, close) => {
    try { return open + minifyJS(js) + close; }
    catch { return match; }
  });

  return minifyHTML(output);
}

function minifyServiceWorker(code) {
  try { return minifyJS(code); }
  catch (e) {
    console.warn('  ⚠ SW minification failed:', e.message);
    return code;
  }
}

// ── Main ────────────────────────────────────────────────────────────

console.log('🔨 RetIQ Build');
console.log('─'.repeat(50));

// Ensure directories exist
if (!fs.existsSync(APP_DIR)) fs.mkdirSync(APP_DIR, { recursive: true });

// 1. Main app → retiq-deploy/app/index.html
console.log('\n📦 app-index.html → retiq-deploy/app/index.html');
const srcHtml = fs.readFileSync(SRC, 'utf8');
const srcSize = Buffer.byteLength(srcHtml);
let { output, jsCount, cssCount, jsSavedBytes, cssSavedBytes, htmlSaved } = processMainApp(srcHtml);

// Inject build timestamp
const buildTime = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
output = output.replace(/__BUILD_TIMESTAMP__/g, buildTime);
console.log(`  Build:      ${buildTime}`);

const distSize = Buffer.byteLength(output);

fs.writeFileSync(path.join(APP_DIR, 'index.html'), output);

console.log(`  JS blocks:  ${jsCount} minified (saved ${(jsSavedBytes / 1024).toFixed(0)} KB)`);
console.log(`  CSS blocks: ${cssCount} minified (saved ${(cssSavedBytes / 1024).toFixed(0)} KB)`);
console.log(`  HTML:       saved ${(htmlSaved / 1024).toFixed(0)} KB`);
console.log(`  Total:      ${(srcSize / 1024).toFixed(0)} KB → ${(distSize / 1024).toFixed(0)} KB (${((1 - distSize / srcSize) * 100).toFixed(0)}% smaller)`);

// 2. App support files → retiq-deploy/app/
console.log('\n📄 App support files (→ app/):');
for (const file of APP_SUPPORT) {
  const srcPath = path.join(__dirname, file);
  if (!fs.existsSync(srcPath)) { console.log(`  ${file} — skipped (not found)`); continue; }
  const src = fs.readFileSync(srcPath, 'utf8');
  const dist = processSupportFile(src);
  fs.writeFileSync(path.join(APP_DIR, file), dist);
  const pct = ((1 - Buffer.byteLength(dist) / Buffer.byteLength(src)) * 100).toFixed(0);
  console.log(`  ${file}: ${(Buffer.byteLength(src) / 1024).toFixed(0)} KB → ${(Buffer.byteLength(dist) / 1024).toFixed(0)} KB (${pct}% smaller)`);
}

// 3. Site files → retiq-deploy/ (root)
console.log('\n📄 Site files (→ root):');
for (const file of SITE_FILES) {
  const srcPath = path.join(__dirname, file);
  if (!fs.existsSync(srcPath)) { console.log(`  ${file} — skipped (not found)`); continue; }
  const src = fs.readFileSync(srcPath, 'utf8');
  const dist = processSupportFile(src);
  fs.writeFileSync(path.join(DEPLOY, file), dist);
  const pct = ((1 - Buffer.byteLength(dist) / Buffer.byteLength(src)) * 100).toFixed(0);
  console.log(`  ${file}: ${(Buffer.byteLength(src) / 1024).toFixed(0)} KB → ${(Buffer.byteLength(dist) / 1024).toFixed(0)} KB (${pct}% smaller)`);
}

// 4. Service worker → retiq-deploy/app/
console.log('\n⚙️  service-worker.js (→ app/):');
const swPath = path.join(__dirname, 'service-worker.js');
if (fs.existsSync(swPath)) {
  const swSrc = fs.readFileSync(swPath, 'utf8');
  const swDist = minifyServiceWorker(swSrc);
  fs.writeFileSync(path.join(APP_DIR, 'service-worker.js'), swDist);
  console.log(`  ${(Buffer.byteLength(swSrc) / 1024).toFixed(1)} KB → ${(Buffer.byteLength(swDist) / 1024).toFixed(1)} KB`);
}

// 5. Static files
console.log('\n📋 Static files:');
for (const file of APP_COPY.filter(f => f !== 'service-worker.js')) {
  const srcPath = path.join(__dirname, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(APP_DIR, file));
    console.log(`  app/${file}: copied`);
  } else {
    console.log(`  app/${file}: skipped (not found)`);
  }
}
for (const dir of APP_COPY_DIRS) {
  const srcDir = path.join(__dirname, dir);
  const distDir = path.join(APP_DIR, dir);
  if (fs.existsSync(srcDir)) {
    fs.cpSync(srcDir, distDir, { recursive: true });
    const fileCount = fs.readdirSync(distDir).filter(f => !f.startsWith('.')).length;
    console.log(`  app/${dir}/: ${fileCount} files copied`);
  } else {
    console.log(`  app/${dir}/: skipped (not found)`);
  }
}
for (const file of SITE_COPY) {
  const srcPath = path.join(__dirname, file);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, path.join(DEPLOY, file));
    console.log(`  ${file}: copied`);
  } else {
    console.log(`  ${file}: skipped (not found)`);
  }
}

// 6. Verify the minified output is valid JS
console.log('\n✅ Verification:');
const distHtml = fs.readFileSync(path.join(APP_DIR, 'index.html'), 'utf8');
const scripts = [...distHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)];
let allValid = true;
scripts.forEach((m, i) => {
  try {
    new Function(m[1]);
    console.log(`  Script ${i}: valid ✓`);
  } catch (e) {
    console.log(`  Script ${i}: INVALID ✗ — ${e.message}`);
    allValid = false;
  }
});

if (allValid) {
  console.log(`\n🚀 Build complete → retiq-deploy/ ready for upload`);
  console.log(`   Deploy with: npx wrangler pages deploy retiq-deploy/ --project-name=retiqstudio`);
} else {
  console.error('\n❌ Build has errors — do NOT deploy');
  process.exit(1);
}
