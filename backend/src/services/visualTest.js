import { chromium } from 'playwright';
import pixelmatch from 'pixelmatch';
import { PNG } from 'pngjs';
import { mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';

dotenv.config();

const VIEWPORT = {
  width: parseInt(process.env.VIEWPORT_WIDTH || '1280', 10),
  height: parseInt(process.env.VIEWPORT_HEIGHT || '720', 10)
};
const LAYOUT_SHIFT_PX = parseInt(process.env.LAYOUT_SHIFT_PX || '8', 10);

// Disable animations/transitions so screenshots are deterministic
const STABILIZE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    caret-color: transparent !important;
  }
`;

function routeHash(route) {
  return route.replace(/[^a-zA-Z0-9]/g, '_') || 'root';
}

/**
 * Capture a stabilized screenshot of each route.
 * Returns { dir, shots: [{ route, file, boxes: {selector: {x,y,width,height}} }] }
 */
async function captureScreenshots(appUrl, routes, outDir, targetSelectors = []) {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  const shots = [];
  for (const route of routes) {
    const url = route.startsWith('http') ? route : `${appUrl}${route}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.addStyleTag({ content: STABILIZE_CSS });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(500);

      const file = join(outDir, `${routeHash(route)}.png`);
      await page.screenshot({ path: file, fullPage: false });

      // Capture bounding boxes of the target elements (for layout-shift check)
      const boxes = {};
      for (const selector of targetSelectors) {
        try {
          const el = page.locator(selector).first();
          const box = await el.boundingBox({ timeout: 2000 });
          if (box) boxes[selector] = box;
        } catch {
          // Element not present on this route — skip
        }
      }

      shots.push({ route, url, file, boxes });
    } catch (err) {
      console.error(`[visual] Screenshot failed for ${url}: ${err.message}`);
      shots.push({ route, url, file: null, error: err.message, boxes: {} });
    }
  }

  await browser.close();
  return { dir: outDir, shots };
}

/**
 * Compare two screenshots. Returns { diffRatio, diffFile } or null if
 * either image is missing.
 */
function compareImages(beforeFile, afterFile, diffFile) {
  if (!beforeFile || !afterFile) return null;
  try {
    const before = PNG.sync.read(readFileSync(beforeFile));
    const after = PNG.sync.read(readFileSync(afterFile));

    // Use the smaller dimensions (page height may differ slightly)
    const width = Math.min(before.width, after.width);
    const height = Math.min(before.height, after.height);

    const diff = new PNG({ width, height });
    const changedPixels = pixelmatch(
      before.data, after.data, diff.data, width, height,
      { threshold: 0.1 }
    );

    writeFileSync(diffFile, PNG.sync.write(diff));

    return {
      diffRatio: changedPixels / (width * height),
      diffFile,
      width,
      height
    };
  } catch (err) {
    console.error(`[visual] Image comparison failed: ${err.message}`);
    return null;
  }
}

/**
 * Check whether target elements shifted position/size between captures.
 */
function checkLayoutShift(beforeShots, afterShots) {
  const shifts = [];
  const afterByRoute = new Map(afterShots.map(s => [s.route, s]));

  for (const before of beforeShots) {
    const after = afterByRoute.get(before.route);
    if (!after) continue;

    for (const [selector, beforeBox] of Object.entries(before.boxes || {})) {
      const afterBox = after.boxes?.[selector];
      if (!afterBox) {
        shifts.push({ route: before.route, selector, reason: 'element missing after fix' });
        continue;
      }
      const dx = Math.abs(afterBox.x - beforeBox.x);
      const dy = Math.abs(afterBox.y - beforeBox.y);
      const dw = Math.abs(afterBox.width - beforeBox.width);
      const dh = Math.abs(afterBox.height - beforeBox.height);
      if (dx > LAYOUT_SHIFT_PX || dy > LAYOUT_SHIFT_PX || dw > LAYOUT_SHIFT_PX || dh > LAYOUT_SHIFT_PX) {
        shifts.push({
          route: before.route,
          selector,
          delta: { dx: +dx.toFixed(1), dy: +dy.toFixed(1), dw: +dw.toFixed(1), dh: +dh.toFixed(1) }
        });
      }
    }
  }
  return shifts;
}

/**
 * Full visual test: capture "after" screenshots, compare with the scan-time
 * baseline, and check layout stability of the target elements.
 *
 * @param {object} fix - fix record (needs scanId, appUrl, routes)
 * @param {object} scan - scan record (needs baselineDir, appProcess/restarted appUrl)
 * @param {string[]} targetSelectors - CSS selectors of the fixed elements
 * @param {string} currentAppUrl - the (restarted) app URL serving the FIXED code
 */
export async function runVisualTest(fix, scan, targetSelectors, currentAppUrl) {
  const routes = fix.routes || ['/'];
  const baselineDir = scan.baselineDir || join('tmp', fix.scanId, 'baseline');
  const afterDir = join('tmp', fix.scanId, 'after', fix.fixId);

  const before = await captureScreenshots(currentAppUrl, routes, baselineDir, targetSelectors)
    .catch(() => null);

  // If no baseline exists yet, capture it now (first run) and report that
  if (!before || before.shots.every(s => !s.file)) {
    const fresh = await captureScreenshots(currentAppUrl, routes, baselineDir, targetSelectors);
    return {
      status: 'baseline-created',
      message: 'No baseline existed — captured current state as baseline. Run again after a fix to compare.',
      baselineDir,
      shots: fresh.shots.map(s => ({ route: s.route, file: s.file }))
    };
  }

  const after = await captureScreenshots(currentAppUrl, routes, afterDir, targetSelectors);

  const comparisons = [];
  for (let i = 0; i < before.shots.length; i++) {
    const b = before.shots[i];
    const a = after.shots[i];
    if (!b.file || !a.file) {
      comparisons.push({ route: b.route, error: 'screenshot missing' });
      continue;
    }
    const diff = compareImages(b.file, a.file, join(afterDir, `${routeHash(b.route)}-diff.png`));
    comparisons.push({
      route: b.route,
      before: b.file,
      after: a.file,
      diffFile: diff?.diffFile || null,
      diffRatio: diff ? +diff.diffRatio.toFixed(5) : null
    });
  }

  const layoutShifts = checkLayoutShift(before.shots, after.shots);

  const maxDiff = Math.max(...comparisons.map(c => c.diffRatio ?? 0), 0);
  const passed = layoutShifts.length === 0 && maxDiff < parseFloat(process.env.VISUAL_DIFF_FAIL || '0.03');

  return {
    status: passed ? 'passed' : 'failed',
    comparisons,
    layoutShifts,
    summary: {
      maxDiffRatio: +maxDiff.toFixed(5),
      layoutShiftCount: layoutShifts.length,
      thresholds: {
        failDiff: parseFloat(process.env.VISUAL_DIFF_FAIL || '0.03'),
        layoutShiftPx: LAYOUT_SHIFT_PX
      }
    }
  };
}
