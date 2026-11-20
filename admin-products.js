(() => {
  const byId = id => document.getElementById(id);
  const catalogueMoney = value => new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'GHS' }).format(value);
  const usdPrice = new Intl.NumberFormat('en-GH', { style: 'currency', currency: 'USD', currencyDisplay: 'code' });
  const lines = value => value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const options = value => [...new Set(value.split(/[,;\n]/).map(item => item.trim()).filter(Boolean))];
  const normalize = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
  const normalizeLength = value => {
    const text = normalize(value);
    const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:inches|inch|in|["″])?$/);
    return match ? Number(match[1]) + 'in' : text;
  };
  const normalizeClosure = value => {
    const text = normalize(value);
    const match = text.match(/^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*closure)?$/);
    return match ? Number(match[1]) + 'x' + Number(match[2]) : text;
  };
  const isHair = category => /\bhair\b/i.test(category);
  function optionName(list, value, format = normalize) {
    return list.find(item => format(item) === format(value));
  }

  function parseVariants(text, colors, sizes, types, hair) {
    const variants = [];
    const seen = new Map();
    const repeated = new Map();
    const entries = text.split(/[,;\r\n]+/).map(entry => entry.trim()).filter(Boolean);
    for (const [index, entry] of entries.entries()) {
      const separator = entry.lastIndexOf(':');
      const amount = separator < 0 ? NaN : Number(entry.slice(separator + 1).trim());
      const label = entry.slice(0, separator).trim();
      let parts = label.split('|').map(value => value.trim());
      if (hair && parts.length === 1 && !optionName(sizes, label, normalizeLength) &&
          !optionName(types, label, normalizeClosure)) {
        parts = label.split('+').map(value => value.trim());
      }
      if (!Number.isFinite(amount) || amount < 0.01 || amount > 10000000 || parts.length > 2 || parts.some(value => !value)) {
        throw new Error('Check variant ' + (index + 1) + ' (“' + entry.slice(0, 70) +
          '”). Use Option: price or Option | Option: price.');
      }
      const [first, second] = parts;
      let variant;
      if (second) {
        const left = hair ? optionName(sizes, first, normalizeLength) : optionName(colors, first);
        const right = hair ? optionName(types, second, normalizeClosure) : optionName(sizes, second);
        if (left && right) variant = { color: left, size: right };
      } else {
        const type = optionName(types, first, hair ? normalizeClosure : normalize);
        const color = optionName(colors, first);
        const size = optionName(sizes, first, hair ? normalizeLength : normalize);
        if (type) variant = { label: type };
        else if (color) variant = { color, size: '' };
        else if (size) variant = { color: '', size };
      }
      if (!variant) throw new Error('Add the matching options before pricing this variant: ' + first + (second ? ' | ' + second : '') + '.');
      const key = JSON.stringify(Object.values(variant).map(normalize));
      if (seen.has(key)) {
        const previous = seen.get(key);
        if (!repeated.has(key)) repeated.set(key, { label: previous.label, prices: [previous.amount] });
        repeated.get(key).prices.push(amount);
        continue;
      }
      seen.set(key, { label: parts.join(' | '), amount });
      variants.push({ ...variant, price: amount });
    }
    if (repeated.size) {
      const conflicts = Array.from(repeated.values(), entry => entry.label + ' (' + entry.prices.join(', ') + ')');
      throw new Error('Enter one price per variant. Repeated combinations and prices: ' + conflicts.join('; ') + '.');
    }
    return variants;
  }

  function photoEntries(text) {
    return text.split(/[,;\r\n]+/).map(entry => entry.trim()).filter(Boolean);
  }

  function photoReference(text) {
    const path = text.includes('|') ? text.slice(text.indexOf('|') + 1).trim() : text;
    if (!path || path.includes('|') || path.includes('\\') || path.startsWith('//')) throw new Error('Use an HTTPS photo URL or a website image path.');
    const url = new URL(path, location.origin);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.origin === location.origin)) {
      throw new Error('Use an HTTPS photo URL or a website image path.');
    }
    return text;
  }

  window.createAdminCatalog = function (client) {
    const form = byId('catalog-form');
    const rateForm = byId('catalog-rate');
    const editor = byId('catalog-editor');
    const status = byId('catalog-status');
    const saveStatus = byId('catalog-save-status');
    let rows = [];
    let exchangeRate = null;
    let editing = null;
    let page = 1;
    let sessionVersion = 0;
    let loadVersion = 0;
    let editorVersion = 0;
    const pageSize = 25;
    const field = name => form.elements.namedItem(name);
    const value = name => field(name).value.trim();
    const number = name => value(name) === '' ? null : Number(value(name));

    function announce(target, message, error = false) {
      target.textContent = message;
      target.classList.toggle('error', error);
    }
    const currencies = (amount, currency) => amount == null ? null
      : currency === 'GHS' ? Math.round((Number(amount) + Number.EPSILON) * 100) / 100
      : exchangeRate ? Math.round((Number(amount) * exchangeRate + Number.EPSILON) * 100) / 100 : null;

    function preview() {
      const hair = isHair(value('category'));
      const currency = value('currency');
      byId('catalog-selling-label').textContent = `Selling price (${currency}) *`;
      byId('catalog-sale-label').textContent = `Sale price (${currency})`;
      byId('catalog-size-label').textContent = hair ? 'Hair lengths' : 'Sizes';
      byId('catalog-type-label').textContent = hair ? 'Closure sizes' : 'Product types';
      field('sizes').placeholder = hair ? '12 inches, 14 inches' : 'S, M, L';
      field('types').placeholder = hair ? '2 x 4, 4 x 4' : 'Standard, Deluxe';
      const variantExample = hair ? '14 inches | 4 x 4: 45' : 'Black | M: 25';
      byId('catalog-variant-hint').textContent = `Enter prices in ${currency}. Separate entries with a comma or a new line. Example: ${variantExample}`;
      const regular = currencies(number('price'), currency);
      const sale = currencies(number('sale'), currency);
      const shipping = currencies(number('shipping') ?? 0, number('shipping') == null ? 'GHS' : value('shippingCurrency'));
      const cost = currencies(number('cost'), value('costCurrency'));
      const current = field('flashSale').checked && sale > 0 && sale < regular ? sale : regular;
      let summary = 'Enter a selling price to see the customer total.';
      if ((number('price') != null && regular == null) || shipping == null) {
        summary = 'Save the USD to GHS exchange rate to preview this price.';
      } else if (current != null) {
        summary = 'Storefront price: ' + catalogueMoney(current) + ' item + ' + catalogueMoney(shipping) +
          ' shipping = ' + catalogueMoney(current + shipping) + ' for one unit.';
        if (current < regular) summary += ' Regular item price ' + catalogueMoney(regular) + '.';
        if (cost != null) summary += ' Estimated item profit before shipping and fees: ' + catalogueMoney(current - cost) + '.';
      }
      byId('catalog-price-preview').textContent = summary;
      const variantPreview = byId('catalog-variant-preview');
      const variantRows = byId('catalog-variant-totals');
      variantRows.replaceChildren();
      variantPreview.hidden = true;
      if (!value('variants') || shipping == null) return;
      try {
        const variants = parseVariants(value('variants'), options(value('colors')), options(value('sizes')), options(value('types')), hair);
        for (const variant of variants) {
          const variantPrice = currencies(variant.price, currency);
          if (variantPrice == null) return;
          const itemPrice = field('flashSale').checked && sale > 0 && sale < variantPrice ? sale : variantPrice;
          const row = document.createElement('li');
          const label = variant.label || [variant.color, variant.size].filter(Boolean).join(' / ');
          row.textContent = label + ' — ' + catalogueMoney(itemPrice) + ' item + ' + catalogueMoney(shipping) +
            ' shipping = ' + catalogueMoney(itemPrice + shipping);
          variantRows.append(row);
        }
        variantPreview.hidden = !variants.length;
      } catch {
        // Incomplete lines can be edited before validation on save.
      }

    }

    function drawList() {
      const query = normalize(byId('catalog-search').value);
      const visibility = byId('catalog-visibility').value;
      const filtered = rows.filter(item => (!visibility || (visibility === 'published') === item.listed)
        && normalize([item.name, item.id, item.category].join(' ')).includes(query));
      const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
      page = Math.min(page, pages);
      const target = byId('catalog-rows');
      target.replaceChildren();
      for (const item of filtered.slice((page - 1) * pageSize, page * pageSize)) {
        const row = target.insertRow();
        const name = document.createElement('strong');
        name.textContent = item.name;
        const sku = document.createElement('small');
        sku.textContent = item.id;
        row.insertCell().append(name, sku);
        row.insertCell().textContent = item.category;
        const regular = currencies(item.price, item.currency);
        const sale = currencies(item.sale_price, item.currency);
        const onSale = item.flash_sale && sale > 0 && sale < regular;
        const priceCell = row.insertCell();
        priceCell.textContent = regular == null ? usdPrice.format(item.price) : catalogueMoney(onSale ? sale : regular);
        if (item.currency === 'USD' && regular != null) {
          const sourcePrice = document.createElement('small');
          sourcePrice.textContent = usdPrice.format(onSale ? item.sale_price : item.price);
          priceCell.append(sourcePrice);
        }
        row.insertCell().textContent = item.listed ? 'Published' : 'Hidden';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.textContent = 'Edit';
        edit.setAttribute('aria-label', 'Edit ' + item.name);
        edit.addEventListener('click', () => openExisting(item.id, edit));
        row.insertCell().append(edit);
      }
      if (!filtered.length) {
        const empty = target.insertRow().insertCell();
        empty.colSpan = 5;
        empty.textContent = 'No matching products.';
      }
      byId('catalog-prev').disabled = page <= 1;
      byId('catalog-next').disabled = page >= pages;
      byId('catalog-page').textContent = filtered.length + ' products · Page ' + page + ' of ' + pages;
    }

    async function load() {
      const version = ++loadVersion;
      const settings = await client.from('catalog_settings').select('usd_to_ghs,use_database_catalog').eq('id', true).single();
      if (version !== loadVersion) return;
      if (settings.error) throw new Error('Could not open Products. Verify your authenticator and try again.');
      const items = [];
      for (let start = 0; ; start += 500) {
        const { data, error } = await client.from('catalog_products')
          .select('id,name,category,listed,currency,price,sale_price,flash_sale')
          .order('position').range(start, start + 499);
        if (version !== loadVersion) return;
        if (error) throw new Error('Could not load the catalog.');
        items.push(...data);
        if (data.length < 500) break;
      }
      exchangeRate = settings.data.usd_to_ghs;
      rateForm.elements.rate.value = exchangeRate ?? '';
      rows = items;
      const categories = [...new Set(rows.map(row => row.category))].sort();
      byId('catalog-categories').replaceChildren(...categories.map(category => {
        const option = document.createElement('option');
        option.value = category;
        return option;
      }));
      drawList();
      preview();
      announce(status, settings.data.use_database_catalog ? '' : 'The storefront is still using the spreadsheet catalog.');
    }

    function closeEditor() {
      editorVersion++;
      editor.hidden = true;
      editing = null;
      form.reset();
      announce(saveStatus, '');
    }

    function showEditor(product = null) {
      closeEditor();
      editing = product;
      field('sku').readOnly = Boolean(product);
      if (product) {
        const d = product.details;
        const values = {
          sku: product.id, name: product.name, category: product.category,
          price: product.price, currency: product.currency, sale: product.sale_price,
          shipping: product.shipping_fee, shippingCurrency: product.shipping_currency,
          cost: product.estimated_cost, costCurrency: product.estimated_cost_currency,
          description: d.description, image: d.image, images: (d.images || []).filter(image => image !== d.image).join('\n'),
          specs: (d.specs || []).map(spec => spec.name + ': ' + spec.value).join('\n'),
          availability: d.availability, stock: d.stockQuantity, tag: d.tag, color: d.color,
          colors: (d.colors || []).join(', '), sizes: (d.sizes || []).join(', '), types: (d.types || []).join(', '),
          variants: (d.variantPrices || []).map(variant => (variant.label || [variant.color, variant.size].filter(Boolean).join(' | ')) + ': ' + variant.price).join('\n')
        };
        for (const [name, fieldValue] of Object.entries(values)) field(name).value = fieldValue ?? '';
        field('flashSale').checked = product.flash_sale;
      }
      byId('catalog-editor-title').textContent = product ? 'Edit ' + product.name : 'Add product';
      byId('catalog-save-hidden').textContent = product?.listed ? 'Save & hide' : 'Save as draft';
      editor.hidden = false;
      preview();
      byId('catalog-editor-title').focus();
    }

    async function openExisting(id, button) {
      const version = ++editorVersion;
      button.disabled = true;
      try {
        const { data, error } = await client.from('catalog_products').select('*').eq('id', id).single();
        if (version !== editorVersion) return;
        if (error) throw new Error('Could not open this product.');
        showEditor(data);
      } catch (error) {
        if (version === editorVersion) announce(status, error.message, true);
      } finally {
        button.disabled = false;
      }
    }

    function formProduct(listed) {
      const name = value('name'), category = value('category'), sku = value('sku'), image = value('image');
      const price = number('price'), sale = number('sale'), shipping = number('shipping');
      const currency = value('currency'), shippingCurrency = value('shippingCurrency');
      const flashSale = field('flashSale').checked;
      if (!name || !category || !sku || price == null) throw new Error('Enter a SKU, product name, category and selling price.');
      if (listed && !image) throw new Error('Add a main photo before publishing.');
      if (sale != null && sale >= price) throw new Error('The sale price must be below the selling price.');
      if (flashSale && sale == null) throw new Error('Enter a sale price before enabling flash sale.');
      if (listed && (currency === 'USD' || (shipping != null && shippingCurrency === 'USD')) && !exchangeRate) {
        throw new Error('Save the exchange rate in Pricing settings before publishing USD prices.');
      }
      const colors = options(value('colors')), sizes = options(value('sizes')), types = options(value('types'));
      const stock = number('stock');
      const availability = value('availability') === 'in_stock' && stock === 0 ? 'out_of_stock' : value('availability');
      const specs = lines(value('specs')).map(line => {
        const separator = line.indexOf(':');
        if (separator < 1 || !line.slice(separator + 1).trim()) throw new Error('Enter specifications as Name: value.');
        return { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() };
      });
      const photos = [...new Set([image, ...photoEntries(value('images'))].filter(Boolean).map(photoReference))];
      return {
        id: sku, name, category, listed, currency, price, sale_price: sale, flash_sale: flashSale,
        shipping_fee: shipping, shipping_currency: shippingCurrency,
        estimated_cost: number('cost'), estimated_cost_currency: value('costCurrency'),
        details: {
          description: value('description'), image, images: photos, specs, availability,
          stockQuantity: availability === 'in_stock' ? stock : null, colors, sizes, types, tag: value('tag'), color: value('color'),
          variantPrices: parseVariants(value('variants'), colors, sizes, types, isHair(category))
        }
      };
    }

    form.addEventListener('input', preview);
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const version = editorVersion;
      const session = sessionVersion;
      const buttons = [...form.querySelectorAll('[type=submit]')];
      buttons.forEach(button => { button.disabled = true; });
      announce(saveStatus, 'Saving…');
      try {
        const listed = event.submitter?.value === 'published';
        const { id, ...fields } = formProduct(listed);
        const previous = editing;
        const request = previous
          ? client.from('catalog_products').update(fields).eq('id', previous.id).eq('updated_at', previous.updated_at)
          : client.from('catalog_products').insert({ id, ...fields });
        const { data, error } = await request.select('id').maybeSingle();
        if (version !== editorVersion || session !== sessionVersion) return;
        if (error?.code === '23505') throw new Error('This SKU already exists. Find it in the product list to edit it.');
        if (error) throw new Error(error.message);
        if (!data) throw new Error('This product changed in another session. Reopen it before saving.');
        closeEditor();
        try {
          await load();
          if (session === sessionVersion) announce(status, listed ? 'Product published.' : 'Product saved and hidden.');
        } catch {
          if (session === sessionVersion) announce(status, 'Product saved. Refresh to reload the catalog list.');
        }
      } catch (error) {
        if (version === editorVersion && session === sessionVersion) announce(saveStatus, error.message, true);
      } finally {
        buttons.forEach(button => { button.disabled = false; });
      }
    });
    rateForm.addEventListener('submit', async event => {
      event.preventDefault();
      const version = sessionVersion;
      const button = event.submitter;
      if (button) button.disabled = true;
      try {
        const rate = Number(rateForm.elements.rate.value);
        const { data, error } = await client.from('catalog_settings').update({ usd_to_ghs: rate })
          .eq('id', true).select('usd_to_ghs').single();
        if (version !== sessionVersion) return;
        if (error) throw new Error(error.message);
        exchangeRate = data.usd_to_ghs;
        drawList();
        preview();
        announce(status, 'Exchange rate saved.');
      } catch (error) {
        if (version === sessionVersion) announce(status, error.message, true);
      } finally {
        if (button) button.disabled = false;
      }
    });
    byId('catalog-new').addEventListener('click', () => showEditor());
    byId('catalog-close').addEventListener('click', closeEditor);
    byId('catalog-prev').addEventListener('click', () => { page--; drawList(); });
    byId('catalog-next').addEventListener('click', () => { page++; drawList(); });
    byId('catalog-search').addEventListener('input', () => { page = 1; drawList(); });
    byId('catalog-visibility').addEventListener('change', () => { page = 1; drawList(); });

    return {
      load,
      clear() {
        sessionVersion++;
        loadVersion++;
        rows = [];
        exchangeRate = null;
        rateForm.reset();
        closeEditor();
        drawList();
        announce(status, '');
      }
    };
  };
})();
