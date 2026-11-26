import {test,expect,type Page} from '@playwright/test';
const fixture='http://127.0.0.1:5165';
const pid='000000000000000000000002';
const cid='000000000000000000000004';

async function setup(page:Page,role='admin',permissions:string[]=[]){
  const response=await page.request.post(`${fixture}/__fixture/reset`,{data:{role,permissions}});
  const {token}=await response.json();
  await page.addInitScript(token=>localStorage.setItem('rk_access_token',token),token);
  // Forward browser APIs exclusively to the isolated in-memory test application.
  await page.route('**/api/**',async route=>{const url=new URL(route.request().url());const response=await route.fetch({url:`${fixture}${url.pathname}${url.search}`});await route.fulfill({response});});
  await page.route('**/*',route => ['127.0.0.1','localhost'].includes(new URL(route.request().url()).hostname) ? route.fallback() : route.abort());
  return token;
}

test('campaign details and product management stay separate; collection selection loads eligible products',async({page})=>{
  await setup(page);await page.goto('/admin/sales');
  await expect(page.getByRole('heading',{name:'Sale Management',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Sale Management',exact:true})).toBeVisible();
  await page.getByLabel('Show Sale page on storefront').uncheck();
  await expect.poll(async()=> (await page.request.get(`${fixture}/api/sales/public`)).status()).toBe(404);
  await page.getByLabel('Show Sale page on storefront').check();
  await expect.poll(async()=> (await page.request.get(`${fixture}/api/sales/public`)).status()).toBe(200);
  await page.getByRole('link',{name:'Create campaign',exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/sales\/new$/);
  await expect(page.getByRole('heading',{name:'Create campaign'})).toBeVisible();
  await expect(page.getByLabel('Collection',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:/Add item to sale|Save Product Changes/})).toHaveCount(0);
  await page.getByLabel('Campaign title',{exact:true}).fill('Synthetic Edit');
  await page.getByLabel('Campaign type',{exact:true}).selectOption('custom');
  await page.getByLabel('Custom type',{exact:true}).fill('Synthetic event');
  await page.getByLabel('Start date and time',{exact:true}).fill('2030-01-01T10:00');
  await page.getByLabel('End date and time',{exact:true}).fill('2030-01-03T10:00');
  await page.getByLabel('Enable announcement runner',{exact:true}).check();
  await page.getByLabel('Feature this campaign in the runner',{exact:true}).check();
  await page.getByLabel('Announcement start date and time',{exact:true}).fill('2029-12-28T10:00');
  await page.getByRole('button',{name:'Save draft',exact:true}).click();
  await expect(page).toHaveURL(/\/admin\/sales\/[a-f0-9]{24}$/);
  await expect(page.getByRole('heading',{name:'Synthetic Edit',level:1})).toBeVisible();
  await expect(page.getByText(/draft/i)).toBeVisible();
  await page.getByRole('link',{name:'Manage Products',exact:true}).click();
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000007');
  await expect(page.getByRole('heading',{name:'NAYRA Embroidered Saree'})).toBeVisible();
  await expect(page.getByLabel('Search products',{exact:true})).toHaveValue('');
  await page.getByLabel('Search products',{exact:true}).fill('NAYRA');
  await expect(page.getByRole('heading',{name:'NAYRA Embroidered Saree'})).toBeVisible();
  await page.getByLabel('Search products',{exact:true}).fill('NAYRA-ROYAL-BLUE');
  await expect(page.getByRole('heading',{name:'NAYRA Embroidered Saree'})).toBeVisible();
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000008');
  await expect(page.getByLabel('Search products',{exact:true})).toHaveValue('');
  await expect(page.getByRole('heading',{name:'Hastakala Handwork'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'NAYRA Embroidered Saree'})).toHaveCount(0);
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000003');
  await expect(page.getByRole('heading',{name:'Synthetic Couture'})).toBeVisible();
  await page.getByRole('button',{name:/Add BLUE · RK-SYN-BLUE/}).click();
  await page.getByLabel('Discount for item 1').fill('35');
  await expect(page.getByText('₹1,300',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Save Product Changes',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Product assignments saved.');
  const detailLink=page.getByRole('link',{name:'Edit Details',exact:true});
  await detailLink.click();
  await expect(page.getByLabel('Enable announcement runner',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Feature this campaign in the runner',{exact:true})).toBeChecked();
  await expect(page.getByLabel('Announcement start date and time',{exact:true})).toHaveValue('2029-12-28T10:00');
  await expect(page.getByLabel('Collection',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save Product Changes'})).toHaveCount(0);
  await page.getByLabel('Description / subtitle').fill('Updated metadata only');
  await page.getByRole('button',{name:'Save details',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Campaign details saved.');
  const campaignId=page.url().match(/\/admin\/sales\/([a-f0-9]{24})\/details$/)![1];
  const persisted=(await page.request.get(`${fixture}/api/sales/manage`,{headers:{Authorization:`Bearer ${await page.evaluate(()=>localStorage.getItem('rk_access_token'))}`} })).json().then((payload:any)=>payload.campaigns.find((row:any)=>row.id===campaignId));
  expect((await persisted).items).toHaveLength(1);
  expect((await persisted).showAnnouncementRunner).toBe(true);
  expect((await persisted).announcementFeatured).toBe(true);
  expect((await persisted).announcementStartsAt).toBe('2029-12-28T04:30:00Z');
  await page.getByRole('link',{name:'Manage Products',exact:true}).click();
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000003');
  await expect(page.getByRole('button',{name:/Added BLUE · RK-SYN-BLUE/})).toBeDisabled();
  await page.getByRole('button',{name:/Add IVORY · RK-SYN-IVORY/}).click();
  await page.getByRole('button',{name:'Save Product Changes',exact:true}).click();
  await expect(page.getByLabel('Discount for item 2')).toBeVisible();
  await page.getByRole('button',{name:'Remove',exact:true}).first().click();
  await page.getByRole('button',{name:'Save Product Changes',exact:true}).click();
  await expect(page.getByLabel('Discount for item 2')).toHaveCount(0);
  await page.getByRole('link',{name:'Sale Management',exact:true}).click();
  const campaignRow=page.getByRole('row').filter({hasText:'Synthetic Edit'});
  await campaignRow.getByRole('button',{name:'Publish',exact:true}).click();
  await expect(campaignRow).toContainText('scheduled');
  await campaignRow.getByRole('button',{name:'Pause',exact:true}).click();
  await expect(campaignRow).toContainText('paused');
  page.once('dialog',dialog=>dialog.accept());
  await campaignRow.getByRole('button',{name:'Archive',exact:true}).click();
  await expect(campaignRow).toContainText('archived');
});

test('staff permission controls UI and backend without inheriting sales access',async({page})=>{
  let token=await setup(page,'staff',[]);await page.goto('/staff/sales');
  await expect(page.getByText('Sale access requires administrator permission.')).toBeVisible();
  expect((await page.request.get(`${fixture}/api/sales/manage`,{headers:{Authorization:`Bearer ${token}`}})).status()).toBe(403);
  token=await setup(page,'staff',['sales:manage']);await page.reload();
  await expect(page.getByRole('link',{name:'Create campaign',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Sale Management',exact:true})).toBeVisible();
  await expect(page.getByLabel('Show Sale page on storefront')).toHaveCount(0);
});

for(const width of [1440,390])test(`sale storefront, exact variant prices and filters at ${width}px`,async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/banner`);
  await page.route(/\/api\/sales\/[^/]+\/banner\?/,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240"><rect width="800" height="240" fill="#b6a579"/></svg>'}));
  await page.setViewportSize({width,height:1000});await page.goto('/sale');
  await expect(page.getByRole('heading',{name:'Considered Sale',exact:true})).toBeVisible();
  const liveBanner=page.getByTestId('sale-live-banner');
  await expect(liveBanner).toBeVisible();
  await expect(liveBanner.getByTestId('sale-hero-content').getByRole('heading',{name:'Considered Sale',exact:true})).toBeVisible();
  await expect(liveBanner.getByTestId('sale-hero-content').getByRole('link')).toHaveCount(0);
  const liveBounds=await liveBanner.evaluate(el=>{const {x,width}=el.getBoundingClientRect();return {x,width};});
  expect(liveBounds.x).toBe(0);expect(Math.round(liveBounds.width)).toBe(width);
  await expect(page.getByTestId('teaser-watermark')).toHaveCount(0);
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  await expect(page.getByText('₹800',{exact:true})).toBeVisible();
  if(width<1024)await page.getByRole('button',{name:'Filters',exact:true}).click();
  await page.getByLabel('Category',{exact:true}).selectOption('Lehenga');
  await expect(page.getByText('1 pieces',{exact:true})).toBeVisible();
  if(width<1024) await page.getByRole('button',{name:'Open menu',exact:true}).click();
  await expect(page.getByRole('link',{name:'SALE',exact:true}).first()).toHaveAttribute('href','/sale');
  if(width<1024) { await page.getByRole('button',{name:'Close menu',exact:true}).click(); await expect(page.getByRole('button',{name:'Close menu',exact:true})).toHaveCount(0); }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`sale-${width}.png`),fullPage:true});
  await page.goto(`/products/${pid}?variant=ivory`);
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  await page.getByRole('radio',{name:/BLUE/}).locator('..').click();
  await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0);
  await expect(page.getByText('₹2,000',{exact:true})).toBeVisible();
});

test('expired campaign and disabled global visibility return real not-found responses',async({page})=>{
  const token=await setup(page);
  await page.request.post(`${fixture}/__fixture/expire`);
  expect((await page.goto('/sale'))?.status()).toBe(404);
  expect((await page.goto('/sale/considered-sale'))?.status()).toBe(404);
  await setup(page);await page.request.put(`${fixture}/api/sales/visibility`,{headers:{Authorization:`Bearer ${token}`},data:{enabled:false}});
  expect((await page.goto('/sale'))?.status()).toBe(404);
});

test('expired bag quote returns updated MRP before creating any order',async({page})=>{
  const token=await setup(page);await page.request.post(`${fixture}/__fixture/expire`);
  const response=await page.request.post(`${fixture}/api/payments/razorpay/order`,{headers:{Authorization:`Bearer ${token}`},data:{checkoutAttemptId:'synthetic-sale-attempt',cart:[{productId:pid,variantId:'ivory',sku:'RK-SYN-IVORY',quantity:1,size:'S',quotedUnitPrice:800}],shipping:{fullName:'Synthetic',phone:'+14155552671',line1:'Synthetic road',city:'Synthetic',state:'Synthetic',country:'US',postalCode:'12345'},whatsappTransactionalConsent:false}});
  expect(response.status()).toBe(409);const data=await response.json();expect(data.code).toBe('price_changed');expect(data.prices[0].price).toBe(1000);
});

test('banner upload preview and removal use verified application storage',async({page})=>{
  await setup(page);await page.goto('/admin/sales');await page.getByRole('link',{name:'Edit Details',exact:true}).first().click();
  await expect(page.getByRole('heading',{name:'Campaign Banner Media'})).toBeVisible();
  await page.getByLabel('Upload campaign media').setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64')});
  await expect(page.getByAltText('Campaign banner preview')).toBeVisible();
  await page.getByRole('button',{name:'Remove banner',exact:true}).click();
  await expect(page.getByAltText('Campaign banner preview')).toHaveCount(0);
  await page.getByLabel('Campaign media URL').fill('https://workdrive.zoho.in/file/synthetic123');
  await page.getByRole('button',{name:'Verify and use media',exact:true}).click();
  await expect(page.getByRole('status')).toHaveText('Banner verified and saved.');
  await expect(page.getByAltText('Campaign banner preview')).toBeVisible();
  await page.getByRole('button',{name:'Remove banner',exact:true}).click();
  await expect(page.getByAltText('Campaign banner preview')).toHaveCount(0);
  await page.getByLabel('Campaign media URL').fill('https://workdrive.zoho.in/file/unavailable123');
  await page.getByRole('button',{name:'Verify and use media',exact:true}).click();
  await expect(page.getByRole('alert').filter({hasText:'Unable to verify campaign media: Synthetic WorkDrive file is unavailable.'})).toBeVisible();
  await expect(page.getByAltText('Campaign banner preview')).toHaveCount(0);
});

test('video campaign upload uses authenticated admin preview and exposes browser playback attributes',async({page})=>{
  await setup(page);await page.goto('/admin/sales');await page.getByRole('link',{name:'Edit Details',exact:true}).first().click();
  const mp4=Buffer.from('000000186674797069736f6d0000020069736f6d69736f3261766331','hex');
  await page.getByLabel('Upload campaign media').setInputFiles({name:'synthetic.mp4',mimeType:'video/mp4',buffer:mp4});
  const preview=page.getByLabel('Campaign banner preview');await expect(preview).toBeVisible();
  await expect.poll(()=>preview.evaluate((el:HTMLVideoElement)=>el.controls)).toBe(true);
  await expect(page.getByText(/Type: Video · Format: video\/mp4/)).toBeVisible();
  const campaignId=page.url().match(/\/admin\/sales\/([a-f0-9]{24})\/details$/)![1];
  const response=await page.request.get(`${fixture}/api/sales/manage/${campaignId}/banner-media`,{headers:{Authorization:`Bearer ${await page.evaluate(()=>localStorage.getItem('rk_access_token'))}`}});
  expect(response.status()).toBe(200);expect(response.headers()['content-type']).toContain('video/mp4');
  await page.goto('/sale');const live=page.getByTestId('sale-banner-media');await expect(live).toBeVisible();
  const liveVideoStyle=await live.evaluate(el=>{const style=getComputedStyle(el);return {height:style.height,objectFit:style.objectFit,aspectRatio:style.aspectRatio};});
  expect(liveVideoStyle.objectFit).toBe('contain');expect(liveVideoStyle.aspectRatio).toBe('auto');
  const attributes=await live.evaluate((el:HTMLVideoElement)=>({tag:el.tagName,autoplay:el.autoplay,muted:el.muted,loop:el.loop,playsInline:el.playsInline,controls:el.controls,preload:el.preload}));
  expect(attributes).toEqual({tag:'VIDEO',autoplay:true,muted:true,loop:true,playsInline:true,controls:false,preload:'metadata'});
  await expect(page.getByTestId('teaser-watermark')).toHaveCount(0);
});

test('collection cards, bag and checkout use the canonical sale price',async({page})=>{
  await setup(page);
  await page.goto('/collections/synthetic');
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  await page.evaluate(pid=>localStorage.setItem('rk_shopping_bag',JSON.stringify({currency:'INR',items:[{productId:pid,productCode:'RK-SYN',variantId:'ivory',sku:'RK-SYN-IVORY',collection:'Synthetic Collection',colour:'IVORY',name:'Synthetic Couture',price:1,quantity:1,size:'S',inventoryMode:'variant'}]})),pid);
  await page.goto('/bag');
  await expect(page.getByText('₹800',{exact:true}).first()).toBeVisible();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('rk_shopping_bag')!).items[0].price)).toBe(800);
  await page.goto('/checkout');
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  await expect(page.getByText('₹800',{exact:true}).first()).toBeVisible();
});

test('server end time removes sale and navigation without a worker',async({page})=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/ending`);
  await page.goto('/sale');
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0,{timeout:12000});
  await expect(page.getByRole('link',{name:'SALE',exact:true})).toHaveCount(0,{timeout:12000});
});

for(const width of [1440,390])test(`admin sale editor fits ${width}px`,async({page},info)=>{
  await setup(page);await page.setViewportSize({width,height:1000});await page.goto('/admin/sales');
  await page.getByRole('link',{name:'Manage Products',exact:true}).first().click();
  await expect(page.getByLabel('Collection',{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`admin-sale-${width}.png`),fullPage:true});
});

test('search portal on live synthetic sale uses the actual catalogue search route',async({page})=>{
  await setup(page);await page.setViewportSize({width:1440,height:900});await page.goto('/sale');
  await expect(page.getByRole('heading',{name:'Considered Sale',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Search',exact:true}).click();
  const popup=page.getByRole('dialog',{name:'Search the house'});
  expect(await popup.evaluate(el=>el.closest('header'))).toBeNull();
  await popup.getByRole('textbox').fill('RK-SYN-BLUE');
  await expect(popup.getByRole('link',{name:'View Synthetic Couture',exact:true})).toBeVisible();
  await popup.getByRole('button',{name:'Close search'}).click();
  await expect(page.getByRole('heading',{name:'Considered Sale',exact:true})).toBeVisible();
});


test('AAKAAR picker resolves the same five admin products and explains exclusions',async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/aakaar`);
  const admin=await (await page.request.get(`${fixture}/__fixture/admin-aakaar`)).json();
  expect(admin.collection.products.map((p:any)=>p.name)).toEqual(['CK02','CK05','T0','AURELIA','T2']);
  await page.goto(`/admin/sales/${cid}/products`);
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000007');
  await expect(page.getByText(/5 total products/)).toBeVisible();
  await expect(page.getByRole('heading',{name:'AURELIA',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Unavailable for sale (4)',exact:true})).toBeVisible();
  await expect(page.getByText('No products exist in this collection.',{exact:true})).toHaveCount(0);
  const selection=await (await page.request.get(`${fixture}/api/sales/products?collection=000000000000000000000007`,{headers:{Authorization:`Bearer ${await page.evaluate(()=>localStorage.getItem('rk_access_token'))}`}})).json();
  expect(new Set([...selection.products,...selection.excludedProducts].map((p:any)=>p.id))).toEqual(new Set(admin.collection.products.map((p:any)=>p.id)));
  await page.getByLabel('Search products',{exact:true}).fill('AURELIA-BLUE');
  await expect(page.getByRole('heading',{name:'AURELIA',exact:true})).toBeVisible();
  await page.getByLabel('Search products',{exact:true}).fill('');
  await expect(page.getByRole('heading',{name:'Unavailable for sale (4)',exact:true})).toBeVisible();
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);await page.screenshot({path:info.outputPath(`aakaar-picker-${width}.png`),fullPage:true});}
  await page.getByLabel('Collection',{exact:true}).selectOption('000000000000000000000008');
  await expect(page.getByRole('heading',{name:'Hastakala Handwork'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'AURELIA',exact:true})).toHaveCount(0);
});


for(const width of [1440,390])test(`product lifecycle and six-unit colour size allocation at ${width}px`,async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/product-admin`);
  await page.setViewportSize({width,height:1000});
  await page.goto(`/admin/products/synthetic?productId=${pid}`);
  const drawer=page.getByRole('dialog',{name:'Synthetic Couture',exact:true});
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button',{name:'Activate product',exact:true})).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await drawer.getByRole('button',{name:'Activate product',exact:true}).click();
  await expect(drawer.getByRole('button',{name:'Deactivate product',exact:true})).toBeVisible();
  await drawer.getByRole('tab',{name:'Pricing & inventory',exact:true}).click();
  await expect(drawer.getByText(/6 unallocated units/)).toBeVisible();
  await drawer.getByLabel('Quantity RK-SYN-IVORY S',{exact:true}).fill('1');
  await drawer.getByLabel('Quantity RK-SYN-IVORY M',{exact:true}).fill('2');
  await drawer.getByLabel('Quantity RK-SYN-BLUE L',{exact:true}).fill('2');
  await drawer.getByLabel('Quantity RK-SYN-BLUE XL',{exact:true}).fill('1');
  await drawer.getByLabel('Allocation reason',{exact:true}).fill('Synthetic six unit allocation');
  const saved=page.waitForResponse(response=>response.url().includes('/stock-allocation')&&response.request().method()==='PATCH');
  await drawer.getByRole('button',{name:'Allocate existing stock',exact:true}).click();
  expect((await saved).status()).toBe(200);
  await expect(drawer.getByRole('button',{name:'Save size stock',exact:true})).toBeVisible();
  await expect(drawer.getByLabel('Quantity RK-SYN-BLUE L',{exact:true})).toHaveValue('2');
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`inventory-${width}.png`),fullPage:true});
  await page.reload();
  await drawer.getByRole('tab',{name:'Pricing & inventory',exact:true}).click();
  await expect(drawer.getByLabel('Quantity RK-SYN-IVORY M',{exact:true})).toHaveValue('2');
  await expect(drawer.getByLabel('Quantity RK-SYN-BLUE L',{exact:true})).toHaveValue('2');
});


for(const nonstandard of [false,true])test(`compact inventory matrix totals and configured sizes: ${nonstandard?'different size sets':'three colours five sizes'}`,async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/product-admin`,{data:{thirdColour:true,nonstandard}});
  await page.setViewportSize({width:390,height:1000});await page.goto(`/admin/products/synthetic?productId=${pid}`);
  const drawer=page.getByRole('dialog',{name:'Synthetic Couture',exact:true});await drawer.getByRole('tab',{name:'Pricing & inventory',exact:true}).click();
  const matrix=drawer.getByRole('table',{name:'Colour size allocation matrix'});
  await expect(matrix.locator('tbody tr')).toHaveCount(3);
  await expect(matrix.getByRole('spinbutton')).toHaveCount(nonstandard?12:15);
  await expect(drawer.getByText(/6 unallocated units/)).toBeVisible();
  await matrix.getByLabel('Quantity RK-SYN-IVORY S',{exact:true}).fill('2');
  await matrix.getByLabel('Quantity RK-SYN-BLUE M',{exact:true}).fill('3');
  await matrix.getByLabel(`Quantity RK-SYN-POWDER ${nonstandard?'XXL':'XL'}`,{exact:true}).fill('1');
  await expect(matrix.getByTestId('colour-total-ivory')).toHaveText('2');
  await expect(matrix.getByTestId('colour-total-blue')).toHaveText('3');
  await expect(matrix.getByTestId('colour-total-powder')).toHaveText('1');
  await expect(matrix.getByTestId('size-total-S')).toHaveText('2');await expect(matrix.getByTestId('size-total-M')).toHaveText('3');
  await expect(matrix.getByTestId('allocation-grand-total')).toHaveText('6');
  await expect(drawer.getByRole('button',{name:'Allocate existing stock'})).toBeDisabled();
  await drawer.getByLabel('Allocation reason').fill('Synthetic compact matrix allocation');
  const saved=page.waitForResponse(r=>r.url().includes('/stock-allocation')&&r.request().method()==='PATCH');await drawer.getByRole('button',{name:'Allocate existing stock'}).click();expect((await saved).status()).toBe(200);
  await expect(drawer.getByRole('tab',{name:'Pricing & inventory'})).toHaveAttribute('aria-selected','true');
  await expect(matrix.getByTestId('allocation-grand-total')).toHaveText('6');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('compact-matrix-mobile.png'),fullPage:true});
});

test('prelaunch runner opens only a banner teaser and follows live and expiry boundaries',async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'upcoming',seconds:8,duration:8}});
  await page.setViewportSize({width:1440,height:1000});await page.goto('/collections/synthetic');
  const runner=page.getByRole('link',{name:/Festive Edit.*STARTS TODAY/});
  await expect(runner).toBeVisible();await expect(runner).toHaveAttribute('href','/sale/preview/festive-edit');
  await expect(page.getByRole('link',{name:'SALE',exact:true})).toHaveCount(0);
  await runner.hover();expect(await runner.locator('.rk-sale-runner-track').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
  await runner.focus();expect(await runner.locator('.rk-sale-runner-track').evaluate(el=>getComputedStyle(el).animationPlayState)).toBe('paused');
  await runner.click();await expect(page).toHaveURL(/\/sale\/preview\/festive-edit$/);
  await expect(page.getByText('COMING SOON',{exact:true})).toBeVisible();await expect(page.getByAltText('Festive Edit',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Sale filters')).toHaveCount(0);await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0);
  await page.screenshot({path:info.outputPath('prelaunch-desktop.png'),fullPage:true});
  await expect(page).toHaveURL(/\/sale$/,{timeout:12000});
  await expect(page.getByTestId('teaser-watermark')).toHaveCount(0);
  await expect(page.getByRole('link',{name:/Festive Edit.*LIVE NOW/})).toHaveAttribute('href','/sale');
  await expect(page.getByRole('link',{name:'SALE',exact:true}).first()).toBeVisible();
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible();
  const order=await page.locator('header nav').first().locator('button,a').evaluateAll(els=>els.map(el=>el.textContent?.trim()));expect(order.indexOf('SALE')).toBeGreaterThan(order.indexOf('Contact'));
  await expect(page.getByRole('link',{name:/Festive Edit.*LIVE NOW/})).toHaveCount(0,{timeout:12000});
  await expect(page.getByRole('link',{name:'SALE',exact:true})).toHaveCount(0,{timeout:12000});
});

test('announcement visibility, reduced motion and mobile ordering are explicit',async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'before'}});await page.goto('/collections/synthetic');
  await expect(page.getByRole('link',{name:/Festive Edit/})).toHaveCount(0);
  await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'live'}});
  await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:900});await page.reload();
  const runner=page.getByRole('link',{name:/Festive Edit.*LIVE NOW/});await expect(runner).toBeVisible();
  expect(await runner.locator('.rk-sale-runner-track').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  await page.setViewportSize({width:320,height:900});
  expect(await runner.locator('.rk-sale-runner-track > span').first().evaluate(el=>el.getBoundingClientRect().width)).toBeLessThanOrEqual(320);
  expect(await runner.locator('.rk-sale-runner-track').evaluate(el=>el.scrollHeight)).toBeLessThanOrEqual(32);
  await page.setViewportSize({width:390,height:900});
  await page.getByRole('button',{name:'Open menu'}).click();
  const menuSale=page.getByRole('link',{name:'SALE',exact:true}).last();await expect(menuSale).toBeVisible();
  const menu=await menuSale.locator('..').locator('button,a').evaluateAll(els=>els.map(el=>el.textContent?.trim()));expect(menu.indexOf('SALE')).toBeGreaterThan(menu.indexOf('Contact'));
  await page.getByRole('button',{name:'Close menu'}).click();
  await expect(menuSale).toBeHidden();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:info.outputPath('runner-mobile.png'),fullPage:true});
  await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'paused'}});await page.reload();await expect(page.getByRole('link',{name:/Festive Edit/})).toHaveCount(0);
});


test('an open product detail reprices at launch and expiry without navigation',async({page})=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'upcoming',seconds:5,duration:7}});
  const quotes:unknown[]=[];
  page.on('request',request=>{if(new URL(request.url()).pathname==='/api/sales/prices')quotes.push(request.postDataJSON());});
  await page.goto(`/products/${pid}?variant=ivory`);
  await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0);
  await expect(page.getByText('\u20b91,000',{exact:true})).toBeVisible();
  await expect(page.getByText('20% OFF',{exact:true})).toBeVisible({timeout:10000});
  await expect(page.getByText('\u20b9800',{exact:true})).toBeVisible();
  await expect(page.locator('del')).toHaveText('\u20b91,000');
  await expect(page).toHaveURL(new RegExp(`/products/${pid}\\?variant=ivory$`));
  await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0,{timeout:10000});
  await expect(page.getByText('\u20b91,000',{exact:true})).toBeVisible();
  await expect(page.locator('del')).toHaveCount(0);
  await expect.poll(()=>quotes.length).toBe(2);
  expect(quotes).toEqual(Array.from({length:2},()=>({items:[{productId:pid,variantId:'ivory'}]})));
  await expect(page.getByRole('radio',{name:/IVORY/})).toBeChecked();
});

for(const width of [1440,900,390])test(`live sale banner preserves full source aspect ratio at ${width}px`,async({page},info)=>{
  await setup(page);await page.request.post(`${fixture}/__fixture/banner`,{data:{bannerHeading:'Old banner heading',bannerSubtitle:'The seasonal edit',ctaLabel:'Explore pieces',ctaDestination:'#sale-products',timezone:'America/New_York'}});
  await page.route(/\/api\/sales\/[^/]+\/banner\?/,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#b6a579"/><circle cx="400" cy="600" r="300" fill="#33263b"/></svg>'}));
  await page.setViewportSize({width,height:1000});await page.goto('/sale');
  const liveBanner=page.getByTestId('sale-live-banner');const media=page.getByTestId('sale-banner-media');
  await expect(liveBanner).toBeVisible();await expect.poll(()=>media.evaluate(el=>(el as HTMLImageElement).naturalHeight)).toBe(1200);
  const [bannerBox,layout]=await Promise.all([
    liveBanner.evaluate(el=>{const {x,width}=el.getBoundingClientRect();return {x,width};}),
    media.evaluate(el=>{const image=el as HTMLImageElement;const style=getComputedStyle(el);const rect=el.getBoundingClientRect();return {naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight,width:rect.width,height:rect.height,objectFit:style.objectFit,maxHeight:style.maxHeight};}),
  ]);
  const content=liveBanner.getByTestId('sale-hero-content');
  await expect(content.getByRole('heading',{name:'Considered Sale',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Considered Sale',exact:true})).toHaveCount(1);
  await expect(content.getByText('The seasonal edit',{exact:true})).toBeVisible();
  await expect(content.getByText(/^Ends /)).toContainText(/GMT-5|EST/);
  const cta=content.getByRole('link',{name:'Explore pieces',exact:true});await expect(cta).toHaveAttribute('href','#sale-products');
  const placement=await liveBanner.evaluate(el=>{const hero=el.getBoundingClientRect();const content=el.querySelector('[data-testid="sale-hero-content"]')!.getBoundingClientRect();const heading=el.querySelector('h1')!.getBoundingClientRect();const products=document.getElementById('sale-products')!.getBoundingClientRect();return {hero:{top:hero.top,bottom:hero.bottom},content:{top:content.top,bottom:content.bottom},heading:{top:heading.top,bottom:heading.bottom},productsTop:products.top};});
  expect(placement.content).toEqual(placement.hero);expect(placement.heading.top).toBeGreaterThanOrEqual(placement.hero.top);expect(placement.heading.bottom).toBeLessThanOrEqual(placement.hero.bottom);expect(placement.productsTop).toBeGreaterThan(placement.hero.bottom);
  await cta.click();await expect(page).toHaveURL(/#sale-products$/);await page.evaluate(()=>window.scrollTo(0,0));
  expect(bannerBox.x).toBe(0);expect(Math.round(bannerBox.width)).toBe(width);
  expect(layout.objectFit).toBe('contain');expect(layout.maxHeight).toBe('none');
  expect(Math.abs(layout.height/layout.width-layout.naturalHeight/layout.naturalWidth)).toBeLessThan(.01);
  expect(layout.height).toBeGreaterThan(width/3);
  expect(await page.getByTestId('teaser-watermark').count()).toBe(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`live-banner-ratio-${width}.png`),fullPage:true});
});

for(const width of [1440,900,390])test(`runner has no inactive space and teaser uses responsive editorial gutters at ${width}px`,async({page},info)=>{
  await setup(page);await page.setViewportSize({width,height:1000});
  // Synthetic contrast reference for watermark screenshots; no external imagery.
  await page.route(/\/api\/sales\/[^/]+\/banner\?/,route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="800" height="240"><defs><linearGradient id="g"><stop stop-color="#33263b"/><stop offset="1" stop-color="#b6a579"/></linearGradient></defs><path fill="url(#g)" d="M0 0h800v240H0z"/><path fill="#77634d" d="M100 0h180v240H100zM520 0h180v240H520z"/></svg>'}));
  for(const mode of ['none','before','paused','archived','expired','disabled','announcement-disabled']){
    await page.request.post(`${fixture}/__fixture/reset`,{data:{role:'admin'}});
    await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode}});
    await page.goto('/collections/synthetic');
    await expect(page.getByTestId('sale-announcement-slot')).toHaveCount(0);
    const header=page.locator('header').first();
    await expect.poll(async()=>Math.round((await header.boundingBox())!.y)).toBe(0);
    const nav=header.locator(':scope > div').last();
    expect(Math.round((await nav.boundingBox())!.y)).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  // Refresh the same mounted header in both directions, without navigation.
  await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'upcoming'}});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  const slot=page.getByTestId('sale-announcement-slot');
  await expect(slot).toBeVisible();
  await expect.poll(async()=>Math.round((await slot.boundingBox())!.height)).toBe(32);
  const nav=page.locator('header').first().locator(':scope > div').last();
  await expect.poll(async()=>Math.round((await nav.boundingBox())!.y)).toBe(32);
  const runner=page.getByRole('link',{name:/Festive Edit.*STARTS TODAY/});
  expect(await runner.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBe(width<640?11:12.5);
  await expect.poll(async()=>page.evaluate(()=>Math.abs(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--rk-header-height'))-document.querySelector('header')!.getBoundingClientRect().height)<1.5)).toBe(true);
  await runner.click();
  const banner=page.getByAltText('Festive Edit',{exact:true});await expect(banner).toBeVisible();
  const coming=page.getByText('COMING SOON',{exact:true});
  // Measure both in the same frame while the header height animates into place.
  const [imageBox,overlayBox,bannerBox]=await page.getByTestId('teaser-banner').evaluate(el=>[el.querySelector('img')!,el.querySelector('[data-testid="teaser-watermark"]')!,el].map(node=>{const {x,y,width,height}=node.getBoundingClientRect();return {x,y,width,height};}));
  const expectedGutter=width<640?16:width<1024?Math.round(width*.06):width>=1280?Math.round((width-960)/2):Math.round(width*.075);
  expect(Math.round(imageBox.x)).toBe(expectedGutter);expect(Math.round(imageBox.width+2*expectedGutter)).toBe(width);
  expect(Math.round(bannerBox.x)).toBe(expectedGutter);expect(Math.round(bannerBox.width)).toBe(Math.round(imageBox.width));
  expect(overlayBox).toEqual(imageBox);
  await expect(page.getByTestId('teaser-banner').getByTestId('teaser-watermark')).toBeVisible();
  const presentation=await coming.evaluate(el=>{const style=getComputedStyle(el);const range=document.createRange();range.selectNodeContents(el);const text=range.getBoundingClientRect();return {position:style.position,opacity:style.opacity,whiteSpace:style.whiteSpace,background:style.backgroundColor,borderWidth:style.borderTopWidth,textWidth:text.width,textHeight:text.height,fontSize:parseFloat(style.fontSize)};});
  expect(presentation.position).toBe('absolute');expect(presentation.opacity).toBe('0.5');expect(presentation.whiteSpace).toBe('nowrap');expect(presentation.background).toBe('rgba(0, 0, 0, 0)');expect(presentation.borderWidth).toBe('0px');
  expect(presentation.textWidth).toBeLessThanOrEqual(imageBox.width);expect(presentation.textHeight).toBeLessThan(presentation.fontSize*1.5);
  expect(await banner.evaluate(el=>({filter:getComputedStyle(el).filter,opacity:getComputedStyle(el).opacity}))).toEqual({filter:'none',opacity:'1'});
  // Natural image aspect ratio preserves the entire saved composition on mobile.
  expect(await banner.evaluate((el)=>{const image=el as HTMLImageElement;return image.complete&&image.naturalWidth>0&&Math.abs(image.getBoundingClientRect().height/image.getBoundingClientRect().width-image.naturalHeight/image.naturalWidth)<.01;})).toBe(true);
  await expect(page.getByTestId('teaser-banner').getByRole('heading',{name:'Festive Edit',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Festive Edit',exact:true})).toHaveCount(1);
  await expect(page.getByTestId('teaser-banner').getByText(/Launches/)).toBeVisible();
  const contentBox=await page.getByTestId('teaser-banner').getByRole('heading',{name:'Festive Edit',exact:true}).boundingBox();
  expect(contentBox!.y).toBeGreaterThanOrEqual(imageBox.y);expect(contentBox!.y+contentBox!.height).toBeLessThanOrEqual(imageBox.y+imageBox.height);
  await expect(page.getByLabel('Sale filters')).toHaveCount(0);
  await expect(page.getByText('20% OFF',{exact:true})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await page.screenshot({path:info.outputPath(`editorial-teaser-${width}.png`),fullPage:true});
  await page.request.post(`${fixture}/__fixture/announcement`,{data:{mode:'paused'}});
  // The runner refresh is independent of the teaser availability refresh.
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(slot).toHaveCount(0);
  await expect.poll(async()=>Math.round((await nav.boundingBox())!.y)).toBe(0);
});

test('loading and unavailable announcements leave normal headers on storefront routes',async({page})=>{
  await setup(page);
  await page.route('**/api/sales/announcement',async route=>{await new Promise(resolve=>setTimeout(resolve,500));await route.fulfill({status:503,json:{error:'Synthetic unavailable announcement'}});});
  for(const route of ['/','/collections/synthetic',`/products/${pid}?variant=ivory`,'/sale']){
    await page.goto(route);
    await expect(page.getByTestId('sale-announcement-slot')).toHaveCount(0);
    const header=page.locator('header').first();
    await expect.poll(async()=>Math.round((await header.locator(':scope > div').last().boundingBox())!.y)).toBe(0);
    await page.waitForTimeout(600);
    await expect(page.getByTestId('sale-announcement-slot')).toHaveCount(0);
  }
});

 test('incomplete campaign CTA configuration never produces an empty or fallback link',async({page})=>{
  await setup(page);
  for(const fields of [{ctaLabel:'Explore',ctaDestination:''},{ctaLabel:'',ctaDestination:'#sale-products'}]){
    await page.request.post(`${fixture}/__fixture/banner`,{data:fields});await page.goto('/sale');
    await expect(page.getByTestId('sale-hero-content').getByRole('link')).toHaveCount(0);
  }
});
