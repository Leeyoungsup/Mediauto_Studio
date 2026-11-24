import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

export function demoEvidence(name) {
  const directory = process.env.MEDIAUTO_WORKFLOW_EVIDENCE_DIR;
  const pages = [];
  const started = performance.now();

  return {
    async observe(page, role) {
      if (!directory) return;
      const metrics = {
        role, uiActions: 0, screenTransitions: 0, retryActions: 0,
        http4xx: 0, http5xx: 0, pageErrors: 0,
      };
      const opened = performance.now();
      let closed;
      let firstAction;
      let lastAction;
      page.once('close', () => { closed = performance.now(); });
      let previousRoute;
      page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame()) return;
        const url = new URL(frame.url());
        const route = url.pathname + url.hash;
        if (previousRoute && route !== previousRoute) metrics.screenTransitions++;
        previousRoute = route;
      });
      page.on('response', (response) => {
        if (!new URL(response.url()).pathname.startsWith('/api/')) return;
        if (response.status() >= 500) metrics.http5xx++;
        else if (response.status() >= 400) metrics.http4xx++;
      });
      page.on('pageerror', () => metrics.pageErrors++);
      await page.exposeBinding('recordDemoAction', (_, retry) => {
        lastAction = performance.now();
        firstAction ??= lastAction;
        metrics.uiActions++;
        if (retry) metrics.retryActions++;
      });
      await page.addInitScript(() => {
        document.addEventListener('click', ({ target }) => {
          const control = target.closest?.('button, a, summary, [role="button"]');
          if (control || target.matches?.('canvas, input[type="checkbox"], input[type="radio"]')) {
            void window.recordDemoAction(/^retry\b/i.test(control?.textContent.trim() ?? ''));
          }
        }, true);
        document.addEventListener('change', ({ target }) => {
          if (target.matches?.('select, textarea, input:not([type="checkbox"]):not([type="radio"])')) {
            void window.recordDemoAction(false);
          }
        }, true);
      });
      pages.push(() => ({
        ...metrics,
        interactionSpanMs: firstAction === undefined ? 0 : Math.round(lastAction - firstAction),
        elapsedMs: Math.round((closed ?? performance.now()) - opened),
      }));
    },
    async capture(locator, label) {
      if (!directory) return;
      await mkdir(directory, { recursive: true });
      await locator.screenshot({ path: join(directory, name + '-' + label + '.png'), animations: 'disabled' });
    },
    async finish() {
      if (!directory) return;
      const ended = performance.now();
      const roles = pages.map((summarize) => summarize());
      assert.ok(roles.every(({ pageErrors }) => pageErrors === 0), 'Unexpected browser JavaScript error');
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, name + '.json'), JSON.stringify({
        scenario: name, result: 'PASS', elapsedMs: Math.round(ended - started), roles,
      }, null, 2) + '\n');
    },
  };
}
