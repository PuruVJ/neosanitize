// Regenerates docs/public/og.png — the social/OpenGraph card (1200×630 logical,
// rendered at 2× = 2400×1260) — from the inline template below, via headless
// Chrome. Edit the copy/pills here and re-run:
//
//   node docs/scripts/generate-og.mjs        (or: pnpm --filter neosanitize-docs run og)
//
// Override the browser with CHROME_BIN=/path/to/chrome if needed. The PNG is
// committed (CI doesn't regenerate it).
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HTML = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1200px; height: 630px; }
  body {
    background: #0d0d12; color: #f1f0f6;
    font-family: ui-monospace, "SF Mono", "Menlo", monospace;
    position: relative; overflow: hidden;
  }
  .grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(rgba(167,139,250,.10) 1px, transparent 1px),
      linear-gradient(90deg, rgba(167,139,250,.10) 1px, transparent 1px);
    background-size: 44px 44px;
    -webkit-mask-image: radial-gradient(120% 120% at 100% 0%, #000 0%, transparent 62%);
            mask-image: radial-gradient(120% 120% at 100% 0%, #000 0%, transparent 62%);
  }
  .glow {
    position: absolute; top: -260px; right: -200px;
    width: 700px; height: 700px; border-radius: 50%;
    background: radial-gradient(circle, rgba(124,58,237,.30), transparent 65%);
    filter: blur(20px);
  }
  .wrap { position: relative; z-index: 1; height: 100%; padding: 66px 70px; display: flex; flex-direction: column; }
  .brand { display: flex; align-items: center; gap: 18px; }
  .badge {
    width: 60px; height: 60px; border-radius: 14px;
    background: rgba(139,92,246,.10); border: 1.5px solid rgba(139,92,246,.32);
    display: flex; align-items: center; justify-content: center;
  }
  .wordmark { font-size: 33px; font-weight: 700; letter-spacing: -.03em; }
  h1 { margin-top: 54px; font-size: 82px; font-weight: 700; line-height: 1.04; letter-spacing: -.045em; }
  h1 .accent { color: #a78bfa; }
  .sub { margin-top: 30px; max-width: 880px; font-size: 27px; line-height: 1.5; color: #9b97ad; letter-spacing: -.01em; }
  .footer { margin-top: auto; display: flex; align-items: center; justify-content: space-between; gap: 22px; flex-wrap: nowrap; }
  .pills { display: flex; gap: 12px; flex-shrink: 0; }
  .pill {
    display: flex; align-items: center; gap: 9px; white-space: nowrap;
    padding: 10px 16px; border-radius: 13px; font-size: 21px; letter-spacing: -.02em;
    background: rgba(139,92,246,.07); border: 1.5px solid rgba(139,92,246,.22); color: #d9d6e6;
  }
  .pill .em { font-size: 20px; }
  .url { font-size: 22px; color: #7c768f; letter-spacing: -.01em; white-space: nowrap; }
</style></head>
<body>
  <div class="grid"></div>
  <div class="glow"></div>
  <div class="wrap">
    <div class="brand">
      <div class="badge">
        <svg width="38" height="38" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M13 31L24 42L39 21L51 32L39 43" stroke="#a78bfa" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="24" cy="42" r="3.3" fill="#8b5cf6"/>
        </svg>
      </div>
      <div class="wordmark">neosanitize</div>
    </div>
    <h1>The browser-faithful<br><span class="accent">HTML sanitizer.</span></h1>
    <div class="sub">A WHATWG parser that matches the browser, deny-by-default behind an inviolable safe baseline — plus a byte-identical drop-in for sanitize-html.</div>
    <div class="footer">
      <div class="pills">
        <div class="pill"><span class="em">🔒</span> deny-by-default</div>
        <div class="pill"><span class="em">⚡</span> ~2.3× faster</div>
        <div class="pill"><span class="em">🍃</span> zero-dependency</div>
      </div>
      <div class="url">neosanitize.puruvj.dev</div>
    </div>
  </div>
</body></html>`;

const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!process.env.CHROME_BIN && !existsSync(CHROME)) {
	console.error('Chrome not found. Set CHROME_BIN=/path/to/chrome.');
	process.exit(1);
}

const tmp = join(mkdtempSync(join(tmpdir(), 'og-')), 'og.html');
writeFileSync(tmp, HTML);
const out = fileURLToPath(new URL('../public/og.png', import.meta.url));

execFileSync(CHROME, [
	'--headless=new', '--disable-gpu', '--hide-scrollbars',
	'--force-device-scale-factor=2',
	`--screenshot=${out}`,
	'--window-size=1200,630',
	`file://${tmp}`,
]);

console.log('✓ wrote', out, '(2400×1260)');
