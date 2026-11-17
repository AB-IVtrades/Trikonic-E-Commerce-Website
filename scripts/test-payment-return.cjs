const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const source = fs.readFileSync('app.js', 'utf8');
const restore = source.slice(source.indexOf('  function restorePaymentPage()'), source.indexOf('  if (restorePaymentPage())'));
let saved = '/cart.html?collection=preorder', replaced = '', removed = false;
const context = vm.createContext({ URL, paymentReturned: true, paymentPageKey: 'return-page', sessionStorage: { getItem: () => saved, removeItem() { removed = true; } }, location: { origin: 'https://trikonicimports.com', href: 'https://trikonicimports.com/?payment=return&reference=TRK-12345678', replace(url) { replaced = url; } } });
vm.runInContext(restore, context);
assert(context.restorePaymentPage());
assert.equal(replaced, 'https://trikonicimports.com/cart.html?collection=preorder&payment=return&reference=TRK-12345678');
assert(removed);
for (const invalid of ['https://evil.test/cart.html', '//evil.test/cart.html', '/admin.html', '/unknown']) {
 saved = invalid; replaced = ''; assert.equal(context.restorePaymentPage(), false); assert.equal(replaced, '');
}
saved = '/'; assert.equal(context.restorePaymentPage(), false, 'Same page must not redirect repeatedly');
context.paymentReturned = false; saved = '/cart.html'; assert.equal(context.restorePaymentPage(), false);
let dismissed = 0;
Object.assign(context, { paymentVerificationComplete: true, returnedOrderNumber: 'paid-order', $: () => ({ remove() { dismissed++; } }) });
vm.runInContext(source.slice(source.indexOf('  function dismissPaymentNoticeAfterReceipt('), source.indexOf('  let verifiedAdminUserId')), context);
context.dismissPaymentNoticeAfterReceipt('another-order'); assert.equal(dismissed, 0);
context.dismissPaymentNoticeAfterReceipt('paid-order'); assert.equal(dismissed, 1);
context.paymentVerificationComplete = false; context.dismissPaymentNoticeAfterReceipt('paid-order'); assert.equal(dismissed, 1);
console.log('Payment return passed: original page, query preservation, same-tab navigation, redirect allowlist, no loop, matching verified receipt dismissal.');
