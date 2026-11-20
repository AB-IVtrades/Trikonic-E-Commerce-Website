(() => {
  window.createAdminInvoices = function (catalogueUrl) {
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
    const money = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' });
    const localDate = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Accra' });
    const printDate = new Intl.DateTimeFormat('en-GH', { dateStyle: 'long', timeZone: 'UTC' });
    const formatMoney = amount => money.format(amount / 100);
    const field = name => form.elements.namedItem(name);
    const choices = new Map();
    let request;
    let loaded = false;

    function addLine(item = null) {
      const line = template.content.firstElementChild.cloneNode(true);
      if (item) {
        line.querySelector('[data-invoice-item]').value = item.name;
        line.querySelector('[data-invoice-price]').value = item.price.toFixed(2);
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
      const delivery = deliveryField.value && deliveryField.validity.valid ? Math.round(deliveryField.valueAsNumber * 100) : 0;
      byId('invoice-subtotal').value = formatMoney(subtotal);
      byId('invoice-total').value = formatMoney(subtotal + delivery);
      return { items, subtotal, delivery };
    }

    function resetDraft() {
      form.reset();
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

    async function load() {
      if (loaded || request) return;
      const controller = new AbortController();
      request = controller;
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
      } finally {
        if (request === controller) request = null;
      }
    }

    function clear() {
      request?.abort();
      request = null;
      loaded = false;
      choices.clear();
      catalogue.replaceChildren();
      search.disabled = addProduct.disabled = true;
      catalogueStatus.textContent = '';
      resetDraft();
    }

    function showError(message, input) {
      error.textContent = message;
      error.hidden = false;
      input?.focus();
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

    form.addEventListener('input', updateTotals);
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
      const blank = emptyLine();
      const line = addLine(item);
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
      field('customer').focus();
    });

    resetDraft();
    return { load, clear };
  };
})();
