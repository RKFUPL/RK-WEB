import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const queries: string[] = [];
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/catalog/products/synthetic-search') return route.fulfill({ json: { product: {
      id: 'synthetic-search', name: 'Synthetic search piece', price: 1000, currency: 'INR', availability: 'in_stock', media: [],
      attributes: {}, variants: [{ id: 'ivory', sku: 'SEARCH-IVORY', colour: 'IVORY', status: 'active', price: 1000, sizes: ['S'], images: [] }],
    }, collections: [] } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/catalog/collections', route => route.fulfill({ json: { collections: [
    { id: 'hastakala', name: 'Hastakala', slug: 'collections-of-hastakala', description: 'Craft-led pieces' },
    { id: 'aakaar', name: 'AAKAAR', slug: 'aakaar', description: 'Couture' },
  ] } }));
  await page.route('**/api/catalog/products?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    queries.push(query);
    if (query === 'error') return route.fulfill({ status: 503, json: {} });
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 800));
    const found = /ruhani|ck184|hk-ck184-red|hastakala/i.test(query);
    try { await route.fulfill({ json: { products: found ? [{ id: 'ruhani', name: 'RUHANI', productCode: 'CK184', media: ['/synthetic-search.svg'], collections: [{ name: 'Hastakala', slug: 'collections-of-hastakala' }] }] : query === 'slow' ? [{ id: 'old', name: 'Obsolete piece', media: [] }] : [] } }); } catch { /* Aborted obsolete request. */ }
  });
  await page.route('**/synthetic-search.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="72"><rect width="56" height="72" fill="#c8b8a0"/></svg>' }));
  return queries;
}
const input = (page: Page) => page.getByRole('textbox', { name: 'Search products, collections, and pages' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search the house' });
async function open(page: Page) { await page.getByRole('button', { name: 'Search', exact: true }).click(); await expect(input(page)).toBeFocused(); }

for (const route of ['/', '/collections', '/products/synthetic-search']) {
  test(`viewport portal and lifecycle from ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await fixture(page);
    await page.goto(route);
    await page.evaluate(() => { document.body.style.overflow = 'auto'; });
    const trigger = page.getByRole('button', { name: 'Search', exact: true });
    await open(page);
    expect(await dialog(page).evaluate(el => el.closest('header'))).toBeNull();
    expect(await page.locator('[data-search-overlay]').evaluate(el => el.parentElement === document.body)).toBe(true);
    const bounds = (await page.locator('[data-search-overlay]').boundingBox())!;
    expect(bounds).toMatchObject({ x: 0, y: 0, width: 1440, height: 900 });
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await input(page).click(); await expect(dialog(page)).toBeVisible();
    await expect(dialog(page).getByRole('heading', { name: 'Popular Searches' })).toBeVisible();
    await page.keyboard.press('Shift+Tab');
    await expect(dialog(page).getByRole('button', { name: 'Close search' })).toBeFocused();
    await dialog(page).getByRole('button').last().focus();
    await page.keyboard.press('Tab');
    await expect(dialog(page).getByRole('button', { name: 'Close search' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0); await expect(trigger).toBeFocused();
    await expect(page.locator('body')).toHaveCSS('overflow', 'auto');
    await open(page);
    await page.locator('[data-search-overlay]').click({ position: { x: 2, y: 2 } });
    await expect(dialog(page)).toHaveCount(0);
  });
}

test('live products, SKU, collection, pages and configured lookbooks are grouped', async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 }); const queries = await fixture(page);
  await page.goto('/about'); await open(page); expect(queries).toEqual([]);
  await dialog(page).getByRole('button', { name: 'Hastakala', exact: true }).click();
  await expect(dialog(page).getByRole('link', { name: /RUHANI.*CK184.*Hastakala/ })).toBeVisible();
  for (const name of ['Suggestions', 'Pages', 'Products']) await expect(dialog(page).getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('link', { name: 'Hastakala', exact: true })).toHaveAttribute('href', '/collections/collections-of-hastakala');
  await page.screenshot({ path: info.outputPath('search-desktop.png') });
  for (const query of ['RUHANI', 'HK-CK184-RED']) { await input(page).fill(query); await expect(dialog(page).getByRole('link', { name: /RUHANI.*CK184/ })).toBeVisible(); }
  await input(page).fill('About'); await expect(dialog(page).getByRole('link', { name: 'About Rashi Kapoor' })).toHaveAttribute('href', '/about');
  await input(page).fill('Lookbook'); await expect(dialog(page).getByRole('link', { name: 'All Lookbooks', exact: true })).toBeVisible();
  await input(page).fill('Contact'); await expect(dialog(page).getByRole('link', { name: 'Contact', exact: true })).toHaveAttribute('href', '/#footer');
  await dialog(page).getByRole('button', { name: 'Clear search query' }).click();
  await expect(input(page)).toBeFocused(); await expect(input(page)).toHaveValue('');
  await expect(dialog(page).getByRole('heading', { name: 'Popular Searches' })).toBeVisible();
  expect(queries).not.toContain('');
});

test('submit and Enter rerun query without navigation; results close and reset', async ({ page }) => {
  const queries = await fixture(page); await page.goto('/about'); await open(page);
  await input(page).fill('RUHANI'); await expect.poll(() => queries.length).toBe(1);
  await dialog(page).getByRole('button', { name: 'Submit search' }).click(); await expect.poll(() => queries.length).toBe(2);
  await input(page).press('Enter'); await expect.poll(() => queries.length).toBe(3);
  await expect(page).toHaveURL(/\/about$/); await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('link', { name: /RUHANI.*CK184/ }).click();
  await expect(page).toHaveURL(/\/products\/ruhani$/); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await open(page); await expect(input(page)).toHaveValue('');
});

test('errors differ from empty results and obsolete responses cannot replace current results', async ({ page }) => {
  const queries = await fixture(page); await page.goto('/about'); await open(page);
  await input(page).fill('unmatched-synthetic-928');
  await expect(dialog(page).getByText('No matching products, collections or pages found.')).toBeVisible();
  await input(page).fill('error'); await expect(dialog(page).getByRole('alert')).toContainText('Product search could not be loaded');
  await expect(dialog(page).getByText('No matching products, collections or pages found.')).toHaveCount(0);
  await input(page).fill('slow'); await expect.poll(() => queries.includes('slow')).toBe(true);
  await input(page).fill('RUHANI'); await expect(dialog(page).getByRole('link', { name: /RUHANI.*CK184/ })).toBeVisible();
  await page.waitForTimeout(900); await expect(dialog(page).getByText('Obsolete piece')).toHaveCount(0);
});

test('mobile menu opens same compact portal and retains scroll lock until menu closes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await page.goto('/about');
  await page.getByRole('button', { name: 'Open menu' }).click(); await open(page);
  await input(page).fill('RUHANI'); await expect(dialog(page).getByRole('link', { name: /RUHANI.*CK184/ })).toBeVisible();
  expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('search-mobile.png') });
  await page.keyboard.press('Escape'); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
  await page.getByRole('button', { name: 'Close menu' }).click(); await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});


test('collection failure remains an error and clearing cancels obsolete search', async ({ page }) => {
  const queries = await fixture(page);
  await page.route('**/api/catalog/collections', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/about'); await open(page); await input(page).fill('slow');
  await expect(dialog(page).getByRole('alert')).toContainText('Collections could not be loaded');
  await expect.poll(() => queries.includes('slow')).toBe(true);
  await dialog(page).getByRole('button', { name: 'Clear search query' }).click();
  await page.waitForTimeout(900);
  await expect(dialog(page).getByRole('heading', { name: 'Popular Searches' })).toBeVisible();
  await expect(dialog(page).getByText('Obsolete piece')).toHaveCount(0);
  await expect(dialog(page).getByText('No matching products, collections or pages found.')).toHaveCount(0);
});
