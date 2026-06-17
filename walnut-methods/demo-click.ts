import type { WalnutContext } from './walnut';

/** @walnut_method
 * name: Click Element
 * description: Click on element ${selector}
 * actionType: custom_click_element
 * context: web
 * needsLocator: false
 * category: Interaction
 */
export async function clickElement(ctx: WalnutContext) {
  // ctx.args[0] = resolved value of ${selector}
  const selector = ctx.args[0];

  ctx.log('Waiting for element: ' + selector);
  await ctx.waitForVisible(selector);

  ctx.log('Clicking element: ' + selector);
  await ctx.click(selector);
}
