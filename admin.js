(() => {
 const $=s=>document.querySelector(s),config=window.TRikonicSupabaseConfig,client=window.supabase.createClient(config.url,config.publishableKey);
 const stages=['Order Received','Payment Made','Order Placed','Order Shipped','Order Arrived in Ghana','Order Arrived at Warehouse','Order Ready for Collection','Order Delivered'];
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=n=>`GH₵${Number(n).toFixed(2)}`,stamp=v=>new Date(v).toLocaleString('en-GH',{timeZone:'Africa/Accra'});
 let user=null,epoch=0,factorId='',orderPage=1,shipmentPage=1,shipmentSearch='',currentView='orders',currentOrder=null,availableShipments=[],listedShipments=[];
 const message=(text,error=false)=>{$('#status').textContent=text;$('#status').className=error?'error':'';};
 async function api(name,body){const id=user?.id;const {data,error}=await client.functions.invoke(name,{body});if(id!==user?.id)throw new Error('Your sign-in changed. Please refresh.');if(error){let detail;try{detail=await error.context?.json();}catch{}throw new Error(detail?.error||'The request could not be completed. Please refresh and try again.');}return data;}
 async function run(button,action){if(button)button.disabled=true;message('Working…');try{await action();message('Up to date.');}catch(e){message(e.message,true);}finally{if(button)button.disabled=false;}}
 function clearPrivateView(){epoch++;$('#workspace').hidden=true;$('#detail').hidden=true;$('#orders-body').replaceChildren();$('#shipment-list').replaceChildren();$('#detail-content').replaceChildren();currentOrder=null;listedShipments=[];availableShipments=[];}
 async function boot(){
  clearPrivateView();const seq=epoch;$('#login').hidden=true;$('#mfa').hidden=true;
  const {data:{session}}=await client.auth.getSession();if(seq!==epoch)return;user=session?.user||null;$('#signout').hidden=!user;
  if(!user){$('#login').hidden=false;message('Sign in to manage orders.');return;}
  try{
   const access=await api('admin-orders',{action:'access'});if(seq!==epoch)return;
   if(access.mfaRequired){
    $('#mfa').hidden=false;const {data,error}=await client.auth.mfa.listFactors();if(error)throw error;if(seq!==epoch)return;
    const verified=data.totp.find(f=>f.status==='verified');factorId=verified?.id||'';$('#enroll').hidden=Boolean(verified);$('#mfa-form').hidden=!verified;$('#qr').hidden=true;message(verified?'Enter your authenticator code.':'Set up an authenticator app to protect customer information.');return;
   }
   $('#workspace').hidden=false;$('#mfa').hidden=true;message(`Administrator verified · Paystack ${access.paymentMode} mode.`);await refreshView();
  }catch(e){if(seq===epoch)message(e.message,true);}
 }
 $('#login-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{const form=e.currentTarget;const values=new FormData(form);const {error}=await client.auth.signInWithPassword({email:values.get('email'),password:values.get('password')});if(error)throw error;form.reset();});});
 $('#signout').addEventListener('click',()=>run($('#signout'),async()=>{clearPrivateView();const {error}=await client.auth.signOut();if(error)throw error;}));
 $('#enroll').addEventListener('click',()=>run($('#enroll'),async()=>{
  const {data:existing,error:listError}=await client.auth.mfa.listFactors();if(listError)throw listError;
  for(const factor of existing.all.filter(f=>f.factor_type==='totp'&&f.status==='unverified')){const {error}=await client.auth.mfa.unenroll({factorId:factor.id});if(error)throw error;}
  const {data,error}=await client.auth.mfa.enroll({factorType:'totp',friendlyName:'Trikonic store admin'});if(error)throw error;
  factorId=data.id;$('#qr').src=data.totp.qr_code;$('#qr').hidden=false;$('#mfa-form').hidden=false;$('#enroll').hidden=true;
 }));
 $('#mfa-form').addEventListener('submit',e=>{e.preventDefault();run(e.submitter,async()=>{
  const form=e.currentTarget;const code=new FormData(form).get('code');const {data,error}=await client.auth.mfa.challenge({factorId});if(error)throw error;
  const verified=await client.auth.mfa.verify({factorId,challengeId:data.id,code});if(verified.error)throw verified.error;$('#qr').src='';form.reset();await boot();
 });});
 function pageControls(target,page,total,kind){$(target).innerHTML=`<button data-page-kind="${kind}" data-page="${page-1}" ${page===1?'disabled':''}>Previous</button><span>Page ${page} · ${total} records</span><button data-page-kind="${kind}" data-page="${page+1}" ${page*25>=total?'disabled':''}>Next</button>`;}
 async function loadOrders(){
  const values=new FormData($('#filters'));const result=await api('admin-orders',{action:'orders',page:orderPage,search:values.get('search'),payment:values.get('payment'),status:values.get('status'),attention:values.has('attention')});
  const orders=result.orders;$('#orders-body').innerHTML=orders.length?orders.map(o=>`<tr><td>${esc(o.order_number)}<small>${esc(stamp(o.created_at))}</small></td><td>${esc(o.customer_name)}</td><td>${money(o.estimated_total)}</td><td><span class="badge ${o.payment_status==='paid'?'':'warning'}">${esc(o.payment_status)}</span></td><td>${esc(o.status)}</td><td>${o.needs_attention||o.job_attention?'<span class="badge warning">Needs attention</span>':'—'}${o.refund_review_required?'<small>Refund review required</small>':''}</td><td><button data-open-order="${esc(o.id)}">Open</button></td></tr>`).join(''):'<tr><td colspan="7">No matching orders.</td></tr>';
  pageControls('#orders-pages',orderPage,Number(orders[0]?.total_count||0),'orders');
 }
 async function findAssignable(search=''){
  const result=await api('admin-shipments',{action:'shipments',page:1,stage:2,search});availableShipments=result.shipments;
  const select=$('#assign-shipment');if(select)select.innerHTML='<option value="">Choose a shipment</option>'+availableShipments.map(s=>`<option value="${esc(s.id)}">${esc(s.label)} · ${esc(stamp(s.created_at))}</option>`).join('');
 }
 function assignmentState(order,items){
  const remaining=items.map(item=>Math.max(0,Number(item.quantity)-Number(item.allocated)));
  let reason='';
  if(order.status==='Order Cancelled')reason='This order is cancelled. Cancelled orders cannot be added to a shipment.';
  else if(order.payment_status!=='paid')reason='Payment is not confirmed. Items can be assigned after payment is verified. Payments made outside Paystack cannot be confirmed by a Paystack recheck.';
  else if(!items.length)reason='This order has no items available for shipment assignment.';
  else if(!remaining.some((quantity,index)=>quantity>0&&items[index].baseline_stage<=2))reason=remaining.every(quantity=>quantity===0)?'All items are already assigned to shipments. Manage their current shipments in the Shipments tab. Shipped or delivered items cannot be added to another shipment.':'These items have already progressed beyond the unshipped stage and cannot be added to a new shipment.';
  return {canAssign:!reason,reason,remaining};
 }
 async function loadDetail(id){
  const result=await api('admin-orders',{action:'detail',id});if(!result?.order)throw new Error('Order not found.');currentOrder=result;
  const o=result.order,assignment=assignmentState(o,result.items);$('#detail').hidden=false;
  $('#detail-content').innerHTML=`<h2>${esc(o.order_number)}</h2><div class="details-grid"><div><h3>Customer and delivery</h3><p>${esc(o.customer_name)}<br>${esc(o.customer_email)}<br>${esc(o.contact)}<br>${esc(o.delivery_area)}</p><p>${esc(o.notes)}</p></div><div><h3>Payment and delivery</h3><p>${money(o.estimated_total)} · ${esc(o.payment_status)}<br>${esc(o.status)}</p>${o.attention_reason?`<p class="notice">${esc(o.attention_reason)}</p>`:''}<label>Payment reference<select id="recheck-reference">${[...new Set([o.confirmed_reference,o.payment_reference,...result.attempts.map(a=>a.reference)].filter(Boolean))].map(ref=>`<option>${esc(ref)}</option>`).join('')}</select></label><button id="recheck-payment" ${!o.payment_reference&&!result.attempts.length?'disabled':''}>Recheck with Paystack</button><small>Only Paystack verification can confirm payment.</small></div></div><h3>Add items to a shipment</h3>${assignment.reason?`<p class="notice">${esc(assignment.reason)}</p>`:'<p>Enter the quantity for each item, choose an unshipped shipment, then click Assign items to shipment.</p>'}<div>${result.items.map((i,index)=>`<div class="item-pick"><span>${esc(i.snapshot.name)}<small>${esc([i.snapshot.color,i.snapshot.size,i.snapshot.variant].filter(Boolean).join(' · '))} · Ordered ${i.quantity} · Allocated ${i.allocated}</small></span><label>Quantity to assign<input type="number" min="0" step="1" max="${assignment.remaining[index]}" value="0" data-allocate-item="${esc(i.id)}" ${!assignment.canAssign||!assignment.remaining[index]||i.baseline_stage>2?'disabled':''}><small>${assignment.remaining[index]} unassigned</small></label></div>`).join('')}</div>${assignment.canAssign?'<h3>Choose a shipment</h3><form id="assign-search" class="filters"><label>Find a shipment<input name="search" maxlength="100" placeholder="Shipment name or tracking reference"></label><button>Find</button></form><label>Unshipped shipment<select id="assign-shipment"></select></label><button id="assign-items">Assign items to shipment</button>':''}<h3>Automatic checks and receipt delivery</h3><ul>${result.jobs.map(j=>`<li>${esc(j.kind)}: ${esc(j.state)} · ${j.attempts} attempts${j.last_error?`<small>${esc(j.last_error)}</small>`:''}</li>`).join('')||'<li>No pending recovery jobs.</li>'}</ul><h3>Audit history</h3><ul class="audit">${result.audit.map(a=>`<li>${esc(stamp(a.created_at))} · ${esc(a.action)}${a.actor_id?' · administrator/customer action':' · automatic'}</li>`).join('')||'<li>No changes recorded since migration.</li>'}</ul>`;
  if($('#assign-shipment'))await findAssignable();$('#detail').scrollIntoView({behavior:'smooth',block:'start'});
 }
 async function loadShipments(){
  const result=await api('admin-shipments',{action:'shipments',page:shipmentPage,search:shipmentSearch});listedShipments=result.shipments;
  $('#shipment-list').innerHTML=listedShipments.map(s=>`<article class="shipment"><h2>${esc(s.label)}</h2><p>${esc(stages[s.stage])}${s.tracking_code?` · ${esc(s.tracking_code)}`:''}</p><ul>${s.items.map(i=>`<li>${esc(i.order_number)} · ${i.quantity} × ${esc(i.name)} ${s.stage===2?`<button class="secondary" data-unassign="${esc(i.id)}" data-shipment="${esc(s.id)}">Unassign</button>`:''}</li>`).join('')||'<li>No items assigned yet. Open an order to assign its items.</li>'}</ul>${s.stage<7?`<div class="shipment-actions"><label>Move shipment to<select id="stage-${esc(s.id)}">${stages.map((label,index)=>index>s.stage?`<option value="${index}">${esc(label)}</option>`:'').join('')}</select></label><button data-advance="${esc(s.id)}" ${!s.items.length?'disabled':''}>Update all linked items</button></div>`:'<span class="badge">Delivered</span>'}</article>`).join('')||'<p>No shipments match.</p>';
  pageControls('#shipment-pages',shipmentPage,Number(listedShipments[0]?.total_count||0),'shipments');
 }
 async function refreshView(){if(currentView==='orders')await loadOrders();else await loadShipments();}
 $('#filters').addEventListener('submit',e=>{e.preventDefault();orderPage=1;run(e.submitter,loadOrders);});
 $('#shipment-search').addEventListener('submit',e=>{e.preventDefault();shipmentSearch=new FormData(e.currentTarget).get('search');shipmentPage=1;run(e.submitter,loadShipments);});
 $('#shipment-create').addEventListener('submit',e=>{e.preventDefault();const form=e.currentTarget;run(e.submitter,async()=>{const values=new FormData(form);await api('admin-shipments',{action:'create_shipment',label:values.get('label'),tracking_code:values.get('tracking_code')});form.reset();shipmentPage=1;await loadShipments();});});
 $('#orders-tab').addEventListener('click',()=>{currentView='orders';$('#orders').hidden=false;$('#shipments').hidden=true;run($('#orders-tab'),loadOrders);});
 $('#shipments-tab').addEventListener('click',()=>{currentView='shipments';$('#orders').hidden=true;$('#shipments').hidden=false;$('#detail').hidden=true;run($('#shipments-tab'),loadShipments);});
 $('#refresh').addEventListener('click',()=>run($('#refresh'),refreshView));$('#close-detail').addEventListener('click',()=>{$('#detail').hidden=true;currentOrder=null;});
 document.addEventListener('submit',e=>{if(e.target.id==='assign-search'){e.preventDefault();run(e.submitter,()=>findAssignable(new FormData(e.target).get('search')));}});
 document.addEventListener('click',e=>{
  const button=e.target.closest('button');if(!button||button.disabled)return;
  if(button.dataset.pageKind){if(button.dataset.pageKind==='orders')orderPage=Number(button.dataset.page);else shipmentPage=Number(button.dataset.page);run(button,refreshView);}
  if(button.dataset.openOrder)run(button,()=>loadDetail(button.dataset.openOrder));
  if(button.id==='recheck-payment')run(button,async()=>{const result=await api('admin-orders',{action:'recheck',id:currentOrder.order.id,reference:$('#recheck-reference').value});await loadDetail(currentOrder.order.id);await loadOrders();message(`Paystack result: ${result.status}`);});
  if(button.id==='assign-items')run(button,async()=>{
   const shipment=availableShipments.find(s=>s.id===$('#assign-shipment').value);if(!shipment)throw new Error('Choose a shipment.');
   const items=[...document.querySelectorAll('[data-allocate-item]')].filter(input=>Number(input.value)>0).map(input=>({item_id:input.dataset.allocateItem,quantity:Number(input.value)}));if(!items.length)throw new Error('Enter at least one quantity to assign.');
   await api('admin-shipments',{action:'allocate',shipment_id:shipment.id,version:shipment.version,items});await loadDetail(currentOrder.order.id);await loadOrders();
  });
  if(button.dataset.advance)run(button,async()=>{const shipment=listedShipments.find(s=>s.id===button.dataset.advance),stage=Number($(`#stage-${shipment.id}`).value);if(!confirm(`Move ${shipment.label} to “${stages[stage]}”? This updates every linked item and cannot be reversed here.`))return;await api('admin-shipments',{action:'advance',shipment_id:shipment.id,version:shipment.version,stage});await loadShipments();});
  if(button.dataset.unassign)run(button,async()=>{const shipment=listedShipments.find(s=>s.id===button.dataset.shipment);await api('admin-shipments',{action:'unassign',shipment_id:shipment.id,version:shipment.version,allocation_id:button.dataset.unassign});await loadShipments();});
 });
 $('#delivery-filter').insertAdjacentHTML('beforeend',[...stages,'Order Cancelled'].map(stage=>`<option>${esc(stage)}</option>`).join(''));
 client.auth.onAuthStateChange(()=>{clearPrivateView();setTimeout(boot,0);});boot();
})();
