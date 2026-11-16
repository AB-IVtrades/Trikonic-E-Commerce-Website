const {readFileSync}=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=readFileSync('app.js','utf8');
const els=new Map();const $=s=>{if(!els.has(s))els.set(s,{innerHTML:'',textContent:'',hidden:false});return els.get(s);};
const grid=$('#product-grid');
const products=Array.from({length:55},(_,i)=>({id:String(i),name:`Find ${i}`,category:i<30?'A':'B',price:100,shippingFee:20,description:'',colors:[],sizes:[],availability:'preorder'}));
const context=vm.createContext({$,grid,products,homeMore:null,category:'All finds',catalogState:'ready',searchTerm:'',maxPriceFilter:Infinity,productSort:'recommended',productPage:1,lastProductFilters:'',PRODUCTS_PER_PAGE:24,collection:null,collectionLabel:{},money:n=>`GHS ${Number(n).toFixed(2)}`,escapeHtml:v=>String(v).replaceAll('<','&lt;').replaceAll('>','&gt;'),escapeAttr:v=>String(v).replaceAll('"','&quot;'),resolveProductImage:String,inStockLabel:()=>'',isHairProduct:()=>false,shippingFeeFor:p=>p.shippingFee,priceFor:p=>({regular:p.price,current:p.price}),priceMarkup:p=>`GHS ${p.price}`,productStartingPrice:p=>p.price,productVariantOptions:()=>[],location:{href:'https://trikonicimports.com/shop.html'},URL,history:{replaceState(){},pushState(){}}});
vm.runInContext(app.slice(app.indexOf('  function paginatedProducts('),app.indexOf('  function renderCategories(')),context);
context.renderProducts();assert.equal((grid.innerHTML.match(/class="product-card"/g)||[]).length,24);assert($('#product-result-count').textContent.includes('1–24 of 55'));assert(!$('#product-pagination').hidden);assert(!grid.innerHTML.includes('product-shipping'), 'Shop cards must not show shipping fees');assert(grid.innerHTML.includes('GHS 100.00'));assert(!grid.innerHTML.includes('GHS 120.00'));
context.productPage=3;context.renderProducts();assert.equal((grid.innerHTML.match(/class="product-card"/g)||[]).length,7);assert($('#product-result-count').textContent.includes('49–55'));
context.category='B';context.renderProducts();assert.equal(context.productPage,1);assert($('#product-result-count').textContent.includes('of 25'));
context.productPage=50;context.renderProducts();assert.equal(context.productPage,2);
context.searchTerm='does not exist';context.renderProducts();assert.equal(context.productPage,1);assert($('#product-pagination').hidden);assert(grid.innerHTML.includes('No finds matched'));
const hostile=context.productCardMarkup({...products[0],color:'red" onmouseover="alert(1)',name:'<svg onload=alert(1)>'});assert(!hostile.includes('onmouseover'));assert(hostile.includes('&lt;svg'));
vm.runInContext(app.slice(app.indexOf('  function resolveProductImage('),app.indexOf('  function syncRequiredFields(')),context);
assert.equal(context.resolveProductImage('javascript:alert(1)'),'');assert.equal(context.resolveProductImage('//evil.test/x'),'');assert.equal(context.resolveProductImage('https://user:secret@example.test/x'),'');
for(const page of ['shop','categories'])assert(readFileSync(`${page}.html`,'utf8').includes('id="product-pagination"'));
for(const page of ['index','shop','categories','cart','contact','profile','ordering','about']){
 const html=readFileSync(`${page}.html`,'utf8');assert(!/<script[^>]*>\s*[^\s<]/.test(html),`${page} must have no inline JS`);assert(html.includes('integrity="sha384-'));assert(html.includes('Fields marked * are required.'));
}
const config=JSON.parse(readFileSync('vercel.json','utf8'));const headers=Object.fromEntries(config.headers[0].headers.map(h=>[h.key,h.value]));assert(headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));assert(!headers['Content-Security-Policy'].match(/script-src[^;]*unsafe-inline/));
// Exercise the actual receiver with mocked Sheets; no rows are written to Google.
const rows=[];let sheetAccess=0;
const sheet={getLastRow:()=>rows.length+1,getSheetByName(){},getLastColumn:()=>10,getRange:()=>({getDisplayValues:()=>rows.map(row=>[row[2]])}),appendRow:r=>rows.push(r)};
const gs=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:()=> 'server-token'})},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},Date,console});
vm.runInContext(readFileSync('google-apps-script.gs','utf8'),gs);gs.getTrikonicSpreadsheet_=()=>{sheetAccess++;return{getSheetByName:()=>sheet}};gs.ensureOrderHeaders=()=>{};
const post=payload=>JSON.parse(gs.doPost({postData:{contents:JSON.stringify(payload)}}).text);
assert.equal(post({orderId:'fake',items:[]}).ok,false);assert.equal(sheetAccess,0);
const order={token:'server-token',orderId:'TRK-test',customer:{name:'=IMPORTXML("https://evil.test")',contact:'+233000000000'},items:[],estimatedTotal:100};assert.equal(post(order).ok,false);assert.equal(rows.length,0);assert.equal(sheetAccess,0);
console.log('Storefront passed: pagination/filter resets, separate shipping, required-field UI, safe markup/URLs, CSP, retired spreadsheet order writes.');

assert(!app.includes('window.receiveTrikonicProducts'));
assert(!app.includes('script.src = url.toString()'));
assert(app.includes('/functions/v1/public-catalog'));
assert(!headers['Content-Security-Policy'].match(/script-src[^;]*script\.google/));
