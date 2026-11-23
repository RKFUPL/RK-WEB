import { expect, test, type Page } from '@playwright/test';

const variant = (id: string, colour: string, price: number, status = 'active') => ({
  id, colour, sku: `RK-${id}`, status, price, currency: 'INR',
  images: [`/test-${id}.svg`], sizes: [id === 'ivory' ? 'S' : 'M'],
  sizeInventory: [{ size: id === 'ivory' ? 'S' : 'M', stock: 2 }],
});
const product = {
  id: 'swatch-test', name: 'Swatch test piece', styleCode: 'STYLE-01',
  availability: 'in_stock', currency: 'INR', price: 10000, media: [],
  shortDescription: 'Embroidered couture lehenga',
  description: 'Original product description', customSizeConfig: { enabled: false },
  attributes: { material: 'Silk', customizationInformation: 'Hand embroidered', components: '2 (Blouse, Lehenga)', fit: 'Fitted at bust', composition: 'Silk, Cotton satin', care: 'Dry clean only', disclaimer: 'Handcrafted variations are part of this piece.' },
  variants: [variant('ivory', 'IVORY', 10000), variant('blue', 'BLUE', 12000),
    variant('pattern', 'COMPLEX PATTERN', 13000), variant('red', 'RED', 14000, 'inactive'),
    variant('removed', 'BLACK', 15000, 'remove')],
};

async function mockStorefront(page: Page, data: object = product) {
  // Every API is intercepted: these tests require no backend or database.
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/catalog/products/swatch-test') return route.fulfill({ json: { product: data, collections: [] } });
    if (path === '/api/storefront-settings') return route.fulfill({ json: { settings: { colourSwatches: { BLUE: '#123456' }, whatsappNumber: '918879597878' } } });
    return route.fulfill({ json: {} });
  });
  await page.route('**/*test-*.svg*', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"><rect width="400" height="500" fill="#ddd"/></svg>' }));
}

test('global search combines products and collections and opens the product detail', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const queries: string[] = [];
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/catalog/collections', route => route.fulfill({ json: { collections: [
    { id: 'hastakala-id', name: 'Hastakala', slug: 'collections-of-hastakala', description: 'Craft-led pieces' },
  ] } }));
  await page.route('**/api/catalog/products?*', route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    queries.push(query);
    const matches = ['hastakala', 'ruhani', 'ck184', 'hk-ck184-red'].includes(query.toLowerCase());
    return route.fulfill({ json: { products: matches ? [{
      id: 'ruhani-id', name: 'RUHANI', productCode: 'CK184', parentSku: 'HK-CK184',
      media: ['/search-product.svg'], collections: [{ id: 'hastakala-id', name: 'Hastakala', slug: 'collections-of-hastakala' }],
    }] : [] } });
  });
  await page.route('**/search-product.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="72"/>' }));
  await page.goto('/about');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search products, collections, and pages' });
  await expect(input).toBeVisible();
  expect(queries).toEqual([]);
  await input.fill('Hastakala');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Collections' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Hastakala', exact: true })).toHaveAttribute('href', '/collections/collections-of-hastakala');
  const productLink = page.getByRole('link', { name: /RUHANI.*CK184.*Hastakala/ });
  await expect(productLink).toHaveAttribute('href', '/products/ruhani-id');
  await expect(productLink.locator('img')).toHaveAttribute('src', '/search-product.svg');
  await input.fill('CK184');
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
  await productLink.click();
  await expect(page).toHaveURL(/\/products\/ruhani-id/);
  expect(queries.some(query => query.toLowerCase() === 'hastakala')).toBe(true);
  expect(queries.some(query => query.toLowerCase() === 'ck184')).toBe(true);
});

test('global search reports failures and ignores obsolete product responses', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const queries: string[] = [];
  await page.route('**/api/**', route => route.fulfill({ json: {} }));
  await page.route('**/api/catalog/collections', route => route.fulfill({ json: { collections: [] } }));
  await page.route('**/api/catalog/products?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    queries.push(query);
    if (query === 'fail') return route.fulfill({ status: 503, json: { error: 'Unavailable' } });
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 900));
    try {
      await route.fulfill({ json: { products: query === 'ruhani' ? [{ id: 'current', name: 'RUHANI', productCode: 'CK184', media: [] }] : query === 'slow' ? [{ id: 'obsolete', name: 'Old piece', media: [] }] : [] } });
    } catch { /* The obsolete request may have been aborted by the browser. */ }
  });
  await page.goto('/about');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Search products, collections, and pages' });
  await input.fill('no-match-9283');
  await expect(page.getByText('Searching products…')).toBeVisible();
  await expect(page.getByText('No matching products, collections or pages found.')).toBeVisible();
  await input.fill('!!!');
  await expect(page.getByText('No matching products, collections or pages found.')).toBeVisible();
  await input.fill('fail');
  await expect(page.getByText('Product search could not be loaded. Please try again.')).toBeVisible();
  await expect(page.getByText('No matching products, collections or pages found.')).toHaveCount(0);
  await input.fill('slow');
  await expect.poll(() => queries.includes('slow')).toBe(true);
  await input.fill('ruhani');
  await expect(page.getByRole('link', { name: /RUHANI.*CK184/ })).toBeVisible();
  await page.waitForTimeout(950);
  await expect(page.getByText('Old piece')).toHaveCount(0);
  await input.fill('');
  await expect(page.getByRole('heading', { name: 'Products' })).toHaveCount(0);
  expect(queries).not.toContain('');
});

for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
  test(`colour swatches preserve variant data and keyboard selection at ${viewport.width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockStorefront(page);
    await page.goto('/products/swatch-test');
    const group = page.getByRole('group', { name: 'Colour:' });
    await expect(group).toBeVisible();
    const buy = page.getByRole('button', { name: 'Buy now', exact: true });
    const add = page.getByRole('button', { name: 'Add to cart', exact: true });
    expect((await buy.boundingBox())!.y).toBe((await add.boundingBox())!.y);
    const ordered = [page.getByRole('heading', { name: product.name, exact: true }), page.getByText(product.shortDescription, { exact: true }), page.getByText('Style Code: STYLE-01', { exact: true }), page.getByText(product.description, { exact: true }), page.getByText('Material:', { exact: true }), page.getByText('Construction:', { exact: true })];
    for (let index = 1; index < ordered.length; index++) {
      expect((await ordered[index].boundingBox())!.y).toBeGreaterThan((await ordered[index - 1].boundingBox())!.y);
    }
    await page.screenshot({ path: testInfo.outputPath(`product-top-${viewport.width}.png`), fullPage: true });
    await expect(group.locator('select')).toHaveCount(0);
    await expect(group.getByRole('radio')).toHaveCount(4);
    const ivory = group.getByRole('radio', { name: 'IVORY', exact: true });
    const blue = group.getByRole('radio', { name: 'BLUE', exact: true });
    await expect(ivory).toBeChecked();
    const sku = page.getByText('SKU: RK-ivory', { exact: true });
    for (const label of ['Material:', 'Construction:', 'Colour:']) {
      const typography = await page.getByText(label, { exact: true }).evaluate(el => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.letterSpacing, s.color, s.textTransform, s.fontFamily, s.fontWeight];
      });
      expect(typography).toEqual(await sku.evaluate(el => {
        const s = getComputedStyle(el);
        return [s.fontSize, s.letterSpacing, s.color, s.textTransform, s.fontFamily, s.fontWeight];
      }));
    }
    await expect(blue.locator('..').locator('span')).toHaveCSS('background-color', 'rgb(18, 52, 86)');
    await expect(group.getByRole('radio', { name: 'COMPLEX PATTERN', exact: true }).locator('..').locator('span')).toHaveCSS('background-color', 'rgb(183, 170, 153)');
    const selectedRing = await ivory.locator('..').locator('span').evaluate(el => getComputedStyle(el).boxShadow);
    expect(selectedRing).not.toBe(await blue.locator('..').locator('span').evaluate(el => getComputedStyle(el).boxShadow));
    await page.getByRole('button', { name: 'S', exact: true }).click();
    await ivory.focus();
    await page.keyboard.press('ArrowRight');
    await expect(blue).toBeChecked();
    await expect(blue).toBeFocused();
    await expect(blue.locator('..').locator('span')).toHaveCSS('outline-style', 'solid');
    await expect(page).toHaveURL(/variant=blue/);
    await expect(page.getByText('SKU: RK-blue', { exact: true })).toBeVisible();
    await expect(page.getByText('Style Code: STYLE-01', { exact: true })).toBeVisible();
    await expect(page.getByText(/12,000/).first()).toBeVisible();
    await expect(page.locator('img[src*="test-blue"]').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'S', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'M', exact: true })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Add to cart', exact: true })).toBeEnabled();
    await group.getByRole('radio', { name: 'RED — Sold out', exact: true }).locator('..').click();
    await expect(page.getByRole('button', { name: 'Sold out', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'M, unavailable', exact: true })).toBeDisabled();
    await blue.locator('..').click();
    await expect(page.getByRole('button', { name: 'Add to cart', exact: true })).toBeEnabled();
    await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
    await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
    const popup = page.getByRole('dialog', { name: 'Please select a size.' });
    await expect(popup).toBeVisible();
    expect((await popup.boundingBox())!.width).toBeLessThan(viewport.width);
    await page.screenshot({ path: testInfo.outputPath(`size-prompt-${viewport.width}.png`) });
    await popup.getByRole('button', { name: 'M', exact: true }).click();
    await expect(popup).not.toBeVisible();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items[0])).toMatchObject({ variantId: 'blue', sku: 'RK-blue', price: 12000, size: 'M', colour: 'BLUE' });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items[0].quantity)).toBe(1);
    await expect(page.getByRole('button', { name: 'M', exact: true })).toHaveClass(/bg-gold/);
    const attributes = page.locator('dl[aria-label="Product attributes"]').getByRole('definition');
    await expect(attributes).toHaveText(['2 (Blouse, Lehenga)', 'Fitted at bust', 'Silk, Cotton satin', 'Dry clean only']);
    const shipping = page.locator('details').filter({ hasText: 'Shipping & Delivery' });
    await expect(shipping).toHaveAttribute('open', '');
    await shipping.locator('summary').click();
    await expect(shipping).not.toHaveAttribute('open');
    await shipping.locator('summary').click();
    await expect(shipping.getByRole('link', { name: 'Shipping & Returns' })).toHaveAttribute('href', '/shipping-returns');
    await expect(page.getByRole('region', { name: 'Disclaimer', exact: true })).toContainText(product.attributes.disclaimer);
    await expect(page.getByRole('region', { name: 'Product assistance' })).toContainText('Live Product Preview');
    const contact = page.getByRole('region', { name: 'Product assistance' }).getByRole('link', { name: 'Chat with us' });
    const href = new URL((await contact.getAttribute('href'))!);
    expect(href.hostname).toBe('wa.me');
    expect(href.searchParams.get('text')).toContain(product.name);
    expect(href.searchParams.get('text')).toContain('/products/swatch-test?variant=blue');
    await expect(contact).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`product-${viewport.width}.png`) });
    await page.getByRole('region', { name: 'Product assistance' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`product-services-${viewport.width}.png`) });
  });
}

test('single-colour, legacy and runway pages share the labels', async ({ page }) => {
  await mockStorefront(page, { ...product, variants: [product.variants[0]] });
  await page.goto('/runway/LFW/swatch-test');
  await expect(page.getByRole('radio', { name: 'IVORY', exact: true })).toBeChecked();
  await expect(page.getByText('Material:', { exact: true })).toBeVisible();
  await mockStorefront(page, { ...product, variants: [], attributes: { ...product.attributes, color: 'IVORY' } });
  await page.goto('/products/swatch-test');
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByText('Colour:', { exact: true })).toBeVisible();
  await expect(page.getByText('Colour:', { exact: true }).locator('..')).toContainText('IVORY');
});

test('Buy Now resumes exactly once after size selection and opens existing checkout', async ({ page }) => {
  await mockStorefront(page);
  await page.goto('/products/swatch-test');
  await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
  await page.getByRole('button', { name: 'Buy now', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Please select a size.' });
  await expect(popup).toBeVisible();
  await popup.getByRole('button', { name: 'S', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items)).toMatchObject([{ variantId: 'ivory', size: 'S', quantity: 1 }]);
});

test('size prompt supports Escape and custom measurements with one cart continuation', async ({ page }) => {
  await mockStorefront(page, { ...product, customSizeConfig: { enabled: true, fields: ['Bust'] } });
  await page.goto('/products/swatch-test');
  await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
  const cart = page.getByRole('button', { name: 'Add to cart', exact: true });
  await cart.click();
  const popup = page.getByRole('dialog', { name: 'Please select a size.' });
  await page.keyboard.press('Escape');
  await expect(popup).not.toBeVisible();
  await expect(cart).toBeFocused();
  expect(await page.evaluate(() => localStorage.getItem('rk_shopping_bag'))).toBeNull();
  await cart.click();
  await popup.getByRole('button', { name: 'Custom size', exact: true }).click();
  const custom = page.getByRole('dialog', { name: 'Enter custom measurements' });
  await expect(custom).toBeVisible();
  await expect(custom.getByRole('button', { name: 'Close custom measurements' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(custom.getByRole('button', { name: 'Use these measurements' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(custom.getByRole('button', { name: 'Close custom measurements' })).toBeFocused();
  await custom.getByLabel('Bust', { exact: true }).fill('90');
  await custom.getByRole('button', { name: 'Use these measurements' }).click();
  await expect(custom).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items)).toMatchObject([{ quantity: 1, purchaseMode: 'custom_size', customSize: { measurements: { Bust: '90' } } }]);
  await expect(page.locator('summary')).toContainText('Made-to-Order');
});

test('no-size products skip the prompt, absent optional data stays hidden, and saved WhatsApp config is used', async ({ page }) => {
  await mockStorefront(page, { ...product, attributes: {}, variants: [{ ...product.variants[0], sizes: [], sizeInventory: [] }] });
  await page.route('**/api/storefront-settings', route => route.fulfill({ json: { settings: { whatsappNumber: '+91 90000 00000' } } }));
  await page.goto('/products/swatch-test');
  await expect(page.locator('dl[aria-label="Product attributes"]').getByRole('definition')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Disclaimer', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Product assistance' }).getByRole('link')).toHaveAttribute('href', /wa.me\/919000000000/);
  await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
  await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items[0].quantity)).toBe(1);
});

test('admin creates and edits optional attributes through the existing API and storefront renders read-back data', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'mock-admin-token'));
  let saved: typeof product | null = null;
  const writes: Record<string, unknown>[] = [];
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (path === '/api/staff/resources/products' && route.request().method() === 'POST') {
      const body = route.request().postDataJSON(); writes.push(body);
      saved = { ...product, ...body, id: 'created', variants: [], media: [] };
      return route.fulfill({ json: { item: saved } });
    }
    if (path === '/api/staff/resources/products/created' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON(); writes.push(body);
      saved = { ...saved!, ...body };
      return route.fulfill({ json: { item: saved } });
    }
    if (path === '/api/staff/collections/test') return route.fulfill({ json: { collection: { id: 'collection', name: 'Test collection', slug: 'test', status: 'published', products: saved ? [saved] : [] }, allCollections: [], availableProducts: [], permissions: ['products:manage'] } });
    if (path === '/api/catalog/products/created') return route.fulfill({ json: { product: saved, collections: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/products/test');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  let editor = page.getByRole('dialog');
  await editor.getByLabel('Product name', { exact: true }).fill('Admin couture test');
  await editor.getByLabel('Style code / SKU', { exact: true }).fill('TEST-01');
  await editor.getByRole('tab', { name: 'Details', exact: true }).click();
  const values = { Components: '2 (Blouse, Lehenga)', Fit: 'Relaxed fit', Composition: 'Pure silk', Care: 'Dry clean only' };
  for (const [label, value] of Object.entries(values)) await editor.getByLabel(`${label} (optional)`, { exact: true }).fill(value);
  await editor.getByRole('textbox', { name: 'Disclaimer (optional)', exact: true }).fill('Created disclaimer.\nSecond line.');
  await editor.getByRole('tab', { name: 'Pricing & inventory', exact: true }).click();
  await editor.getByLabel('Base INR price', { exact: true }).fill('500');
  await editor.getByRole('button', { name: 'Create product', exact: true }).click();
  await expect(page.getByText('Product created, assigned, and verified.', { exact: true })).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0].attributes).toMatchObject({ components: values.Components, fit: values.Fit, composition: values.Composition, care: values.Care });
  expect(writes[0].attributes).toMatchObject({ disclaimer: 'Created disclaimer.\nSecond line.' });
  editor = page.getByRole('dialog');
  await editor.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(editor.getByLabel('Components (optional)', { exact: true })).toHaveValue(values.Components);
  await editor.getByLabel('Care (optional)', { exact: true }).fill('Specialist dry clean');
  await expect(editor.getByRole('textbox', { name: 'Disclaimer (optional)', exact: true })).toHaveValue('Created disclaimer.\nSecond line.');
  await editor.getByRole('textbox', { name: 'Disclaimer (optional)', exact: true }).fill('Edited disclaimer.\n\nEvery paragraph remains.');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await editor.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByRole('tab', { name: 'Details', exact: true }).click();
  await expect(editor.getByLabel('Care (optional)', { exact: true })).toHaveValue('Specialist dry clean');
  await expect(editor.getByRole('textbox', { name: 'Disclaimer (optional)', exact: true })).toHaveValue('Edited disclaimer.\n\nEvery paragraph remains.');
  expect(writes).toHaveLength(2);
  await page.goto('/products/created');
  await expect(page.locator('dl[aria-label="Product attributes"]').getByRole('definition')).toHaveText([values.Components, values.Fit, values.Composition, 'Specialist dry clean']);
  await expect(page.getByRole('region', { name: 'Disclaimer', exact: true }).locator('p')).toHaveText('Edited disclaimer.\n\nEvery paragraph remains.');
  await page.goto('/runway/LFW/created');
  await expect(page.getByRole('region', { name: 'Disclaimer', exact: true }).locator('p')).toHaveText('Edited disclaimer.\n\nEvery paragraph remains.');
  await page.goto('/admin/products/test');
  await page.getByRole('cell', { name: 'Admin couture test', exact: true }).click();
  editor = page.getByRole('dialog');
  await editor.getByRole('button', { name: 'Edit', exact: true }).click();
  await editor.getByRole('tab', { name: 'Details', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Disclaimer (optional)', exact: true }).fill('');
  await editor.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(editor.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  for (const path of ['/products/created', '/runway/LFW/created']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: 'Admin couture test', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Disclaimer', exact: true })).toHaveCount(0);
  }
});

test('adding a colour keeps the product drawer and media gallery selected after authoritative read-back', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'mock-admin-token'));
  const managedProduct = { ...product, id: 'managed-piece', name: 'Managed piece', sku: 'RK-MANAGED', variants: [variant('blue', 'BLUE', 12000)] };
  const variants = [...managedProduct.variants];
  let collectionReads = 0;
  let colourPosts = 0;
  let redGalleryReads = 0;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (path === '/api/staff/collections/test') {
      collectionReads += 1;
      return route.fulfill({ json: { collection: { id: 'collection', name: 'Test collection', slug: 'test', status: 'published', products: [{ ...managedProduct, variants }] }, allCollections: [], availableProducts: [], permissions: ['products:manage'] } });
    }
    if (path === '/api/staff/products/managed-piece/variants' && route.request().method() === 'POST') {
      colourPosts += 1;
      const colour = String(route.request().postDataJSON().colour);
      if (colour === 'BLUE') return route.fulfill({ status: 409, json: { error: 'Colour already exists.' } });
      if (colour === 'FAILED') return route.fulfill({ status: 500, json: { error: 'Unable to create colour.' } });
      const created = variant('red', colour, 12000);
      variants.push(created);
      return route.fulfill({ json: { variant: created } });
    }
    if (path.startsWith('/api/staff/products/managed-piece/variants/')) {
      const id = path.split('/').at(-1);
      if (id === 'red') redGalleryReads += 1;
      return route.fulfill({ json: { images: id === 'blue' ? ['/blue-image.svg'] : [], imageMeta: [] } });
    }
    if (path === '/api/admin/colour-swatches') return route.fulfill({ json: { colourSwatches: {} } });
    return route.fulfill({ json: {} });
  });
  const loadedRoutes: string[] = [];
  page.on('load', () => loadedRoutes.push(new URL(page.url()).pathname));
  await page.goto('/admin/products/test');
  const originalUrl = page.url();
  await page.getByRole('cell', { name: 'Managed piece', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Managed piece' });
  await drawer.getByRole('tab', { name: 'Media & galleries' }).click();
  await expect(drawer.getByRole('tab', { name: 'BLUE' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('heading', { name: 'BLUE gallery' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'BLUE gallery' }).locator('..').getByText(/1 image.*RK-blue/)).toBeVisible();

  await drawer.getByLabel('New colour name').fill('BLUE');
  await drawer.getByRole('button', { name: 'Add colour', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('Colour already exists.');
  await expect(drawer.getByRole('tab', { name: 'BLUE' })).toHaveAttribute('aria-selected', 'true');
  await drawer.getByLabel('New colour name').fill('FAILED');
  await drawer.getByRole('button', { name: 'Add colour', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('Unable to create colour.');
  await expect(drawer.getByRole('tab', { name: 'BLUE' })).toHaveAttribute('aria-selected', 'true');

  await drawer.getByLabel('New colour name').fill('RED');
  const readsBeforeCreation = collectionReads;
  await drawer.getByRole('button', { name: 'Add colour', exact: true }).click();
  await expect.poll(() => collectionReads).toBeGreaterThan(readsBeforeCreation);
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Media & galleries' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('tab', { name: 'RED' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('heading', { name: 'RED gallery' })).toBeVisible();
  await expect.poll(() => redGalleryReads).toBeGreaterThan(0);
  await expect(drawer.getByRole('heading', { name: 'RED gallery' }).locator('..').getByText(/0 images.*RK-red/)).toBeVisible();
  expect(page.url()).toBe(originalUrl);
  expect(loadedRoutes).toEqual(['/admin/products/test']);
  expect(colourPosts).toBe(3);
  await drawer.getByRole('tab', { name: 'BLUE' }).click();
  await expect(drawer.getByRole('heading', { name: 'BLUE gallery' })).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'RED' })).toHaveAttribute('aria-selected', 'false');
  await drawer.getByPlaceholder('Landscape main.jpg - https://workdrive.zoho.in/file/...').fill('Unsaved gallery draft');
  await drawer.getByLabel('New colour name').fill('GOLD');
  await drawer.getByRole('button', { name: 'Add colour', exact: true }).click();
  await expect(drawer.getByRole('alert')).toContainText('Save or discard the unsaved BLUE gallery changes');
  expect(colourPosts).toBe(3);
  await expect(drawer.getByRole('tab', { name: 'BLUE' })).toHaveAttribute('aria-selected', 'true');
});

test('product creation conflict still opens the persisted existing colour gallery', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'mock-admin-token'));
  const existing = { ...product, id: 'existing-piece', name: 'Existing piece', sku: 'RK-EXISTING', variants: [variant('blue', 'BLUE', 12000)] };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (path === '/api/staff/collections/test') return route.fulfill({ json: { collection: { id: 'collection', name: 'Test collection', slug: 'test', status: 'published', products: [existing] }, allCollections: [], availableProducts: [], permissions: ['products:manage'] } });
    if (path === '/api/staff/resources/products' && route.request().method() === 'POST') return route.fulfill({ status: 409, json: { code: 'SKU_COLOUR_CONFLICT', existingProduct: { id: existing.id, name: existing.name, sku: existing.sku }, variantId: 'blue', existingColour: 'BLUE' } });
    if (path === '/api/staff/products/existing-piece/variants/blue') return route.fulfill({ json: { images: [], imageMeta: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto('/admin/products/test');
  await page.getByRole('button', { name: 'Add product', exact: true }).click();
  const creation = page.getByRole('dialog');
  await creation.getByLabel('Product name', { exact: true }).fill('Duplicate piece');
  await creation.getByLabel('Style code / SKU').fill('RK-EXISTING');
  await creation.getByRole('tab', { name: 'Pricing & inventory' }).click();
  await creation.getByLabel('Base INR price').fill('12000');
  await creation.getByRole('button', { name: 'Create product' }).click();
  await expect(page.getByRole('heading', { name: 'Colour already exists' })).toBeVisible();
  await page.getByRole('button', { name: 'Open existing colour' }).click();
  const drawer = page.getByRole('dialog', { name: 'Existing piece' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Media & galleries' })).toHaveAttribute('aria-selected', 'true');
  await expect(drawer.getByRole('tab', { name: 'BLUE' })).toHaveAttribute('aria-selected', 'true');
});

test('admin WhatsApp setting changes product links and can disable them', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rk_access_token', 'mock-admin-token'));
  await mockStorefront(page);
  let settings = { storeName: 'Rashi Kapoor', supportEmail: '', whatsappNumber: '918879597878', currency: 'INR', timezone: 'Asia/Kolkata', orderPrefix: 'RK', lowStockThreshold: 5, analyticsRetentionDays: 365, emailNotifications: true, orderNotifications: true, lowStockNotifications: true, showStorefrontForex: false, courierOptions: [] };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'admin', role: 'admin', isActive: true, must_change_password: false } } });
    if (path === '/api/admin/settings') {
      if (route.request().method() === 'PUT') settings = route.request().postDataJSON();
      return route.fulfill({ json: { settings } });
    }
    if (path === '/api/storefront-settings') return route.fulfill({ json: { settings: { whatsappNumber: settings.whatsappNumber } } });
    return route.fallback();
  });
  for (const value of ['919000000000', '']) {
    await page.goto('/admin/settings');
    await page.getByLabel(/WhatsApp contact number/).fill(value);
    await page.getByRole('button', { name: 'Save settings', exact: true }).click();
    await expect(page.getByText('Settings saved successfully.', { exact: true })).toBeVisible();
    await page.goto('/products/swatch-test');
    if (value) await expect(page.getByRole('region', { name: 'Product assistance' }).getByRole('link')).toHaveAttribute('href', /wa.me\/919000000000/);
    else {
      await expect(page.getByRole('region', { name: 'Product assistance' }).getByRole('link')).toHaveCount(0);
      await expect(page.locator('[data-product-floating-chat]')).toHaveCount(0);
    }
  }
});

for (const route of ['/products/swatch-test', '/runway/LFW/swatch-test']) {
  for (const width of [1440, 768, 390]) test(`compact purchase controls, disclaimer and chat at ${width}px on ${route}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1000 });
    const sizes = ['XS', 'S', 'M', 'L', 'XL'];
    const { disclaimer: _unused, ...attributes } = product.attributes;
    await mockStorefront(page, { ...product, customSizeConfig: { enabled: true, fields: ['Bust'] }, attributes: { ...attributes, material: 'Lightweight flowing fabric, sheer net, intricate embroidery and shimmering embellishments. Exact fabric composition to be confirmed.', customizationInformation: 'A structured, hand-embroidered blouse paired with a voluminous, high-waisted lehenga featuring fluid cascading layers, complemented by a sheer dupatta with ornate scalloped borders.', productDisclaimer: ['Handcrafted just for you.', 'Colours and textures may vary.'] }, variants: [{ ...product.variants[0], sizes, sizeInventory: sizes.map(size => ({ size, stock: 5 })) }] });
    await page.goto(route);
    await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
    const size = page.getByRole('group', { name: 'Choose a size' });
    const quantity = page.getByRole('group', { name: 'Quantity', exact: true });
    await expect(size.getByRole('button', { name: 'Size guide' })).toBeVisible();
    await expect(size.getByRole('button', { name: 'Want a custom size?', exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Get in touch', exact: true })).toHaveCount(0);
    await expect(page.getByText('For a personal consultation, custom fit or delivery assistance.', { exact: true })).toHaveCount(0);
    const information = page.locator('dl[aria-label="Material and construction"]');
    const labels = information.locator('dt');
    const descriptions = information.locator('dd');
    await expect(labels).toHaveText(['Material:', 'Construction:']);
    const labelBoxes = await labels.evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
    const descriptionBoxes = await descriptions.evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, width: r.width }; }));
    expect(labelBoxes[0]).toEqual(labelBoxes[1]);
    expect(descriptionBoxes[0]).toEqual(descriptionBoxes[1]);
    if (width >= 640) expect(descriptionBoxes[0].x).toBeGreaterThan(labelBoxes[0].x + labelBoxes[0].width);
    await information.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`information-${width}.png`) });
    await information.evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (window.innerHeight - 94)));
    await expect(page.locator('[data-product-floating-chat]')).toBeVisible();
    if (width >= 640) {
      const sizeRect = (await size.boundingBox())!;
      const qtyRect = (await quantity.boundingBox())!;
      expect(Math.abs(sizeRect.y - qtyRect.y)).toBeLessThan(3);
      expect(sizeRect.width).toBeGreaterThan(qtyRect.width * 2);
      expect(qtyRect.width).toBeLessThan(140);
    }
    for (const value of sizes) await expect(size.getByRole('button', { name: value, exact: true })).toBeVisible();
    const guide = size.getByRole('button', { name: 'Size guide', exact: true });
    const lastSize = size.getByRole('button', { name: 'XL', exact: true });
    const sizeLabel = size.getByText('Size', { exact: true });
    const guideRect = (await guide.boundingBox())!;
    const lastSizeRect = (await lastSize.boundingBox())!;
    expect(Math.abs(guideRect.x + guideRect.width - lastSizeRect.x - lastSizeRect.width)).toBeLessThan(1);
    expect(Math.abs(guideRect.y - (await sizeLabel.boundingBox())!.y)).toBeLessThan(3);
    expect(guideRect.y + guideRect.height).toBeLessThan(lastSizeRect.y);
    const buttons = await size.locator('[data-product-size-options]').getByRole('button').filter({ hasNotText: 'Size guide' }).evaluateAll(items => items.map(el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, y: r.y }; }));
    for (let index = 1; index < buttons.length; index++) {
      expect(buttons[index].y).toBe(buttons[0].y);
      expect(Math.abs(buttons[index].x - buttons[index - 1].right - 8)).toBeLessThan(1);
    }
    const fixedChat = page.locator('[data-product-floating-chat]');
    const position = (await fixedChat.boundingBox())!;
    for (const selector of ['[data-testid="product-image-viewport"]', 'dl[aria-label="Material and construction"]', '[aria-labelledby="product-colour-label"]', '[data-product-selection-controls]', 'details', '[aria-label="Disclaimer"]', '[data-product-purchase-controls]']) {
      await page.locator(selector).first().evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (window.innerHeight - 94)));
      await expect(fixedChat).toBeVisible();
      const current = (await fixedChat.boundingBox())!;
      expect(current.x).toBe(position.x);
      expect(current.y).toBe(position.y);
    }
    await guide.click();
    const sizeGuideDialog = page.getByRole('dialog', { name: "Women's measurements" });
    await expect(sizeGuideDialog).toBeVisible();
    await expect(fixedChat).toBeHidden();
    await sizeGuideDialog.getByRole('button', { name: 'Close size guide', exact: true }).click();
    await expect(sizeGuideDialog).toHaveCount(0);
    await expect(fixedChat).toBeVisible();
    await size.getByRole('button', { name: 'M', exact: true }).click();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: 'Increase quantity' }).click();
    await page.getByRole('button', { name: 'Decrease quantity' }).click();
    await expect(page.getByLabel('Selected quantity', { exact: true })).toHaveText('2');
    await page.getByRole('button', { name: 'Add to cart', exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items)).toMatchObject([{ size: 'M', quantity: 2 }]);
    const disclaimer = page.getByRole('region', { name: 'Disclaimer', exact: true });
    await expect(disclaimer.locator('p')).toHaveText('Handcrafted just for you.\nColours and textures may vary.');
    await expect(disclaimer.locator('p')).toHaveCSS('white-space', 'pre-wrap');
    for (const section of ['Product assistance']) {
      const panel = page.getByRole('region', { name: section, exact: true });
      const link = panel.getByRole('link', { name: 'Chat with us', exact: true });
      const panelRect = (await panel.boundingBox())!;
      const linkRect = (await link.boundingBox())!;
      expect(Math.abs(panelRect.x + panelRect.width - linkRect.x - linkRect.width)).toBeLessThan(2);
      expect(new URL((await link.getAttribute('href'))!).searchParams.get('text')).toContain(route);
    }
    await quantity.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath(`purchase-${width}.png`) });
    await disclaimer.scrollIntoViewIfNeeded();
    await expect(page.locator('[data-product-floating-chat]')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`disclaimer-${width}.png`) });
    await page.getByRole('region', { name: 'Product assistance', exact: true }).evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().bottom - 500));
    const chat = page.getByRole('link', { name: 'Chat with us on WhatsApp about this product' });
    await expect(chat).toBeVisible();
    await expect(page.locator('[data-product-floating-chat]')).toHaveCount(1);
    await expect(chat).toHaveAttribute('target', '_blank');
    await expect(chat).toHaveAttribute('rel', 'noopener noreferrer');
    expect(new URL((await chat.getAttribute('href'))!).pathname).toBe('/918879597878');
    await page.keyboard.press('Tab');
    await chat.focus();
    await expect(chat).toHaveCSS('outline-style', 'solid');
    const chatRect = (await chat.boundingBox())!;
    expect(chatRect.width).toBe(44);
    expect(chatRect.y + chatRect.height).toBeLessThanOrEqual(928);
    const theme = (await page.getByRole('button', { name: /Switch to .* mode/ }).boundingBox())!;
    expect(chatRect.y + chatRect.height).toBeLessThan(theme.y);
    await page.screenshot({ path: testInfo.outputPath(`floating-${width}.png`) });
    await page.locator('[data-product-purchase-controls]').evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (window.innerHeight - 94)));
    await expect(page.locator('[data-product-floating-chat]')).toBeVisible();
    await expect(page.locator('[data-product-chat-widget]')).toHaveCSS('pointer-events', 'auto');
    await page.locator('details').evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().top - (window.innerHeight - 94)));
    await expect(page.locator('[data-product-floating-chat]')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test('quantity carries through Buy Now; unavailable WhatsApp settings hide all chat links', async ({ page }) => {
  await mockStorefront(page);
  await page.route('**/api/storefront-settings', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/products/swatch-test');
  await page.evaluate(() => localStorage.setItem('rk_access_token', 'mock-local-token'));
  await page.getByRole('button', { name: 'S', exact: true }).click();
  await page.getByRole('button', { name: 'Increase quantity' }).click();
  await expect(page.locator('a[href^="https://wa.me/"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Buy now', exact: true }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('rk_shopping_bag') || '{}').items)).toMatchObject([{ size: 'S', quantity: 2 }]);
});

async function showChatInClearArea(page: Page) {
  await page.getByRole('region', { name: 'Product assistance', exact: true }).evaluate(el => window.scrollTo(0, window.scrollY + el.getBoundingClientRect().bottom - 500));
  const chat = page.getByRole('link', { name: 'Chat with us on WhatsApp about this product' });
  await expect(chat).toBeVisible();
  return chat;
}

for (const path of ['/products/swatch-test', '/runway/LFW/swatch-test']) test(`size assistance hover, keyboard and both WhatsApp links on ${path}`, async ({ page, context }, testInfo) => {
  await page.clock.install();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await mockStorefront(page);
  const opened: string[] = [];
  // Intercept the destination in the browser context, including new tabs.
  // No request reaches WhatsApp and no message is sent.
  await context.route('https://wa.me/**', route => {
    opened.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<title>Mock WhatsApp destination</title>' });
  });
  await page.goto(path);
  const chat = await showChatInClearArea(page);
  const prompt = page.getByRole('group', { name: 'Size assistance prompt' });
  await expect(prompt).not.toBeVisible();
  await page.clock.fastForward(60000);
  await expect(prompt).not.toBeVisible();
  await chat.hover();
  await expect(prompt).toBeVisible();
  const link = prompt.getByRole('link', { name: "Don't have your size? Chat with us", exact: true });
  const href = (await chat.getAttribute('href'))!;
  await expect(link).toHaveAttribute('href', href);
  const iconBox = (await chat.boundingBox())!;
  const bubbleBox = (await prompt.boundingBox())!;
  expect(bubbleBox.y + bubbleBox.height).toBeLessThan(iconBox.y);
  expect(bubbleBox.width).toBeLessThanOrEqual(240);
  // The small bridge lets a mouse reach the bubble without closing it.
  await page.mouse.move(iconBox.x + iconBox.width / 2, iconBox.y - 6, { steps: 5 });
  await expect(prompt).toBeVisible();
  await link.hover();
  await expect(prompt).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('size-prompt-desktop.png') });
  await page.mouse.move(0, 0);
  await expect(prompt).not.toBeVisible();
  await page.keyboard.press('Tab');
  await chat.focus();
  await expect(prompt).toBeVisible();
  await expect(chat).toHaveCSS('outline-style', 'solid');
  await page.keyboard.press('Escape');
  await expect(prompt).not.toBeVisible();
  await expect(chat).toBeFocused();
  await chat.blur();
  await chat.focus();
  await expect(prompt).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(link).toBeFocused();
  const popupPromise = context.waitForEvent('page');
  await page.keyboard.press('Enter');
  const popup = await popupPromise;
  await popup.waitForURL(url => url.hostname === 'wa.me');
  expect(new URL(popup.url()).searchParams.get('text')).toContain(path);
  await popup.close();
  await expect(prompt).not.toBeVisible();
  const secondPopupPromise = context.waitForEvent('page');
  await chat.click();
  const secondPopup = await secondPopupPromise;
  await secondPopup.waitForURL(url => url.hostname === 'wa.me');
  await secondPopup.close();
  expect(opened).toHaveLength(2);
  expect(new URL(opened[0]).pathname).toBe('/918879597878');
  expect(new URL(opened[0]).searchParams.get('text')).toBe(new URL(opened[1]).searchParams.get('text'));
});

test.describe('hover-only chat on touch screens', () => {
  test.use({ viewport: { width: 390, height: 1000 }, hasTouch: true, isMobile: true });
  for (const path of ['/products/swatch-test', '/runway/LFW/swatch-test']) {
    test(`no timed prompt, dialog suppression and direct WhatsApp tap on ${path}`, async ({ page, context }, testInfo) => {
      await page.clock.install();
      await mockStorefront(page);
      const requests: string[] = [];
      await context.route('https://wa.me/**', route => {
        requests.push(route.request().url());
        return route.fulfill({ contentType: 'text/html', body: '<title>Mock WhatsApp destination</title>' });
      });
      await page.goto(path);
      let chat = await showChatInClearArea(page);
      const prompt = page.getByRole('group', { name: 'Size assistance prompt' });
      await page.clock.fastForward(9000);
      await expect(prompt).not.toBeVisible();
      await page.clock.fastForward(60000);
      await expect(prompt).not.toBeVisible();
      await page.screenshot({ path: testInfo.outputPath('hover-only-mobile.png') });
      await page.getByRole('button', { name: 'Add to cart', exact: true }).tap();
      const dialog = page.getByRole('dialog', { name: 'Please select a size.' });
      await expect(dialog).toBeVisible();
      await page.clock.fastForward(20000);
      await expect(prompt).not.toBeVisible();
      await expect(page.locator('[data-product-floating-chat]')).toBeHidden();
      await dialog.getByRole('button', { name: 'Close size selection', exact: true }).tap();
      await expect(dialog).not.toBeVisible();
      chat = await showChatInClearArea(page);
      await page.clock.fastForward(9000);
      await expect(prompt).not.toBeVisible();
      const popupPromise = context.waitForEvent('page');
      await chat.tap();
      const popup = await popupPromise;
      await popup.waitForURL(url => url.hostname === 'wa.me');
      await popup.close();
      expect(requests).toHaveLength(1);
      expect(new URL(requests[0]).pathname).toBe('/918879597878');
      expect(new URL(requests[0]).searchParams.get('text')).toContain(path);
      await expect(prompt).not.toBeVisible();
    });
  }
});
