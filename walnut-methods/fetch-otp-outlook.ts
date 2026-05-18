import type { WalnutContext, WalnutWebContext } from './walnut';

/** @walnut_method
 * name: Fetch OTP from Outlook Latest Mail
 * description: Open latest unread mail in Outlook and store OTP in $[otp]
 * actionType: custom_fetch_otp_outlook
 * context: web
 * needsLocator: false
 * category: Authentication
 */
export async function fetchOtpOutlook(ctx: WalnutContext) {
  if (ctx.platform !== 'web') throw new Error('fetchOtpOutlook requires web context');

  const webCtx = ctx as WalnutWebContext;
  const page = webCtx.page;

  // args[0] = output variable name from $[otp] in the description
  const outputVar: string = ctx.args[0];

  // ── OTP extraction patterns (all common formats, ordered by specificity) ──
  // NOTE: Use (?<!\d) / (?!\d) instead of \b so digits adjacent to letters
  // still match — e.g. "Your OTP710165Valid" → captures "710165".
  const OTP_PATTERNS: RegExp[] = [
    /otp[:\s#-]*([0-9]{4,8})(?!\d)/i,            // "OTP: 123456" or "OTP710165"
    /code[:\s#-]*([0-9]{4,8})(?!\d)/i,           // "code: 123456"
    /verification[:\s#-]*([0-9]{4,8})(?!\d)/i,   // "verification code: 123456"
    /passcode[:\s#-]*([0-9]{4,8})(?!\d)/i,       // "passcode: 1234"
    /pin[:\s#-]*([0-9]{4,8})(?!\d)/i,            // "PIN: 1234"
    /token[:\s#-]*([A-Z0-9]{4,8})(?![A-Z0-9])/i,// "token: ABC123"
    /(?<!\d)([0-9]{6})(?!\d)/,                   // any standalone 6-digit
    /(?<!\d)([0-9]{8})(?!\d)/,                   // any standalone 8-digit
    /(?<!\d)([0-9]{4})(?!\d)/,                   // any standalone 4-digit
    /(?<!\d)([0-9]{5})(?!\d)/,                   // any standalone 5-digit
    /(?<!\d)([0-9]{7})(?!\d)/,                   // any standalone 7-digit
  ];

  const extractOtp = (text: string): string | null => {
    for (const pattern of OTP_PATTERNS) {
      const match = text.match(pattern);
      if (match?.[1]) {
        ctx.log(`[OTP] Matched pattern /${pattern.source}/ → "${match[1]}"`);
        return match[1];
      }
    }
    return null;
  };

  // ── 1. Wait for the mail list to be present (user already on Outlook) ─────
  ctx.log('[OTP] Waiting for Outlook mail list…');

  const mailListSelectors = [
    '[role="list"][aria-label*="Mail"]',
    '[role="list"][aria-label*="mail"]',
    '[role="listbox"]',
    'div[data-testid="MailList"]',
    '[aria-label*="Inbox"]',
    '[aria-label*="Message list"]',
  ];

  let mailListFound = false;
  for (const sel of mailListSelectors) {
    try {
      const visible = await webCtx.isVisible(sel);
      if (visible) {
        ctx.log(`[OTP] Mail list found: ${sel}`);
        mailListFound = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!mailListFound) {
    ctx.log('[OTP] Mail list selector not matched — proceeding anyway');
  }

  // ── 2. Click the first (latest) mail row ──────────────────────────────────
  ctx.log('[OTP] Clicking the first mail in the list…');

  // Try ctx.click() with common Outlook mail-row selectors
  const firstMailSelectors = [
    '[role="option"]:first-child',
    '[role="listitem"]:first-child',
    'div[data-convid]:first-child',
    'div[data-itemid]:first-child',
  ];

  let clicked = false;
  for (const sel of firstMailSelectors) {
    try {
      const count = await webCtx.count(sel);
      if (count > 0) {
        ctx.log(`[OTP] Clicking first mail: ${sel}`);
        await webCtx.click(sel);
        clicked = true;
        break;
      }
    } catch { /* try next */ }
  }

  if (!clicked) {
    // Playwright fallback — first() avoids the "expected string, got object" issue
    ctx.log('[OTP] Fallback: using page.locator().first().click()');
    const rows = page.locator('[role="option"], [role="listitem"], div[data-convid], div[data-itemid]');
    const rowCount: number = await rows.count();
    if (rowCount === 0) throw new Error('[OTP] No mail rows found. Make sure Outlook inbox is open.');
    await rows.first().click();
  }

  // ── 3. Wait for reading pane to render ────────────────────────────────────
  await webCtx.wait(2000);

  // ── 4. Extract body text from the reading pane ────────────────────────────
  const readingPaneSelectors = [
    'div[aria-label*="Message body"]',
    'div[aria-label*="message body"]',
    '[data-testid="ReadingPane"]',
    '[role="main"] [role="region"]',
    'div[class*="ReadingPane"]',
    '[role="document"]',
  ];

  let bodyText = '';

  for (const sel of readingPaneSelectors) {
    try {
      const visible = await webCtx.isVisible(sel);
      if (visible) {
        bodyText = await webCtx.getText(sel);
        if (bodyText.trim().length > 0) {
          ctx.log(`[OTP] Reading pane captured (${bodyText.length} chars) via: ${sel}`);
          break;
        }
      }
    } catch { /* try next */ }
  }

  // ── 5. Fallback: full page innerText ──────────────────────────────────────
  if (!bodyText || bodyText.trim().length === 0) {
    ctx.log('[OTP] Fallback: reading full page innerText');
    bodyText = await page.evaluate(() => document.body.innerText) as string;
  }

  ctx.log(`[OTP] Body preview: "${bodyText.substring(0, 200).replace(/\n/g, ' ')}"`);

  // ── 6. Extract OTP ────────────────────────────────────────────────────────
  const otp = extractOtp(bodyText);
  if (!otp) {
    throw new Error(
      `[OTP] No OTP found in mail body. Preview: "${bodyText.substring(0, 300)}"`
    );
  }

  ctx.log(`[OTP] OTP extracted: "${otp}" → stored in $[${outputVar}]`);
  ctx.setVariable(outputVar, otp);
}
