const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const app = readFileSync('app.js', 'utf8');
const gs = readFileSync('google-apps-script.gs', 'utf8');
function catalog(usd = false) {
  const row = {
    SKU: 'HAIR-TEST', 'Photo URL': 'images/test.jpg', 'Show on website': true,
    'Available Sizes': '12 inches, 14 inches', 'Product Types': '2 x 4, 4 x 4',
    'Available Colors': 'Black', 'Shipping Fee (GHS)': 50,
    'Variant Prices (GHS)': '4 x 4: 100; 12 inches | 2 x 4: 250; 12 inches | 4 x 4: 300; 14 inches | 2 x 4: 320; 14" | 4×4: 350',
    'Selling Price (USD)': usd ? 16 : '', 'Variant Prices (USD)': '12 inches | 2 x 4: 20; 12 inches | 4 x 4: 24; 14 inches | 2 x 4: 25.6; 14 inches | 4 x 4: 28'
  };
  const rows = [Object.keys(row), Object.values(row)];
  const sheet = {
    getLastRow: () => rows.length, getLastColumn: () => rows[0].length,
    getRange: (r, c, n, w) => ({ getValues: () => rows.slice(r - 1, r - 1 + n).map(row => row.slice(c - 1, c - 1 + w)) })
  };
  const sheets = {
    'Website Catalog': sheet,
    Products: { getDataRange: () => ({ getValues: () => [[], [], ['SKU', 'Product Name', 'Category', 'Selling Price'], ['HAIR-TEST', 'Hair Closure', 'Hair', 200]] }) },
    'Pricing Settings': { getRange: () => ({ getValue: () => 12.5 }) }
  };
  const context = vm.createContext({ console, ContentService: { MimeType: { JAVASCRIPT: 'js', JSON: 'json', TEXT: 'text' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) } });
  vm.runInContext(gs, context);
  context.getTrikonicSpreadsheet_ = () => ({ getSheetByName: name => sheets[name] });
  const output = context.doGet({ parameter: { callback: 'receiveTrikonicProducts' } }).text;
  const data = JSON.parse(output.slice(output.indexOf('(') + 1, output.lastIndexOf(')')));
  assert.equal(data.products.length, 1);
  return data.products[0];
}
const elements = new Map();
const $ = name => { if (!elements.has(name)) elements.set(name, { textContent: '', innerHTML: '', firstChild: { textContent: '' } }); return elements.get(name); };
const context = vm.createContext({ $, products: [], cart: new Map(), money: n => `GHS ${Number(n).toFixed(2)}`, escapeHtml: String, escapeAttr: String, swatchFor: () => '#000', swatchMarkFor: () => '#fff', productGallery: () => ({ colorPhotos: new Map(), typePhotos: new Map() }), resolveProductImage: String });
vm.runInContext(app.slice(app.indexOf('  function parseCartKey('), app.indexOf('  function saveCart(')), context);
vm.runInContext(app.slice(app.indexOf('  function selectionPhoto('), app.indexOf('  function resolveProductImage(')), context);
vm.runInContext(app.slice(app.indexOf('  function shippingMarkup('), app.indexOf('  function productCardMarkup(')), context);
context.syncRequiredFields = () => {};
vm.runInContext(app.slice(app.indexOf('  function renderDetailOptions('), app.indexOf('  function openProductDetail(')), context);
for (const product of [catalog(), catalog(true)]) {
  for (const [size, variant, expected] of [['12 inches', '2 x 4', 250], ['12 inches', '4 x 4', 300], ['14 inches', '2 x 4', 320], ['14 inches', '4 x 4', 350]]) {
    assert.equal(context.regularPriceFor(product, { color: 'Black', size, variant }), expected);
    assert.equal(context.priceFor(product, { color: 'Black', size, variant }, true).current, expected + 50);
  }
  assert.equal(context.productStartingPrice(product), 300, 'Card price must reflect the lowest selectable combination plus shipping');
  assert.equal(context.priceFor({ ...product, flashSale: true, salePrice: 230 }, { size: '14 inches', variant: '4 x 4' }).current, 230);
  context.products = [product];
  const key = context.cartKey(product.id, 'Black', '14 inches', '4 x 4');
  context.cart = new Map([[key, 2]]);
  const [item] = context.cartOrderItems([key]);
  assert.equal(item.unitPrice, 350); assert.equal(item.lineTotal, 700); assert.equal(item.shippingTotal, 50);
  assert.equal(item.category, 'Hair');
  assert.equal(context.orderTotals([item]).total, 750);
  assert(context.optionDescriptions(item).includes('Hair Length: 14 inches'));
  assert(context.optionDescriptions(item).includes('Closure Size: 4 x 4'));
  context.detailProduct = product; context.detailColor = 'Black'; context.detailSize = '14 inches'; context.detailVariant = '4 x 4';
  context.renderDetailOptions();
  assert.equal($('#detail-size-group strong').textContent, 'Hair Length *');
  assert.equal($('#detail-variant-group strong').textContent, 'Closure Size *');
  assert($('#detail-price').innerHTML.includes('350.00') && $('#detail-price').innerHTML.includes('Shipping: GHS 50.00'));
  context.detailSize = ''; context.detailVariant = ''; context.renderDetailOptions();
  assert.equal($('#detail-add').disabled, true);
}
context.document = { body: { classList: { add() {} } } };
context.variantBackdrop = { classList: { add() {} }, setAttribute() {} };
vm.runInContext(app.slice(app.indexOf('  function fillVariantSelect('), app.indexOf('  function closeVariantPicker(')), context);
context.openVariantPicker(catalog());
assert.equal($('#variant-size-field').firstChild.textContent, 'Hair Length');
assert.equal($('#variant-option-field').firstChild.textContent, 'Closure Size');
assert($('#variant-size').innerHTML.includes('Choose hair length'));
assert($('#variant-option').innerHTML.includes('Choose closure size'));
const shoes = { category: 'Shoes', price: 200, colors: ['Black'], sizes: ['42'], types: [], variantPrices: [{ color: 'Black', size: '42', price: 250 }] };
assert.equal(context.regularPriceFor(shoes, { color: 'Black', size: '42' }), 250);
assert.equal(context.optionLabels({ category: 'Chairs' }).size, 'Size');
context.openVariantPicker(shoes);
assert.equal($('#variant-size-field').firstChild.textContent, 'Size');
assert.equal($('#variant-option-field').firstChild.textContent, 'Option');
context.detailProduct = shoes; context.detailSize = '42'; context.detailVariant = ''; context.renderDetailOptions();
assert.equal($('#detail-size-group strong').textContent, 'Size *');
assert.equal($('#detail-variant-group strong').textContent, 'Option *');
const fallback = { ...catalog(), variantPrices: [] };
assert.equal(context.regularPriceFor(fallback, { size: '14 inches', variant: '4 x 4' }), 200);
console.log('Hair options passed: live catalog parser, GHS/USD combinations, aliases, shipping, sale pricing, saved orders, labels, required choices and other categories.');
