(() => {
  window.createAdminInvoices = function (catalogueUrl, client) {
    const byId = id => document.getElementById(id);
    const form = byId('invoice-form');
    const lines = byId('invoice-lines');
    const template = byId('invoice-line-template');
    const print = byId('invoice-print');
    const search = byId('invoice-product');
    const catalogue = byId('invoice-catalogue');
    const addProduct = byId('invoice-add-product');
    const catalogueStatus = byId('invoice-catalogue-status');
    const error = byId('invoice-error');
    const money = {
      GHS: new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }),
      USD: new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'USD', currencyDisplay: 'code' })
    };
    const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Accra' });
    const printDate = new Intl.DateTimeFormat('en-GH', { dateStyle: 'long', timeZone: 'UTC' });
    const formatMoney = amount => money[currency].format(amount / 100);
    const field = name => form.elements.namedItem(name);
    const choices = new Map();
    const originalAmounts = new WeakMap();
    const currencyField = field('currency');
    let currency = currencyField.value;
    let exchangeRate = null;
    let request;
    let loaded = false;

    function convertMinor(amount, from, to) {
      if (from === to || amount === 0) return amount;
      return Math.round(from === 'USD' ? amount * exchangeRate : amount / exchangeRate);
    }

    function addLine(item = null, amount = 0) {
      const line = template.content.firstElementChild.cloneNode(true);
      if (item) {
        line.querySelector('[data-invoice-item]').value = item.name;
        const input = line.querySelector('[data-invoice-price]');
        input.value = (amount / 100).toFixed(2);
        originalAmounts.set(input, { currency: 'GHS', amount: Math.round(item.price * 100) });
      }
      lines.append(line);
      return line;
    }

    function emptyLine() {
      return Array.from(lines.children).find(line =>
        !line.querySelector('[data-invoice-item]').value.trim() &&
        !line.querySelector('[data-invoice-price]').value);
    }

    function readLines() {
      return Array.from(lines.children, line => {
        line.querySelector('[data-invoice-price-label]').textContent = `Unit price (${currency})`;
        const name = line.querySelector('[data-invoice-item]').value.trim();
        const quantity = line.querySelector('[data-invoice-quantity]');
        const price = line.querySelector('[data-invoice-price]');
        const cents = price.validity.valid ? Math.round(price.valueAsNumber * 100) : 0;
        const amount = quantity.validity.valid ? quantity.valueAsNumber * cents : 0;
        line.querySelector('output').value = price.validity.valid && quantity.validity.valid ? formatMoney(amount) : '—';
        return { name, quantity: quantity.valueAsNumber, cents, amount };
      });
    }

    function updateTotals() {
      print.hidden = true;
      error.hidden = true;
      const items = readLines();
      const subtotal = items.reduce((total, item) => total + item.amount, 0);
      const deliveryField = field('delivery');
      byId('invoice-delivery-label').textContent = `Delivery fee (${currency})`;
      const delivery = deliveryField.value && deliveryField.validity.valid ? Math.round(deliveryField.valueAsNumber * 100) : 0;
      byId('invoice-subtotal').value = formatMoney(subtotal);
      byId('invoice-total').value = formatMoney(subtotal + delivery);
      return { items, subtotal, delivery };
    }

    function resetDraft() {
      form.reset();
      currency = currencyField.value;
      originalAmounts.delete(field('delivery'));
      lines.replaceChildren();
      const date = localDate.format(new Date());
      field('date').value = date;
      field('number').value = 'INV-' + date.replaceAll('-', '') + '-' + crypto.randomUUID().slice(0, 8).toUpperCase();
      addLine();
      updateTotals();
      for (const id of ['number', 'date', 'customer', 'contact', 'lines', 'notes']) {
        byId('invoice-print-' + id).replaceChildren();
      }
    }

    async function loadCatalogue(controller) {
      catalogueStatus.textContent = 'Loading catalogue…';
      try {
        const response = await fetch(catalogueUrl, {
          credentials: 'omit',
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)])
        });
        if (!response.ok) throw new Error('Catalogue request failed');
        const data = await response.json();
        if (!data?.ready || !Array.isArray(data.products)) throw new Error('Invalid catalogue');
        if (request !== controller) return;
        const options = document.createDocumentFragment();
        for (const product of data.products) {
          if (!product?.name || !product.id) continue;
          const variants = Array.isArray(product.variantPrices) ? product.variantPrices : [];
          for (const variant of [{ price: product.price }, ...variants]) {
            const regular = Number(variant.price);
            if (!Number.isFinite(regular) || regular <= 0) continue;
            const sale = Number(product.salePrice);
            const price = product.flashSale && sale > 0 && sale < regular ? sale : regular;
            const variantName = variant.label || [variant.color, variant.size].filter(Boolean).join(' / ');
            const name = [product.name, variantName].filter(Boolean).join(' · ');
            const label = name + ' [' + product.id + ']';
            choices.set(label, { name, price });
          }
        }
        for (const label of [...choices.keys()].sort((a, b) => a.localeCompare(b))) {
          const option = document.createElement('option');
          option.value = label;
          options.append(option);
        }
        catalogue.replaceChildren(options);
        loaded = true;
        search.disabled = addProduct.disabled = !choices.size;
        catalogueStatus.textContent = choices.size ? '' : 'No products are available. You can add items manually.';
      } catch {
        if (request === controller) catalogueStatus.textContent = 'Could not load the catalogue. Use Refresh to retry or add items manually.';
      }
    }

    async function loadRate(controller) {
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]);
        const { data, error } = await client.from('catalog_settings').select('usd_to_ghs')
          .eq('id', true).abortSignal(signal).single();
        if (request !== controller) return;
        const rate = Number(data?.usd_to_ghs);
        if (error || !Number.isFinite(rate) || rate <= 0) throw new Error('Exchange rate unavailable');
        exchangeRate = rate;
        byId('invoice-rate').textContent = `Converts at ${rate} GHS per USD. Enter item prices and delivery in the invoice currency.`;
      } catch {
        if (request === controller) {
          byId('invoice-rate').textContent = 'Exchange rate unavailable. Use Refresh to retry, or enter amounts manually in the invoice currency.';
        }
      }
    }

    async function load() {
      if (request || (loaded && exchangeRate)) return;
      const controller = new AbortController();
      request = controller;
      await Promise.all([loaded || loadCatalogue(controller), exchangeRate || loadRate(controller)]);
      if (request === controller) request = null;
    }

    function clear() {
      request?.abort();
      request = null;
      loaded = false;
      exchangeRate = null;
      choices.clear();
      catalogue.replaceChildren();
      search.disabled = addProduct.disabled = true;
      catalogueStatus.textContent = '';
      byId('invoice-rate').textContent = 'Enter item prices and delivery in the invoice currency.';
      resetDraft();
    }

    function showError(message, input) {
      error.textContent = message;
      error.hidden = false;
      input?.focus();
    }

    function switchCurrency() {
      const next = currencyField.value;
      if (next === currency) return;
      const inputs = [field('delivery'), ...lines.querySelectorAll('[data-invoice-price]')];
      const updates = [];
      for (const input of inputs) {
        let message;
        if (input.validity.badInput || (input.value && !input.validity.valid)) {
          message = 'Correct the highlighted amount before switching currency.';
        } else if (input.value) {
          const original = originalAmounts.get(input) ?? { currency, amount: Math.round(input.valueAsNumber * 100) };
          if (!exchangeRate && original.amount && original.currency !== next) {
            message = 'Load the exchange rate with Refresh before converting this invoice.';
          } else {
            const amount = convertMinor(original.amount, original.currency, next);
            if (amount > Number(input.max) * 100) message = 'The converted amount exceeds the invoice price limit.';
            else updates.push({ input, original, amount });
          }
        }
        if (message) {
          currencyField.value = currency;
          showError(message, input);
          return;
        }
      }
      for (const { input, original, amount } of updates) {
        originalAmounts.set(input, original);
        input.value = (amount / 100).toFixed(2);
      }
      currency = next;
      updateTotals();
    }

    function printInvoice(event) {
      event.preventDefault();
      if (byId('workspace').hidden || byId('invoices').hidden) return;
      const { items, subtotal, delivery } = updateTotals();
      const customer = field('customer').value.trim();
      const number = field('number').value.trim();
      const blank = items.findIndex(item => !item.name);
      if (!customer || !number) return showError('Enter the customer name and invoice number.', field(customer ? 'number' : 'customer'));
      if (blank >= 0) return showError('Enter a description for each item.', lines.children[blank].querySelector('input'));

      const values = {
        number,
        date: printDate.format(new Date(field('date').value + 'T00:00:00Z')),
        customer,
        contact: field('contact').value.trim(),
        notes: field('notes').value.trim(),
        subtotal: formatMoney(subtotal),
        delivery: formatMoney(delivery),
        total: formatMoney(subtotal + delivery)
      };
      for (const [key, value] of Object.entries(values)) byId('invoice-print-' + key).textContent = value;
      const rows = document.createDocumentFragment();
      for (const item of items) {
        const row = document.createElement('tr');
        for (const value of [item.name, item.quantity, formatMoney(item.cents), formatMoney(item.amount)]) {
          row.insertCell().textContent = value;
        }
        rows.append(row);
      }
      byId('invoice-print-lines').replaceChildren(rows);
      byId('invoice-print-delivery-row').hidden = delivery === 0;
      print.hidden = false;
      window.print();
    }

    form.addEventListener('input', event => {
      if (event.target === currencyField) return;
      originalAmounts.delete(event.target);
      updateTotals();
    });
    currencyField.addEventListener('change', switchCurrency);
    form.addEventListener('submit', printInvoice);
    window.addEventListener('afterprint', () => { print.hidden = true; });
    byId('invoice-add-line').addEventListener('click', () => {
      (emptyLine() || addLine()).querySelector('input').focus();
      updateTotals();
    });
    addProduct.addEventListener('click', () => {
      const item = choices.get(search.value.trim());
      if (!item) {
        catalogueStatus.textContent = 'Choose a product from the search suggestions.';
        search.focus();
        return;
      }
      if (currency === 'USD' && !exchangeRate) {
        showError('Load the exchange rate with Refresh before adding a catalogue product in USD.', search);
        return;
      }
      const amount = convertMinor(Math.round(item.price * 100), 'GHS', currency);
      if (amount > Number(template.content.querySelector('[data-invoice-price]').max) * 100) {
        showError('The catalogue price exceeds the invoice price limit. Enter a unit price manually.', search);
        return;
      }
      const blank = emptyLine();
      const line = addLine(item, amount);
      if (blank) blank.replaceWith(line);
      line.querySelector('[data-invoice-quantity]').focus();
      search.value = '';
      catalogueStatus.textContent = '';
      updateTotals();
    });
    search.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        addProduct.click();
      }
    });
    lines.addEventListener('click', event => {
      const button = event.target.closest('[data-invoice-remove]');
      if (!button) return;
      const line = button.closest('.invoice-line');
      const sibling = line.nextElementSibling || line.previousElementSibling;
      line.remove();
      (sibling || addLine()).querySelector('input').focus();
      updateTotals();
    });
    byId('invoice-new').addEventListener('click', () => {
      if (!window.confirm('Start a new invoice? This clears the current draft.')) return;
      resetDraft();
      exchangeRate = null;
      byId('invoice-rate').textContent = 'Enter item prices and delivery in the invoice currency.';
      load();
      field('customer').focus();
    });

    resetDraft();
    return { load, clear };
  };
})();
