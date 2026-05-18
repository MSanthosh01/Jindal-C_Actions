import type { WalnutContext, WalnutWebContext } from './walnut';
import * as https from 'https';

import FormData from 'form-data';

/** @walnut_method
 * name: Solve CAPTCHA via DBC
 * description: Read CAPTCHA from element and store solved text in $[captchaValue]
 * actionType: custom_solve_captcha_dbc
 * context: web
 * needsLocator: true
 * category: Authentication
 */
export async function solveCaptchaDbc(ctx: WalnutContext) {
  if (ctx.platform !== 'web') throw new Error('solveCaptchaDbc requires web context');

  const webCtx  = ctx as WalnutWebContext;
  const locator: string = (ctx as any).locator;
  if (!locator) throw new Error('[CAPTCHA] No locator attached to this step');

  // args[0] = output variable name from $[captchaValue] in the description
  const outputVar: string = ctx.args[0];

  // Credentials from test data params — never hardcoded in the description
  const username: string = (ctx as any).params?.dbcUsername;
  const password: string = (ctx as any).params?.dbcPassword;
  if (!username || !password) {
    throw new Error('[CAPTCHA] Test data must include dbcUsername and dbcPassword');
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ── 1. Read element image as base64 ─────────────────────────────────────
  ctx.log(`[CAPTCHA] Locator: ${locator}`);
  const element = webCtx.page.locator(locator);
  await element.waitFor({ state: 'visible', timeout: 8000 });

  // Detect tag — canvas uses toDataURL (no disk I/O), anything else screenshots
  const tagName: string = await element.evaluate((el: Element) => el.tagName.toLowerCase());
  let base64: string | null = null;

  if (tagName === 'canvas') {
    base64 = await element.evaluate((el: Element) => {
      const dataUrl = (el as HTMLCanvasElement).toDataURL('image/png');
      return dataUrl.split(',')[1] ?? null;
    });
    ctx.log(`[CAPTCHA] canvas.toDataURL() → ${base64?.length ?? 0} chars`);
  }

  if (!base64) {
    const buf = Buffer.from(await element.screenshot({ type: 'png' }));
    base64 = buf.toString('base64');
    ctx.log(`[CAPTCHA] element.screenshot() → ${buf.length} bytes (tag: ${tagName})`);
  }

  // ── 2. Upload to DBC — field: captchafile with base64: prefix ───────────
  const uploadResp = await new Promise<Record<string, unknown> | null>((resolve) => {
    const form = new FormData();
    form.append('username', username);
    form.append('password', password);
    form.append('captchafile', `base64:${base64}`);

    form.submit(
      {
        hostname: 'api.dbcapi.me',
        path: '/api/captcha',
        method: 'POST',
        headers: { ...form.getHeaders(), Accept: 'application/json' },
      },
      (err: Error | null, res: import('http').IncomingMessage) => {
        if (err) {
          ctx.warn(`[CAPTCHA] Upload error: ${err.message}`);
          return resolve(null);
        }
        let raw = '';
        res.on('data', (c: string) => (raw += c));
        res.on('end', () => {
          try { resolve(JSON.parse(raw)); }
          catch { ctx.warn(`[CAPTCHA] Upload non-JSON: ${raw.substring(0, 150)}`); resolve(null); }
        });
      }
    );
  });

  const captchaId = uploadResp?.['captcha'] as string | undefined;
  if (!captchaId) {
    throw new Error(`[CAPTCHA] Upload failed: ${JSON.stringify(uploadResp)}`);
  }
  ctx.log(`[CAPTCHA] Uploaded — ID: ${captchaId}`);

  // ── 3. Poll every 500 ms until solved (max 30 s) ─────────────────────────
  const poll = (id: string): Promise<Record<string, unknown>> =>
    new Promise((resolve, reject) => {
      https.get(
        { hostname: 'api.dbcapi.me', path: `/api/captcha/${id}`, headers: { Accept: 'application/json' } },
        (res) => {
          let raw = '';
          res.on('data', (c) => (raw += c));
          res.on('end', () => {
            try { resolve(JSON.parse(raw)); }
            catch { reject(new Error(`Poll non-JSON: ${raw.substring(0, 150)}`)); }
          });
        }
      ).on('error', reject);
    });

  const deadline = Date.now() + 30_000;
  let attempt = 0;

  while (Date.now() < deadline) {
    await sleep(500);
    attempt++;

    let pollResp: Record<string, unknown>;
    try {
      pollResp = await poll(captchaId);
    } catch (err) {
      ctx.warn(`[CAPTCHA] Poll #${attempt} error: ${(err as Error).message}`);
      continue;
    }

    const text      = pollResp['text'] as string | undefined;
    const isCorrect = pollResp['is_correct'];

    if (text && String(isCorrect) !== '0') {
      const elapsed = ((Date.now() - (deadline - 30_000)) / 1000).toFixed(1);
      ctx.log(`[CAPTCHA] Solved in ~${elapsed}s: "${text}"`);
      ctx.setVariable(outputVar, text);
      return;
    }
  }

  throw new Error('[CAPTCHA] Timed out after 30 s — DBC did not return a result');
}
