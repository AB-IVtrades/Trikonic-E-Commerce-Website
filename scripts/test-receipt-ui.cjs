// Exercise the actual order renderer and download handler without a live payment.
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = readFileSync('app.js', 'utf8');
const history = { innerHTML: '', addEventListener: (_, handler) => { history.handler = handler; } };
const status = { textContent: '' };
let clicked = false, requested;
const context = vm.createContext({
  $: selector => selector === '#order-history' ? history : status,
  accountOrders: [
    { order_number: 'TRK-1794816000000-PAID', payment_status: 'paid', status: 'Payment Made', items: [], created_at: '2026-11-16', estimated_total: 850 },
    { order_number: 'TRK-1794816000000-PEND', payment_status: 'pending', status: 'Order Received', items: [], created_at: '2026-11-16', estimated_total: 25 },
    { order_number: 'TRK-1794816000000-DONE', payment_status: 'paid', status: 'Order Delivered', items: [], created_at: '2026-11-16', estimated_total: 50 }
  ],
  returnedOrderNumber: '', orderView: 'tracking', trackedOrder: 'TRK-1794816000000-PAID',
  escapeHtml: String, escapeAttr: String, money: n => `GHS ${n}`,
  supabaseConfig: { url: 'https://backend.test', publishableKey: 'public' },
  supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'customer-token' } } }) } },
  fetch: async (url, options) => { requested = { url, options }; return { ok: true, blob: async () => new Blob(['%PDF']) }; },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} }, Blob,
  document: { createElement: () => ({ click() { clicked = true; }, remove() {} }), body: { appendChild() {} } },
  setTimeout() {}
});
const start = source.indexOf('  function renderOrders()');
const end = source.indexOf('  function setAuthMode(', start);
vm.runInContext(source.slice(start, end), context);
vm.runInContext('renderOrders()', context);
assert(history.innerHTML.includes('data-receipt-order="TRK-1794816000000-PAID"'));
assert(!history.innerHTML.includes('data-receipt-order="TRK-1794816000000-PEND"'));
assert(history.innerHTML.includes('<details class="order-card" open>'));
vm.runInContext('orderView = "history"; renderOrders()', context);
assert(history.innerHTML.includes('data-receipt-order="TRK-1794816000000-DONE"'));
const button = { dataset: { receiptOrder: 'TRK-1794816000000-PAID' }, disabled: false, textContent: '' };
(async () => {
  await history.handler({ target: { closest: selector => selector === '[data-receipt-order]' ? button : null }, preventDefault() {}, stopPropagation() {} });
  assert(clicked);
  assert.equal(requested.url, 'https://backend.test/functions/v1/customer-receipt');
  assert.equal(requested.options.headers.Authorization, 'Bearer customer-token');
  assert.equal(JSON.parse(requested.options.body).orderNumber, button.dataset.receiptOrder);
  assert.equal(button.disabled, false);
  context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Payment is pending' }) });
  clicked = false;
  await history.handler({ target: { closest: selector => selector === '[data-receipt-order]' ? button : null }, preventDefault() {}, stopPropagation() {} });
  assert.equal(clicked, false);
  assert.equal(status.textContent, 'Payment is pending');
  assert.equal(button.disabled, false);
  console.log('Receipt UI passed: active and past paid orders, unpaid exclusion, authenticated download, and error handling.');
})().catch(error => { console.error(error); process.exitCode = 1; });
