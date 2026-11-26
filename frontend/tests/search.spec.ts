import { expect, test, type Page } from '@playwright/test';

async function fixture(page: Page) {
  const queries: string[] = [];
  await page.route('**/api/**', route => {
    if (new URL(route.request().url()).pathname === '/api/catalog/products/synthetic-search') return route.fulfill({ json: { product: {
      id: 'synthetic-search', name: 'Synthetic search piece', price: 1000, currency: 'INR', availability: 'in_stock', media: [],
      attributes: {}, variants: [{ id: 'ivory', sku: 'SEARCH-IVORY', colour: 'IVORY', status: 'active', price: 1000, sizes: ['S'], images: [] }],
    }, collections: [] } });
    if (new URL(route.request().url()).pathname === '/api/lookbooks') return route.fulfill({json:{lookbookAssetUrls:{Aakaar:'/synthetic-lookbook/aakaar'},lookbookCoverAssetUrls:{Aakaar:'/synthetic-search.svg'}}});
    return route.fulfill({ json: {} });
  });
  await page.route('**/api/catalog/collections', route => route.fulfill({ json: { collections: [
    { id: 'hastakala', name: 'Hastakala', slug: 'collections-of-hastakala', description: 'Craft-led pieces', coverImage: '/synthetic-search.svg' },
    { id: 'aakaar', name: 'Aakaar', slug: 'aakaar', description: 'Couture', coverImage: '/synthetic-search.svg' },
  ] } }));
  await page.route('**/api/catalog/products?*', async route => {
    const query = new URL(route.request().url()).searchParams.get('q') || '';
    queries.push(query);
    if (query === 'error') return route.fulfill(queries.filter(q=>q==='error').length === 1 ? { status: 503, json: {} } : {json:{products:[],count:0}});
    if (query === 'slow') await new Promise(resolve => setTimeout(resolve, 800));
    const found = /ruhani|ck184|hk-ck184-red|hastakala/i.test(query);
    if (/^jaa/i.test(query)) return route.fulfill({json:{count:12,suggestions:['jaal','Jaal','jaal embroidery','jaal lehenga'],products:['Jaal Embroidered Lehenga','Jaal Work Anarkali','Ivory Jaal Saree','Jaal Silk Set'].map((name,i)=>({id:`jaal-${i}`,name,price:800,currency:'INR',sale:{isOnSale:true,mrp:1000,discountPercent:20},media:['/synthetic-search.svg'],attributes:{},variants:[]}))}});
    try { await route.fulfill({ json: { products: found ? [{ id: 'ruhani', name: 'RUHANI', productCode: 'CK184', matchedVariantId: 'colour:red', variants:[{id:'colour:red',sku:'HK-CK184-RED',colour:'RED',status:'active',images:['/synthetic-search.svg']}], media: ['/synthetic-search.svg'], collections: [{ name: 'Hastakala', slug: 'collections-of-hastakala' }] }] : query === 'slow' ? [{ id: 'old', name: 'Obsolete piece', media: [] }] : [] } }); } catch { /* Aborted obsolete request. */ }
  });
  await page.route('**/synthetic-search.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="72"><rect width="56" height="72" fill="#c8b8a0"/></svg>' }));
  await page.route('**/*',route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort());
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
  await expect(dialog(page).getByRole('link', { name: 'View RUHANI' })).toBeVisible();
  await expect(dialog(page).getByRole('heading',{name:'Suggestions',exact:true})).toBeVisible();
  for (const name of ['Products (1)', 'Collections (1)', 'Lookbooks (1)']) await expect(dialog(page).getByRole('tab',{name,exact:true})).toBeVisible();
  await dialog(page).getByRole('tab',{name:'Collections (1)'}).click();
  await expect(dialog(page).getByRole('link', { name: 'Hastakala', exact: true })).toHaveAttribute('href', '/collections/collections-of-hastakala');
  await page.screenshot({ path: info.outputPath('search-desktop.png') });
  for (const query of ['RUHANI', 'HK-CK184-RED']) { await input(page).fill(query); await expect(dialog(page).getByRole('link', { name: 'View RUHANI' })).toBeVisible(); }
  await input(page).fill('Espiritu'); await expect(dialog(page).getByRole('tab',{name:'Lookbooks (1)'})).toHaveAttribute('aria-selected','true');
  await expect(dialog(page).getByRole('link',{name:/Espiritu Libre Lookbook/})).toBeVisible();
  await dialog(page).getByRole('button', { name: 'Clear search query' }).click();
  await expect(input(page)).toBeFocused(); await expect(input(page)).toHaveValue('');
  await expect(dialog(page).getByRole('heading', { name: 'Popular Searches' })).toBeVisible();
  expect(queries).not.toContain('');
});

test('submit and Enter reuse the same completed query; results close and reset', async ({ page }) => {
  const queries = await fixture(page); await page.goto('/about'); await open(page);
  await input(page).fill('RUHANI'); await expect.poll(() => queries.length).toBe(1);
  await dialog(page).getByRole('button', { name: 'Submit search' }).click(); await expect.poll(() => queries.length).toBe(1);
  await input(page).press('Enter'); await expect.poll(() => queries.length).toBe(1);
  await expect(page).toHaveURL(/\/about$/); await expect(dialog(page)).toBeVisible();
  await dialog(page).getByRole('link', { name: 'View RUHANI' }).click();
  await expect(page).toHaveURL(/\/products\/ruhani\?variant=colour%3Ared$/); await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await open(page); await expect(input(page)).toHaveValue('');
});

test('errors differ from empty results and obsolete responses cannot replace current results', async ({ page }) => {
  const queries = await fixture(page); await page.goto('/about'); await open(page);
  await input(page).fill('unmatched-synthetic-928');
  await expect(dialog(page).getByText('No matching pieces found.')).toBeVisible();
  await input(page).fill('error'); await expect(dialog(page).getByRole('alert')).toContainText('Product search could not be loaded');
  await expect(dialog(page).getByText('No matching pieces found.')).toHaveCount(0);
  await input(page).fill('slow'); await expect.poll(() => queries.includes('slow')).toBe(true);
  await input(page).fill('RUHANI'); await expect(dialog(page).getByRole('link', { name: 'View RUHANI' })).toBeVisible();
  await page.waitForTimeout(900); await expect(dialog(page).getByText('Obsolete piece')).toHaveCount(0);
});

test('mobile menu opens same compact portal and retains scroll lock until menu closes', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixture(page); await page.goto('/about');
  await page.getByRole('button', { name: 'Open menu' }).click(); await open(page);
  await input(page).fill('RUHANI'); await expect(dialog(page).getByRole('link', { name: 'View RUHANI' })).toBeVisible();
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
  await expect(dialog(page).getByText('No matching pieces found.')).toHaveCount(0);
});

for(const width of [1440,900,390]) test(`approved results layout, counts, canonical images and pricing at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:950});const queries=await fixture(page);await page.goto('/about');
  if(width<1024) await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await open(page);await page.screenshot({path:info.outputPath(`search-empty-${width}.png`)});
  await input(page).fill('jaa');await expect(dialog(page).getByRole('tab',{name:'Products (12)'})).toBeVisible();
  await expect(dialog(page).locator('[data-search-product]')).toHaveCount(4);
  await expect(dialog(page).getByRole('img',{name:'Jaal Embroidered Lehenga',exact:true})).toHaveAttribute('src','/synthetic-search.svg');
  await expect(dialog(page).getByText('20% OFF')).toHaveCount(4);await expect(dialog(page).locator('del')).toHaveCount(4);
  await expect(dialog(page).getByRole('button',{name:'jaal',exact:true})).toHaveCount(1);
  const [suggestionBounds,resultBounds]=await Promise.all([dialog(page).getByRole('heading',{name:'Suggestions'}).boundingBox(),dialog(page).getByRole('tablist').boundingBox()]);
  if(width>=768) expect(suggestionBounds!.x+suggestionBounds!.width).toBeLessThan(resultBounds!.x);
  else expect(suggestionBounds!.y).toBeLessThan(resultBounds!.y);
  const columns=await dialog(page).locator('[data-search-product]').first().locator('..').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);
  expect(columns).toBe(width>=1024?4:2);
  expect(await dialog(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`search-results-${width}.png`)});
  await dialog(page).getByRole('button',{name:'jaal embroidery',exact:true}).click();await expect(input(page)).toHaveValue('jaal embroidery');
  await expect.poll(()=>queries.includes('jaal embroidery')).toBe(true);
  await dialog(page).getByRole('link',{name:'View all 12 products'}).click();await expect(page).toHaveURL(/\/shop\?q=jaal%20embroidery$/);
});

test('canonical collection casing, automatic tab selection and result navigation',async({page})=>{
  await fixture(page);await page.goto('/about');await open(page);await input(page).fill('Aakaar');
  await expect(dialog(page).getByRole('tab',{name:'Collections (1)'})).toHaveAttribute('aria-selected','true');
  await expect(dialog(page).getByRole('link',{name:'Aakaar',exact:true})).toHaveAttribute('href','/collections/aakaar');
  await expect(dialog(page).getByText('AAKAAR',{exact:true})).toHaveCount(0);
  await dialog(page).getByRole('link',{name:'Aakaar',exact:true}).click();await expect(page).toHaveURL(/\/collections\/aakaar$/);await expect(dialog(page)).toHaveCount(0);
  await page.goto('/about');await open(page);await input(page).fill('Aakaar');
  await expect(dialog(page).getByRole('tab',{name:'Collections (1)'})).toHaveAttribute('aria-selected','true');
  await dialog(page).getByRole('tab',{name:'Collections (1)'}).focus();await page.keyboard.press('ArrowRight');
  await expect(dialog(page).getByRole('tab',{name:'Lookbooks (1)'})).toBeFocused();
  await dialog(page).getByRole('link',{name:/Aakaar Lookbook/}).click();await expect(page).toHaveURL(/\/synthetic-lookbook\/aakaar$/);
});

test('failed search retries and same pending query is not duplicated',async({page})=>{
  const queries=await fixture(page);await page.goto('/about');await open(page);await input(page).fill('error');
  await expect(dialog(page).getByRole('alert')).toContainText('Product search could not be loaded');
  await dialog(page).getByRole('button',{name:'Retry search'}).click();await expect.poll(()=>queries.filter(q=>q==='error').length).toBe(2);
  await expect(dialog(page).getByRole('alert')).toHaveCount(0);await expect(input(page)).toHaveValue('error');
  await expect(dialog(page).getByText('No matching pieces found.')).toBeVisible();
  await input(page).fill('slow');await expect.poll(()=>queries.includes('slow')).toBe(true);await input(page).press('Enter');
  await dialog(page).getByRole('button',{name:'Submit search'}).click();await input(page).fill(' SLOW ');
  await expect(dialog(page).getByRole('link',{name:'View Obsolete piece'})).toBeVisible();expect(queries.filter(q=>q==='slow').length).toBe(1);
});


test('real Flask catalogue search ranks prefix and SKU matches and preserves matched variant routing',async({page})=>{
  const server='http://127.0.0.1:5166';await page.request.post(`${server}/__fixture/search`);
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:`${server}${url.pathname}${url.search}`});await route.fulfill({response});});
  await page.route('**/*',route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort());
  await page.goto('/about');await open(page);await input(page).fill('jaa');
  await expect(dialog(page).getByRole('tab',{name:'Products (5)'})).toBeVisible();await expect(dialog(page).locator('[data-search-product]')).toHaveCount(4);
  await expect(dialog(page).getByRole('link',{name:'View Jaal Embroidered Lehenga'})).toBeVisible();
  await input(page).fill('AA-CK213-ROYAL-BLUE');
  await expect(dialog(page).getByRole('tab',{name:'Products (1)'})).toBeVisible();
  await expect(dialog(page).getByRole('link',{name:'View Jaal Embroidered Lehenga'})).toHaveAttribute('href','/products/000000000000000000000032?variant=colour%3Aroyal-blue');
  await input(page).fill('CK213');await expect(dialog(page).getByRole('link',{name:'View Jaal Embroidered Lehenga'})).toBeVisible();
  await input(page).fill('Aakaar');await expect(dialog(page).getByRole('tab',{name:'Products (5)'})).toBeVisible();
  await dialog(page).getByRole('tab',{name:'Collections (1)'}).click();await expect(dialog(page).getByRole('link',{name:'Aakaar',exact:true})).toHaveAttribute('href','/collections/aakaar');
});


for(const width of [1440,900,390]) test(`compact collection and lookbook search cards at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:950});await fixture(page);await page.goto('/about');
  if(width<1024) await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await open(page);await input(page).fill('Aakaar');
  const collection=dialog(page).getByTestId('search-collections-card');await expect(collection).toHaveCount(1);
  await expect(collection).toBeVisible();
  const image=collection.locator('img');await expect(image).toHaveCSS('object-fit','cover');
  const bounds=await collection.boundingBox(),imageBounds=await image.boundingBox(),panel=await dialog(page).getByRole('tabpanel',{name:'Collections (1)'}).boundingBox();
  expect(bounds!.width).toBeLessThanOrEqual(210);expect(bounds!.width).toBeLessThan(panel!.width);
  expect(Math.abs(imageBounds!.width/imageBounds!.height-4/3)).toBeLessThan(.01);
  if(width>=768){expect(imageBounds!.height).toBeGreaterThanOrEqual(130);expect(imageBounds!.height).toBeLessThanOrEqual(160);}
  await page.screenshot({path:info.outputPath(`compact-collections-${width}.png`)});
  await dialog(page).getByRole('tab',{name:'Lookbooks (1)'}).click();const lookbook=dialog(page).getByTestId('search-lookbooks-card');
  await expect(lookbook).toHaveCount(1);await expect(lookbook.locator('img')).toHaveCSS('object-fit','contain');
  const cover=await lookbook.locator('img').boundingBox();expect(cover!.width).toBeLessThanOrEqual(180);expect(Math.abs(cover!.width/cover!.height-.75)).toBeLessThan(.01);
  await page.screenshot({path:info.outputPath(`compact-lookbooks-${width}.png`)});
  await input(page).fill('lookbook');await expect(dialog(page).getByRole('tab',{name:'Lookbooks (6)'})).toHaveAttribute('aria-selected','true');
  await expect(dialog(page).getByTestId('search-lookbooks-card')).toHaveCount(6);
  for(const card of await dialog(page).getByTestId('search-lookbooks-card').all()) expect((await card.boundingBox())!.width).toBeLessThanOrEqual(180);
  await page.route('**/api/catalog/collections',route=>route.fulfill({json:{collections:['Archive One','Archive EDIT','Archive Three','Archive Four'].map((name,i)=>({id:`archive-${i}`,slug:`archive-${i}`,name,coverImage:'/synthetic-search.svg',description:'Synthetic archive'}))}}));
  await dialog(page).getByRole('button',{name:'Close search'}).click();await page.reload();
  if(width<1024) await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await open(page);await input(page).fill('archive');await expect(dialog(page).getByRole('tab',{name:'Collections (4)'})).toHaveAttribute('aria-selected','true');
  const cards=dialog(page).getByTestId('search-collections-card');await expect(cards).toHaveCount(4);
  const dimensions=await cards.evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));
  expect(new Set(dimensions.map(Math.round)).size).toBe(1);expect(Math.max(...dimensions)).toBeLessThanOrEqual(210);
  expect(await dialog(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`compact-multiple-collections-${width}.png`)});
});

test('collection editor persists the exact saved name across admin, public, search and reload',async({page})=>{
  const server='http://127.0.0.1:5166';const seed=await page.request.post(`${server}/__fixture/collection-name`);const {token}=await seed.json();
  await page.addInitScript(token=>localStorage.setItem('rk_access_token',token),token);
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:`${server}${url.pathname}${url.search}`});await route.fulfill({response});});
  await page.route('**/synthetic-search.svg',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#b6a579"/></svg>'}));
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.fallback():route.abort());
  await page.goto('/admin/products/aakaar');await expect(page.getByRole('heading',{name:'AAKAAR',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit collection',exact:true}).click();const name=page.getByRole('textbox',{name:'Name',exact:true});await expect(name).toHaveValue('AAKAAR');
  await name.fill('Aakaar');const responsePromise=page.waitForResponse(response=>response.url().includes('/api/staff/collections/aakaar')&&response.request().method()==='PATCH');
  await page.getByRole('button',{name:'Update collection',exact:true}).click();const response=await responsePromise;
  expect(response.request().postDataJSON()).toMatchObject({name:'Aakaar',expectedUpdatedAt:null});const saved=(await response.json()).collection;
  expect(saved.name).toBe('Aakaar');expect(saved.id).toBe('000000000000000000000033');expect(saved.slug).toBe('aakaar');
  await expect(page.getByRole('heading',{name:'Aakaar',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Aakaar line',exact:true})).toBeVisible();
  await page.reload();await expect(page.getByRole('heading',{name:'Aakaar',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Edit collection',exact:true}).click();await expect(name).toHaveValue('Aakaar');
  await page.goto('/admin/products');await expect(page.getByRole('link',{name:'Open Aakaar collection',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'Open Archive EDIT collection',exact:true})).toBeVisible();
  await page.goto('/collections/aakaar');await expect(page.getByRole('heading',{name:'Aakaar',exact:true,level:1})).toBeVisible();
  await open(page);await input(page).fill('Aakaar');await dialog(page).getByRole('tab',{name:'Collections (1)'}).click();await expect(dialog(page).getByRole('link',{name:'Aakaar',exact:true})).toBeVisible();
  const readback=await page.request.get(`${server}/api/staff/collections/aakaar`,{headers:{Authorization:`Bearer ${token}`}});expect((await readback.json()).collection.name).toBe('Aakaar');
});

for (const failure of ['patch-response', 'read-back']) test(`collection name ${failure} mismatch retains draft and never reports success`, async ({page}) => {
  const server='http://127.0.0.1:5166';
  const seed=await page.request.post(`${server}/__fixture/collection-name`);const {token}=await seed.json();
  await page.addInitScript(token=>localStorage.setItem('rk_access_token',token),token);
  let saved=false;
  await page.route('**/api/**',async route=>{
    const request=route.request(),url=new URL(request.url());
    const response=await route.fetch({url:`${server}${url.pathname}${url.search}`});
    if(url.pathname==='/api/staff/collections/aakaar' && request.method()==='PATCH') {
      saved=true;
      if(failure==='patch-response'){const body=await response.json();body.collection.name='AAKAAR';await route.fulfill({response,json:body});return;}
    }
    if(saved && failure==='read-back' && url.pathname==='/api/staff/collections/aakaar' && request.method()==='GET') {
      const body=await response.json();body.collection.name='AAKAAR';await route.fulfill({response,json:body});return;
    }
    await route.fulfill({response});
  });
  await page.route('**/*',route=>['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname)?route.fallback():route.abort());
  await page.goto('/admin/products/aakaar');await page.getByRole('button',{name:'Edit collection',exact:true}).click();
  const name=page.getByRole('textbox',{name:'Name',exact:true});await name.fill('Aakaar');await page.getByRole('button',{name:'Update collection',exact:true}).click();
  await expect(page.getByText(/Your draft remains available\./)).toBeVisible();await expect(name).toHaveValue('Aakaar');
  await expect(page.getByText('Collection updated.',{exact:true})).toHaveCount(0);
  await expect(page.getByText(/received "AAKAAR"|returned name "AAKAAR"/)).toBeVisible();
});
