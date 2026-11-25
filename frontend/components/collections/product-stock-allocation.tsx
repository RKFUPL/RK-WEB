'use client';
import { useEffect, useState } from 'react';
import type { CatalogProduct } from '@/lib/catalog';
import { apiBaseUrl } from '@/lib/rbac';

export function ProductStockAllocation({product,onSaved}:{product:CatalogProduct;onSaved:()=>Promise<unknown>}) {
  const [rows,setRows]=useState<Array<{variantId:string;sku:string;size:string;quantity:string}>>([]);
  const [reason,setReason]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const groups=product.inventoryBuckets || [];
  useEffect(()=>{setRows(groups.flatMap(group=>group.sizes.map(size=>({variantId:group.variantId,sku:group.sku,size,quantity:String((group.variantId ? product.variants?.find(v=>v.id===group.variantId)?.sizeInventory : product.sizeInventory)?.find(s=>s.size===size)?.stock ?? 0)}))));setReason('');},[product.inventoryRevision]);
  if(!groups.length)return null;
  const total=rows.reduce((sum,row)=>sum+Number(row.quantity||0),0);
  const sizes=[...new Set(groups.flatMap(group=>group.sizes))];
  const quantity=(variantId:string,size:string)=>Number(rows.find(row=>row.variantId===variantId&&row.size===size)?.quantity||0);
  async function save(){setError('');setBusy(true);try{
    if(rows.some(row=>!/^\d+$/.test(row.quantity)))throw new Error('Enter a non-negative whole quantity for every size.');
    const response=await fetch(`${apiBaseUrl}/api/staff/products/${product.id}/stock-allocation`,{method:'PATCH',headers:{Authorization:`Bearer ${localStorage.getItem('rk_access_token')||''}`,'Content-Type':'application/json'},body:JSON.stringify({inventoryRevision:product.inventoryRevision,reason,buckets:rows.map(row=>({...row,quantity:Number(row.quantity)}))})});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'Unable to save allocation.');await onSaved();setReason('');
  }catch(e){setError(e instanceof Error?e.message:'Unable to save allocation.');}finally{setBusy(false);}}
  return <section aria-label="Size stock allocation" className="mt-6 min-w-0 space-y-4 rounded-xl border border-black/10 p-4 dark:border-white/10">
    <h3 className="font-display text-xl">Stock by colour and size</h3>
    {!product.inventoryAllocationMode && <p className="text-sm">{product.stock||0} unallocated units. Allocate existing units explicitly; saving must preserve the existing total. Colour stock already recorded is not added to aggregate stock.</p>}
    <p className="text-xs text-[var(--admin-muted)]">Every row uses its saved colour SKU. Saving replaces quantities and records the reason in the product audit.</p>
    {error&&<p role="alert" className="text-sm text-red-700">{error}</p>}
    <div className="max-w-full overflow-x-auto"><table aria-label="Colour size allocation matrix" className="w-full text-left text-xs tabular-nums"><thead><tr><th scope="col" className="sticky left-0 z-10 min-w-36 bg-[var(--admin-surface)] p-2">Colour / SKU</th>{sizes.map(size=><th scope="col" key={size} className="p-2 text-center">{size}</th>)}<th scope="col" className="p-2 text-right">Total</th></tr></thead><tbody>{groups.map(group=><tr key={group.variantId||group.sku} className="border-t border-black/5"><th scope="row" className="sticky left-0 z-10 max-w-44 bg-[var(--admin-surface)] p-2 font-normal"><span className="block font-medium">{group.colour||'Product'}</span><span className="block break-all text-[10px] text-[var(--admin-muted)]">{group.sku}</span></th>{sizes.map(size=>{const row=rows.find(item=>item.variantId===group.variantId&&item.size===size);return <td key={size} className="p-1 text-center">{row?<input aria-label={`Quantity ${row.sku} ${row.size}`} type="number" min="0" step="1" className="w-14 rounded border border-black/15 bg-transparent px-1 py-1.5 text-center focus-visible:outline focus-visible:outline-gold" value={row.quantity} onChange={e=>setRows(current=>current.map(item=>item.variantId===row.variantId&&item.size===row.size?{...item,quantity:e.target.value}:item))}/>:<span aria-label="Size not configured">—</span>}</td>})}<td data-testid={`colour-total-${group.variantId||group.sku}`} className="p-2 text-right font-medium">{group.sizes.reduce((sum,size)=>sum+quantity(group.variantId,size),0)}</td></tr>)}</tbody><tfoot><tr className="border-t border-black/10 font-medium"><th scope="row" className="sticky left-0 z-10 bg-[var(--admin-surface)] p-2">Total</th>{sizes.map(size=><td key={size} data-testid={`size-total-${size}`} className="p-2 text-center">{groups.reduce((sum,group)=>sum+quantity(group.variantId,size),0)}</td>)}<td data-testid="allocation-grand-total" className="p-2 text-right">{total}</td></tr></tfoot></table></div>
    <label className="block text-sm">Allocation reason<input aria-label="Allocation reason" value={reason} onChange={e=>setReason(e.target.value)} className="mt-2 w-full rounded border border-black/15 bg-transparent p-2"/></label>
    <button type="button" disabled={busy||!reason.trim()} onClick={()=>void save()} className="rounded-lg border border-black/15 px-4 py-2 text-sm disabled:opacity-40">{busy?'Saving allocation…':product.inventoryAllocationMode?'Save size stock':'Allocate existing stock'}</button>
  </section>;
}
