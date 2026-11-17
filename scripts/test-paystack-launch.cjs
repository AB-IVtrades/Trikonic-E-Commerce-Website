const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('app.js','utf8');let invoke,deadline,aborted=false,links=[],navigated='',owner={id:'owner'};
const button={innerHTML:'Pay securely with Paystack',disabled:false,hidden:false,parentElement:{querySelectorAll:()=>links},after(link){link.previousElementSibling=button;links.push(link);}};
const status={textContent:''};
const context=vm.createContext({URL,Promise,Error,AbortController:class{signal={};abort(){aborted=true;}},signedInUser:owner,supabaseClient:{functions:{invoke:(...args)=>invoke(...args)}},setTimeout:fn=>{deadline=fn;return 1;},clearTimeout(){},document:{createElement:()=>({remove(){links=[];}})},window:{location:{assign:url=>{navigated=url;}}}});
vm.runInContext(source.slice(source.indexOf('  async function openPaystackCheckout('),source.indexOf('  async function startPaystackPayment(')),context);
(async()=>{
 invoke=async(name,options)=>{assert.equal(name,'initialize-paystack-payment');assert.equal(options.body.orderNumber,'order-1');assert(options.signal);return{data:{authorizationUrl:'https://checkout.paystack.com/saved-link'}};};
 assert(await context.openPaystackCheckout('order-1',button,status));
 assert.equal(navigated,'https://checkout.paystack.com/saved-link');assert.equal(links[0].href,navigated);assert.equal(links[0].target,'_self');assert.equal(button.disabled,false);assert(button.hidden);assert(status.textContent.includes('checkout is ready'));
 context.window.location.assign=()=>{throw new Error('Browser blocked automatic navigation');};
 assert(await context.openPaystackCheckout('order-1',button,status));assert.equal(links.length,1,'Blocked navigation must retain a single direct link');assert.equal(button.disabled,false);
 invoke=()=>new Promise(()=>{});const waiting=context.openPaystackCheckout('order-1',button,status);assert(button.disabled);deadline();assert.equal(await waiting,false);assert(aborted);assert.equal(button.disabled,false);assert.equal(button.hidden,false);assert(status.textContent.includes('do not need to create another order'));
 invoke=async()=>({data:{authorizationUrl:'https://evil.test/phishing'}});assert.equal(await context.openPaystackCheckout('order-1',button,status),false);assert.equal(links.length,0);
 invoke=async()=>({error:{message:'HTTP error',context:{json:async()=>({error:'This order is already paid.'})}}});await context.openPaystackCheckout('order-1',button,status);assert(status.textContent.includes('already paid'));
 console.log('Paystack launch passed: automatic handoff, direct-link fallback, bounded timeout, retry recovery, URL restrictions and backend errors.');
})().catch(error=>{console.error(error);process.exitCode=1;});
