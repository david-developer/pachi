import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { marketplaceFixture, privateAddressCanary, testListing } from './fixtures/marketplace';

const forest = 'rgb(14, 59, 46)';
const ivory = 'rgb(248, 246, 238)';
const routes = [['homepage', '/'], ['results', '/listings'], ['detail', `/listings/${testListing.id}`]] as const;

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = true) {
  const images = page.locator('img');
  for (let index = 0; index < await images.count(); index++) await images.nth(index).scrollIntoViewIfNeeded();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => undefined)));
    window.scrollTo(0, 0);
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  await expect(page.locator('body')).not.toContainText(privateAddressCanary);
  const directory = process.env.PACHI_OWNER_BRAND_EVIDENCE_DIR;
  if (directory) mkdirSync(directory, { recursive: true });
  const path = directory ? join(directory, `${name}.png`) : testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function assertReadableControl(control: Locator) {
  const bounds = await control.boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(44);
  expect(bounds?.height).toBeGreaterThanOrEqual(44);
  const contrast = await control.evaluate(element => {
    const style = getComputedStyle(element);
    const channels = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    const luminance = (value: string) => channels(value).map(channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
    const foreground = luminance(style.color), background = luminance(style.backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  expect(contrast).toBeGreaterThanOrEqual(4.5);
}

for (const width of [1440, 768, 390]) {
  test(`approved owner branding remains legible and functional at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    await marketplaceFixture(page);
    for (const [name, route] of routes) {
      await page.goto(route);
      if (name === 'detail') await expect(page.getByRole('heading', { name: testListing.title, exact: true })).toBeVisible();
      else await expect(page.locator('.listingCard').first()).toBeVisible();
      const logo = page.getByRole('link', { name: 'Pachi home', exact: true }).getByRole('img');
      await expect(logo).toHaveAttribute('src', '/brand/pachi-wordmark.svg');
      await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
      const ratio = await logo.evaluate(image => (image as HTMLImageElement).naturalWidth / (image as HTMLImageElement).naturalHeight);
      expect(ratio).toBeGreaterThan(3.5);
      expect(ratio).toBeLessThan(3.8);
      await expect(page.getByRole('heading', { level: 1 })).toHaveCSS('color', name === 'homepage' && width <= 599 ? ivory : forest);
      const canvas = await page.getByRole('main').evaluate(element => {
        for (let current: Element | null = element; current; current = current.parentElement) {
          const background = getComputedStyle(current).backgroundColor;
          if (background !== 'rgba(0, 0, 0, 0)' && background !== 'transparent') return background;
        }
        return null;
      });
      expect(canvas).toBe(ivory);
      const action = page.getByRole('button', { name: name === 'homepage' ? width <= 599 ? 'Find a home' : 'Search properties' : name === 'results' ? 'Apply filters' : 'Contact provider', exact: true });
      await expect(action).toHaveCSS('background-color', forest);
      await assertReadableControl(action);
      await action.focus();
      await expect(action).toBeFocused();
      const focus = await action.evaluate(element => {
        const style = getComputedStyle(element);
        return { outline: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth), shadow: style.boxShadow };
      });
      expect((focus.outline !== 'none' && focus.outlineWidth >= 2) || focus.shadow !== 'none').toBe(true);
      await action.blur();
      await capture(page, testInfo, `${name}-${width}`);
      if (name === 'detail' && width === 390) {
        await expect(action).toBeInViewport();
        await capture(page, testInfo, 'detail-390-viewport', false);
      }
    }
  });
}

test('approved owner SVG assets stay flat, scalable and geometrically consistent across variants', async ({ page, request }, testInfo) => {
  const assets = [
    '/brand/pachi-wordmark.svg', '/brand/pachi-wordmark-reversed.svg', '/brand/pachi-wordmark-monochrome.svg',
    '/brand/pachi-mark.svg', '/brand/pachi-mark-light.svg', '/brand/pachi-mark-monochrome.svg', '/brand/pachi-symbol.svg', '/icon.svg',
  ];
  const sources = new Map<string, string>();
  for (const asset of assets) {
    const response = await request.get(asset);
    expect(response.ok()).toBe(true);
    expect(response.headers()['content-type']).toContain('image/svg+xml');
    const svg = await response.text();
    expect(svg).toMatch(/<svg\b/);
    expect(svg).toMatch(/\bviewBox=/);
    expect(svg).toMatch(/<path\b/);
    expect(svg).not.toMatch(/<(?:image|text|filter|linearGradient|radialGradient)\b|\b(?:href|src)=["']https?:|data:image/i);
    expect(svg).not.toMatch(/#(?:142D30|08665B|BE7651|F6F8F6|E6EEEA)\b/i);
    if (asset.includes('wordmark')) expect(svg).not.toMatch(/<rect\b/);
    sources.set(asset, svg);
  }
  expect(sources.get('/brand/pachi-wordmark.svg')).toMatch(/#0E3B2E/i);
  expect(sources.get('/brand/pachi-wordmark.svg')).toMatch(/#C47F56/i);
  expect(sources.get('/brand/pachi-wordmark-reversed.svg')).toMatch(/#F8F6EE/i);
  expect(sources.get('/brand/pachi-wordmark-monochrome.svg')).not.toMatch(/#C47F56/i);
  const geometry = async (svg: string) => page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, 'image/svg+xml');
    return Array.from(document.querySelectorAll('path')).map(path => path.getAttribute('d'));
  }, svg);
  const primary = await geometry(sources.get('/brand/pachi-wordmark.svg')!);
  expect(await geometry(sources.get('/brand/pachi-wordmark-reversed.svg')!)).toEqual(primary);
  expect(await geometry(sources.get('/brand/pachi-wordmark-monochrome.svg')!)).toEqual(primary);
  const icon = await geometry(sources.get('/brand/pachi-mark.svg')!);
  expect(await geometry(sources.get('/icon.svg')!)).toEqual(icon);
  expect(await geometry(sources.get('/brand/pachi-mark-light.svg')!)).toEqual(icon);
  expect(await geometry(sources.get('/brand/pachi-mark-monochrome.svg')!)).toEqual(icon);
  expect(await geometry(sources.get('/brand/pachi-symbol.svg')!)).toEqual(icon);
  expect(await geometry(readFileSync(join(process.cwd(), '../../docs/design/assets/pachi-app-icon.svg'), 'utf8'))).toEqual(icon);

  // CI always checks the product assets above. Only a local run with this
  // explicit directory renders the private owner JPEG comparison artifacts.
  const referenceDirectory = process.env.PACHI_BRAND_REFERENCES_DIR;
  if (!referenceDirectory) return;
  const references = [
    ['primary', '01-primary-wordmark-reference.jpeg'],
    ['icon', '02-app-icon-reference.jpeg'],
    ['reversed', '03-reversed-wordmark-reference.jpeg'],
  ] as const;
  const originalBytes = new Map(references.map(([id, file]) => [id, readFileSync(join(referenceDirectory, file))]));
  await page.route('**/__test__/approved-owner-reference/*', route => {
    const id = new URL(route.request().url()).pathname.split('/').at(-1) as typeof references[number][0];
    const body = originalBytes.get(id);
    return body ? route.fulfill({ contentType: 'image/jpeg', body }) : route.fulfill({ status: 404, body: '' });
  });
  await marketplaceFixture(page);
  await page.goto('/');
  const origin = new URL(page.url()).origin;
  const baseStyle = '*{box-sizing:border-box}body{margin:0;padding:24px;background:#F8F6EE;color:#0E3B2E;font:15px/1.5 system-ui}h1{font-size:24px;margin:0 0 8px}h2{font-size:18px;margin:0 0 12px}p{margin:0 0 18px}.columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.panel{padding:20px;border:1px solid #9BAF9F;background:#fff;margin-top:24px}.fullReference{display:block;width:632px;height:auto;max-width:100%}.crop{position:relative;overflow:hidden;flex:none}.crop img{position:absolute;max-width:none}.pair{display:flex;gap:24px;align-items:start;flex-wrap:wrap}.label{display:block;font-size:13px;margin-bottom:8px}.vector{display:block;max-width:100%;height:auto}.forest{background:#0E3B2E;color:#F8F6EE}';
  for (const [id, label, asset] of [
    ['primary', 'Primary wordmark', '/brand/pachi-wordmark.svg'],
    ['reversed', 'Reversed wordmark', '/brand/pachi-wordmark-reversed.svg'],
  ] as const) {
    await page.setViewportSize({ width: 1640, height: 1100 });
    await page.setContent(`<html lang="en"><head><title>TEST owner ${label} comparison</title><style>${baseStyle}</style></head><body><h1>Owner-approved ${label} · actual JPEG versus flat SVG</h1><p>Exact unmodified original JPEG below. Texture, relief and lighting belong to the reference presentation; the SVG is flat transparent geometry. Equivalent comparison windows use original image coordinates x256,y316,width752,height208.</p><section class="panel"><h2>Actual full original JPEG · unchanged bytes</h2><img class="fullReference" src="${origin}/__test__/approved-owner-reference/${id}" alt="Exact owner ${label} reference"></section><section class="panel ${id === 'reversed' ? 'forest' : ''}"><div class="columns"><div><h2>Actual JPEG · equivalent-scale ink window</h2><div class="crop" style="width:752px;height:208px"><img src="${origin}/__test__/approved-owner-reference/${id}" width="1264" height="843" style="width:1264px;height:843px;left:-256px;top:-316px" alt="CSS viewport of original owner ${label}"></div></div><div><h2>Rendered production SVG · same752×208 window</h2><img class="vector" src="${origin}${asset}" width="752" height="208" alt="Rendered production ${label}"></div></div></section><section class="panel ${id === 'reversed' ? 'forest' : ''}"><h2>Actual desktop148px / mobile117px rendered sizes</h2><div class="pair"><img class="vector" src="${origin}${asset}" width="148" alt="Production ${label} at148px"><img class="vector" src="${origin}${asset}" width="117" alt="Production ${label} at117px"></div></section></body></html>`);
    const images = page.locator('img');
    for (let index = 0; index < await images.count(); index++) await expect.poll(() => images.nth(index).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await capture(page, testInfo, `owner-${id}-reference-vs-svg`);
  }
  const iconSizes = [16, 32, 48, 160];
  await page.setViewportSize({ width: 1440, height: 1100 });
  const samples = iconSizes.map(size => `<div><h2>${size}px · actual tile versus SVG</h2><div class="pair"><div><span class="label">Original tile · CSS crop</span><div class="crop" style="width:${size}px;height:${size}px"><img src="${origin}/__test__/approved-owner-reference/icon" style="width:${1264 * size / 588}px;height:${843 * size / 590}px;left:${-338 * size / 588}px;top:${-130 * size / 590}px" alt="Owner icon tile at${size}px"></div></div><div><span class="label">Production SVG</span><img class="vector" src="${origin}/brand/pachi-mark.svg" width="${size}" height="${size}" alt="Production app icon at${size}px"></div></div></div>`).join('');
  await page.setContent(`<html lang="en"><head><title>TEST owner icon comparison</title><style>${baseStyle}.sizes{display:flex;gap:48px;flex-wrap:wrap}</style></head><body><h1>Owner-approved app icon · actual JPEG versus flat SVG</h1><p>The full JPEG remains unchanged. Tile comparisons use a CSS viewport at originalx338,y130,width588,height590. Master wordmark and icon follow their respective approved optical apertures; favicon and app icon share icon geometry.</p><section class="panel"><h2>Actual full original JPEG · unchanged bytes</h2><img class="fullReference" src="${origin}/__test__/approved-owner-reference/icon" alt="Exact original owner app icon reference"></section><section class="panel"><div class="sizes">${samples}</div></section></body></html>`);
  const iconImages = page.locator('img');
  for (let index = 0; index < await iconImages.count(); index++) await expect.poll(() => iconImages.nth(index).evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await capture(page, testInfo, 'owner-icon-reference-vs-svg');
});
