import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import dotenv from 'dotenv';

dotenv.config();

const ROUTES = (process.env.ROUTES || '/,/contact,/products').split(',').map(r => r.trim());

export async function scanRoutes(appUrl, routes = ROUTES) {
  // Normalize: appUrl may be a string or an object like { url, port, framework }
  const baseUrl = typeof appUrl === 'string' ? appUrl : appUrl?.url;
  if (!baseUrl) {
    throw new Error('scanRoutes: appUrl is missing — the app did not start');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const findings = [];

  for (const route of routes) {
    const trimmedBase = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    const url = route.startsWith('http') ? route : `${trimmedBase}${route}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(1000); // let dynamic content settle

      const accessibilityScanResults = await new AxeBuilder({ page }).analyze();

      for (const violation of accessibilityScanResults.violations) {
        for (const node of violation.nodes) {
          findings.push({
            issueId: `issue_${violation.id}_${node.html.slice(0, 20).replace(/[^a-zA-Z0-9]/g, '_')}`,
            ruleId: violation.id,
            description: violation.description,
            impact: violation.impact,
            wcagTags: violation.tags.filter(t => t.startsWith('wcag')),
            page: url,
            htmlSnippet: node.html,
            target: node.target,
            helpUrl: violation.helpUrl
          });
        }
      }
    } catch (err) {
      console.error(`Error scanning ${url}:`, err.message);
    }
  }

  await browser.close();
  return findings;
}

export async function scanDemoApp(appUrl, routes) {
  return scanRoutes(appUrl, routes);
}
