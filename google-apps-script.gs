/**
 * Optional Google Sheets order receiver for Trikonic Imports.
 * See README.md for setup. Deploy this project as a Web App, then put its URL
 * into config.js. Do not put any Google credentials in the website.
 */
const SHEET_NAME = "Trikonic Orders";
const CATALOG_SHEET_NAME = "Website Catalog";
const PRICING_SETTINGS_SHEET = "Pricing Settings";
const EXCHANGE_RATE_CELL = "B2";
const USD_PRICE_HEADERS = ["Selling Price (USD)", "Sale Price (USD)", "Variant Prices (USD)"];
const STOCK_QUANTITY_HEADER = "Stock Quantity";
const SHIPPING_FEE_HEADER = "Shipping Fee (GHS)";
const SPREADSHEET_ID = "1LDHrm-o9rVYudKTlaA8Jot8F3cMN2Wl1d3hiz7ohvVc";
const STATUS_SYNC_URL = "https://wxhdfrnjoohiktqujbik.supabase.co/functions/v1/order-status-sync";
const STATUS_SYNC_PROPERTY = "TRIKONIC_STATUS_SYNC_TOKEN";
const ORDER_STATUSES = ["Order Received", "Payment Made", "Order Placed", "Order Shipped", "Order Arrived in Ghana", "Order Arrived at Warehouse", "Order Ready for Collection", "Order Delivered", "Order Cancelled"];

function doGet(e) {
  // Only expose published catalog fields plus name/category/price from the inventory tab.
  // Inventory quantities, profit, customers, and orders are never returned.
  if (!e || !e.parameter || e.parameter.callback !== "receiveTrikonicProducts") {
    return ContentService.createTextOutput("Not found").setMimeType(ContentService.MimeType.TEXT);
  }
  try {
    const spreadsheet = getTrikonicSpreadsheet_();
    const catalogSheet = spreadsheet.getSheetByName(CATALOG_SHEET_NAME);
    const inventorySheet = spreadsheet.getSheetByName("Products");
    const products = [];
    const ready = Boolean(catalogSheet && catalogSheet.getLastRow() > 1);
    if (ready) {
      const rate = spreadsheet.getSheetByName(PRICING_SETTINGS_SHEET)?.getRange(EXCHANGE_RATE_CELL).getValue();
      const validRate = typeof rate === "number" && Number.isFinite(rate) && rate > 0;
      const inventoryRows = inventorySheet ? inventorySheet.getDataRange().getValues() : [];
      const headers = (inventoryRows[2] || []).map(value => String(value).trim().toLowerCase());
      const skuIndex = headers.findIndex(value => value === "sku");
      const nameIndex = headers.findIndex(value => value === "product name");
      const categoryIndex = headers.findIndex(value => value === "category");
      const priceIndex = headers.findIndex(value => value === "selling price");
      const inventory = new Map();
      if ([skuIndex, nameIndex, categoryIndex].every(index => index >= 0)) {
        inventoryRows.slice(3).forEach(row => {
          const sku = String(row[skuIndex] || "").trim();
          const name = String(row[nameIndex] || "").trim();
          const rawPrice = row[priceIndex];
          const price = typeof rawPrice === "number" ? rawPrice : Number(String(rawPrice).replace(/[^0-9.-]/g, ""));
          if (sku && name) {
            inventory.set(sku, { name, category: String(row[categoryIndex] || "Other").trim(), price });
          }
        });
      }
      const catalogHeaders = catalogSheet.getRange(1, 1, 1, catalogSheet.getLastColumn()).getValues()[0].map(value => String(value).trim().toLowerCase());
      const column = name => catalogHeaders.indexOf(name.toLowerCase());
      const rows = catalogSheet.getRange(2, 1, catalogSheet.getLastRow() - 1, catalogSheet.getLastColumn()).getValues();
      rows.forEach(row => {
        const value = name => column(name) < 0 ? "" : row[column(name)];
        const sku = value("SKU"), description = value("Description"), image = value("Photo URL");
        const rawAvailability = value("Availability"), tag = value("Tag"), color = value("Card Color"), visible = value("Show on website");
        const isVisible = visible === true || ["true", "yes", "1"].includes(String(visible).trim().toLowerCase());
        const product = inventory.get(String(sku || "").trim());
        if (!isVisible || !product || !image) return;
        const usdPrice = value(USD_PRICE_HEADERS[0]);
        const pricedInUsd = usdPrice !== "";
        const catalogPrice = raw => {
          const price = typeof raw === "number" ? raw : Number(String(raw || "").replace(/[^0-9.-]/g, ""));
          if (!Number.isFinite(price) || price <= 0) return null;
          return pricedInUsd ? Math.round(price * rate * 100) / 100 : price;
        };
        if (pricedInUsd && !validRate) {
          console.error("Enter a valid USD to GHS rate in Pricing Settings!B2 to publish USD-priced products.");
          return;
        }
        const price = pricedInUsd ? catalogPrice(usdPrice) : product.price;
        if (!Number.isFinite(price) || price <= 0) return;
        const availabilityValue = String(rawAvailability || "in_stock").trim().toLowerCase().replace(/[\s_-]/g, "");
        const rawStockQuantity = value(STOCK_QUANTITY_HEADER);
        const stockQuantity = Number.isSafeInteger(rawStockQuantity) && rawStockQuantity >= 0 ? rawStockQuantity : null;
        const availability = availabilityValue === "preorder" ? "preorder" : availabilityValue === "outofstock" || stockQuantity === 0 ? "out_of_stock" : "in_stock";
        const rawShippingFee = value(SHIPPING_FEE_HEADER);
        const shippingFee = typeof rawShippingFee === "number" && Number.isFinite(rawShippingFee) && rawShippingFee >= 0
          ? Math.round(rawShippingFee * 100) / 100
          : null;
        const flashValue = value("Flash Sale");
        const flashSaleRequested = flashValue === true || ["true", "yes", "1", "active"].includes(String(flashValue).trim().toLowerCase());
        const salePrice = catalogPrice(value(pricedInUsd ? USD_PRICE_HEADERS[1] : "Sale Price (GHS)"));
        const parseOptions = raw => [...new Set(String(raw || "").split(/[,;\n]/).map(option => option.trim()).filter(Boolean))];
        const colors = parseOptions(value("Available Colors"));
        const sizes = parseOptions(value("Available Sizes"));
        const normalizeOption = option => String(option || "").trim().toLowerCase().replace(/\s+/g, " ");
        const variantPrices = String(value(pricedInUsd ? USD_PRICE_HEADERS[2] : "Variant Prices (GHS)") || "").split(/[;,\n]/).map(entry => {
          const separator = entry.lastIndexOf(":");
          if (separator < 0) return null;
          const options = entry.slice(0, separator).split("|").map(option => option.trim());
          const rawPrice = entry.slice(separator + 1).trim();
          const price = catalogPrice(rawPrice);
          if (options.length > 2 || !Number.isFinite(price) || price <= 0) return null;
          if (options.length === 2) return { color: options[0], size: options[1], price };
          const option = options[0] || "";
          const normalized = normalizeOption(option);
          const isColor = colors.some(color => normalizeOption(color) === normalized);
          const isSize = sizes.some(size => normalizeOption(size) === normalized) || /\d\s*[x×*]\s*\d/i.test(option);
          if (isColor) return { color: option, size: "", price };
          if (isSize) return { color: "", size: option, price };
          return { color: "", size: "", label: option, price };
        }).filter(Boolean);
        const flashSale = flashSaleRequested && Number.isFinite(salePrice) && salePrice > 0 && salePrice < price;
        const photos = [...new Set([image, ...String(value("Additional Photos") || "").split(/[;,\r\n]+/)].map(photo => String(photo || "").trim()).filter(Boolean))];
        const specs = String(value("Product Specs") || "").split(/[;\n]/).map(line => {
          const separator = line.indexOf(":");
          return separator > 0 ? { name: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : null;
        }).filter(spec => spec && spec.name && spec.value);
        const safeColor = /^#[0-9a-f]{6}$/i.test(String(color).trim()) ? String(color).trim() : "#e8e4dc";
        products.push({
          id: String(sku).trim(), name: product.name, category: product.category,
          price, originalPrice: price, salePrice: flashSale ? salePrice : null, flashSale,
          description: String(description || "").trim(), image: String(image).trim(), images: photos, specs, availability,
          stockQuantity: availability === "in_stock" ? stockQuantity : null,
          colors, sizes, variantPrices, shippingFee,
          tag: String(tag || "").trim(), color: safeColor
        });
      });
    }
    const response = JSON.stringify({ ready, products });
    return ContentService.createTextOutput(`receiveTrikonicProducts(${response});`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (error) {
    console.error(error);
    return ContentService.createTextOutput("receiveTrikonicProducts(null);").setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// This Apps Script is deployed as a standalone web app, so it must open the
// known spreadsheet explicitly instead of relying on an active spreadsheet.
function getTrikonicSpreadsheet_() {
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    if (payload.action === "cancelOrder") return cancelOrderInSheet(payload);
    if (payload.action === "paymentMade") return markPaymentMadeInSheet(payload);
    const order = payload;
    const sheet = getTrikonicSpreadsheet_().getSheetByName(SHEET_NAME)
      || getTrikonicSpreadsheet_().insertSheet(SHEET_NAME);
    ensureOrderHeaders(sheet);
    const items = (order.items || []).map(item => `${item.quantity} x ${item.name}${item.color ? ` [Color: ${item.color}]` : ""}${item.size ? ` [Size: ${item.size}]` : ""}${item.variant ? ` [Option: ${item.variant}]` : ""}${item.availability === "preorder" ? " [PRE-ORDER]" : item.availability === "out_of_stock" ? " [OUT OF STOCK]" : " [IN STOCK]"}${item.flashSale ? " [FLASH SALE]" : ""} @ GHS ${item.unitPrice}`).join("; ");
    const receivedAt = new Date();
    const orderRow = [
      receivedAt, receivedAt, order.orderId || "", order.customer?.name || "", order.customer?.contact || "",
      order.customer?.location || "", items, Number(order.estimatedTotal || 0), order.customer?.notes || "", "Order Received"
    ];
    if (typeof order.shippingTotal === "number" && Number.isFinite(order.shippingTotal) && order.shippingTotal >= 0) {
      const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      const shippingColumn = headers.includes(SHIPPING_FEE_HEADER) ? headers.indexOf(SHIPPING_FEE_HEADER) + 1 : headers.length + 1;
      if (shippingColumn > headers.length) {
        if (shippingColumn > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
        sheet.getRange(1, shippingColumn).setValue(SHIPPING_FEE_HEADER);
        sheet.getRange(2, shippingColumn, sheet.getMaxRows() - 1, 1).setNumberFormat("0.00");
      }
      while (orderRow.length < shippingColumn) orderRow.push("");
      orderRow[shippingColumn - 1] = order.shippingTotal;
    }
    sheet.appendRow(orderRow);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Called by the verified Paystack webhook through the server-side Edge Function.
function markPaymentMadeInSheet(payload) {
  const token = PropertiesService.getScriptProperties().getProperty(STATUS_SYNC_PROPERTY) || "";
  if (!token || !payload.token || payload.token !== token) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" })).setMimeType(ContentService.MimeType.JSON);
  }
  const orderNumber = String(payload.orderNumber || "").trim();
  if (!/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Invalid order number" })).setMimeType(ContentService.MimeType.JSON);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getTrikonicSpreadsheet_().getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) throw new Error("Order not found");
    ensureOrderHeaders(sheet);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(value => String(value).trim().toLowerCase());
    const idColumn = headers.indexOf("order id") + 1, statusColumn = headers.indexOf("status") + 1;
    if (!idColumn || !statusColumn) throw new Error("Order sheet headers are missing");
    const ids = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
    const index = ids.findIndex(value => String(value).trim() === orderNumber);
    if (index < 0) throw new Error("Order not found in the order sheet");
    const cell = sheet.getRange(index + 2, statusColumn);
    const currentStatus = String(cell.getDisplayValue()).trim();
    if (currentStatus === "Order Received") cell.setValue("Payment Made");
    else if (currentStatus !== "Payment Made") return ContentService.createTextOutput(JSON.stringify({ ok: true, unchanged: true, status: currentStatus })).setMimeType(ContentService.MimeType.JSON);
    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: "Payment Made" })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Called by the authenticated customer-cancel-order Edge Function only.
function cancelOrderInSheet(payload) {
  const token = PropertiesService.getScriptProperties().getProperty(STATUS_SYNC_PROPERTY) || "";
  if (!token || !payload.token || payload.token !== token) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Unauthorized" })).setMimeType(ContentService.MimeType.JSON);
  }
  const orderNumber = String(payload.orderNumber || "").trim();
  if (!/^TRK-[0-9]{13}-[A-Z0-9]{4}$/.test(orderNumber)) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: "Invalid order number" })).setMimeType(ContentService.MimeType.JSON);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getTrikonicSpreadsheet_().getSheetByName(SHEET_NAME);
    if (!sheet || sheet.getLastRow() < 2) throw new Error("Order not found");
    ensureOrderHeaders(sheet);
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(value => String(value).trim().toLowerCase());
    const idColumn = headers.indexOf("order id") + 1;
    const statusColumn = headers.indexOf("status") + 1;
    if (!idColumn || !statusColumn) throw new Error("Order sheet headers are missing");
    const ids = sheet.getRange(2, idColumn, sheet.getLastRow() - 1, 1).getDisplayValues().flat();
    const index = ids.findIndex(value => String(value).trim() === orderNumber);
    if (index < 0) throw new Error("Order not found in the order sheet");
    const row = index + 2;
    const currentStatus = String(sheet.getRange(row, statusColumn).getDisplayValue()).trim();
    if (currentStatus === "Order Cancelled") {
      return ContentService.createTextOutput(JSON.stringify({ ok: true, unchanged: true, status: currentStatus })).setMimeType(ContentService.MimeType.JSON);
    }
    if (!["Order Received", "Payment Made", "Order Placed"].includes(currentStatus)) {
      throw new Error("This order can no longer be cancelled because it has been shipped or completed");
    }
    sheet.getRange(row, statusColumn).setValue("Order Cancelled");
    return ContentService.createTextOutput(JSON.stringify({ ok: true, status: "Order Cancelled" })).setMimeType(ContentService.MimeType.JSON);
  } finally {
    lock.releaseLock();
  }
}

// Run once to add missing catalog columns and refresh validation rules.
function setupTrikonicCatalogSheet() {
  const spreadsheet = getTrikonicSpreadsheet_();
  const pricingSettings = spreadsheet.getSheetByName(PRICING_SETTINGS_SHEET) || spreadsheet.insertSheet(PRICING_SETTINGS_SHEET);
  pricingSettings.getRange("A2").setValue("GHS per US$1");
  const positiveNumberRule = SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).build();
  pricingSettings.getRange(EXCHANGE_RATE_CELL).setNumberFormat("0.0000").setDataValidation(positiveNumberRule);
  const sheet = spreadsheet.getSheetByName(CATALOG_SHEET_NAME) || spreadsheet.insertSheet(CATALOG_SHEET_NAME);
  ensureCatalogHeaders(sheet);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(value => String(value).trim().toLowerCase());
  const availabilityColumn = headers.indexOf("availability") + 1;
  const flashColumn = headers.indexOf("flash sale") + 1;
  const salePriceColumn = headers.indexOf("sale price (ghs)") + 1;
  const colorsColumn = headers.indexOf("available colors") + 1;
  const sizesColumn = headers.indexOf("available sizes") + 1;
  const variantPricesColumn = headers.indexOf("variant prices (ghs)") + 1;
  const shippingColumn = headers.indexOf(SHIPPING_FEE_HEADER.toLowerCase()) + 1;
  const stockQuantityColumn = headers.indexOf(STOCK_QUANTITY_HEADER.toLowerCase()) + 1;
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  USD_PRICE_HEADERS.slice(0, 2).forEach(header => {
    const column = headers.indexOf(header.toLowerCase()) + 1;
    sheet.getRange(2, column, rows, 1).setNumberFormat("0.00").setDataValidation(positiveNumberRule);
  });
  sheet.getRange(2, headers.indexOf(USD_PRICE_HEADERS[2].toLowerCase()) + 1, rows, 1).clearDataValidations();
  sheet.getRange(2, availabilityColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["In Stock", "Pre-Order", "Out of Stock"], true).setAllowInvalid(false).build()
  );
  sheet.getRange(2, flashColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(["TRUE", "FALSE"], true).setAllowInvalid(false).build()
  );
  sheet.getRange(2, salePriceColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireNumberGreaterThan(0).setAllowInvalid(false).build()
  );
  sheet.getRange(2, shippingColumn, rows, 1).setNumberFormat("0.00").setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireNumberGreaterThanOrEqualTo(0)
      .setAllowInvalid(false)
      .setHelpText("Enter shipping per unit in GHS. Leave blank if shipping is included in the item price.")
      .build()
  );
  const stockCell = sheet.getRange(2, stockQuantityColumn).getA1Notation();
  sheet.getRange(2, stockQuantityColumn, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation()
      .requireFormulaSatisfied(`=OR(ISBLANK(${stockCell}),AND(ISNUMBER(${stockCell}),${stockCell}>=0,MOD(${stockCell},1)=0))`)
      .setAllowInvalid(false)
      .setHelpText("Enter a whole number of units, or leave the cell blank.")
      .build()
  );
  // These are free-text, comma-separated option lists. Clear any dropdown rules
  // inherited when the new columns were created or copied from another column.
  sheet.getRange(2, colorsColumn, rows, 1).clearDataValidations();
  sheet.getRange(2, sizesColumn, rows, 1).clearDataValidations();
  sheet.getRange(2, variantPricesColumn, rows, 1).clearDataValidations();
  sheet.setFrozenRows(1);
}

function ensureCatalogHeaders(sheet) {
  const defaultHeaders = ["SKU", "Description", "Photo URL", "Availability", "Tag", "Card Color", "Show on website"];
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, defaultHeaders.length).setValues([defaultHeaders]);
  const width = Math.max(sheet.getLastColumn(), defaultHeaders.length);
  const current = sheet.getRange(1, 1, 1, width).getValues()[0].map(value => String(value).trim().toLowerCase());
  ["Flash Sale", "Sale Price (GHS)", "Available Colors", "Available Sizes", "Variant Prices (GHS)", "Additional Photos", "Product Specs", STOCK_QUANTITY_HEADER, SHIPPING_FEE_HEADER, ...USD_PRICE_HEADERS].forEach(header => {
    if (!current.includes(header.toLowerCase())) {
      const nextColumn = sheet.getLastColumn() + 1;
      if (nextColumn > sheet.getMaxColumns()) sheet.insertColumnAfter(sheet.getMaxColumns());
      sheet.getRange(1, nextColumn).setValue(header);
      current.push(header.toLowerCase());
    }
  });
}

// Run once from the Apps Script editor to add/backfill the date and time columns now.
function setupTrikonicOrdersSheet() {
  const spreadsheet = getTrikonicSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME) || spreadsheet.insertSheet(SHEET_NAME);
  ensureOrderHeaders(sheet);
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(ORDER_STATUSES, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, 10, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(statusRule);
}

// Run once after setting TRIKONIC_STATUS_SYNC_TOKEN in Project Settings > Script properties.
function setupOrderStatusSync() {
  const token = PropertiesService.getScriptProperties().getProperty(STATUS_SYNC_PROPERTY);
  if (!token) throw new Error(`Add ${STATUS_SYNC_PROPERTY} in Project Settings > Script properties before running setupOrderStatusSync.`);
  const spreadsheet = getTrikonicSpreadsheet_();
  const sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_NAME}" was not found. Run setupTrikonicOrdersSheet first.`);
  ensureOrderHeaders(sheet);
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === "syncTrikonicOrderStatusOnEdit")
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger("syncTrikonicOrderStatusOnEdit")
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
}

// Run once manually to grant this Apps Script project external-request permission.
// The edit trigger cannot display Google's authorization prompt on its own.
function authorizeTrikonicStatusSync() {
  const response = UrlFetchApp.fetch("https://www.google.com/generate_204", {
    muteHttpExceptions: true
  });
  console.log(`External request permission authorized (HTTP ${response.getResponseCode()}).`);
}

// An installable onEdit trigger sends only the order number and status, never customer data.
function syncTrikonicOrderStatusOnEdit(event) {
  if (!event || !event.range) return;
  const range = event.range;
  const sheet = range.getSheet();
  if (sheet.getName() !== SHEET_NAME || range.getRow() < 2 || range.getColumn() !== 10) return;

  const orderNumber = String(sheet.getRange(range.getRow(), 3).getDisplayValue() || "").trim();
  const status = String(range.getDisplayValue() || "").trim();
  if (!orderNumber || !ORDER_STATUSES.includes(status)) return;

  const token = PropertiesService.getScriptProperties().getProperty(STATUS_SYNC_PROPERTY);
  if (!token) {
    range.setNote(`Status was not synced. Add ${STATUS_SYNC_PROPERTY} in Apps Script Project Settings.`);
    return;
  }

  try {
    const response = UrlFetchApp.fetch(STATUS_SYNC_URL, {
      method: "post",
      contentType: "application/json",
      headers: { Authorization: `Bearer ${token}` },
      payload: JSON.stringify({ orderNumber, status }),
      muteHttpExceptions: true
    });
    const code = response.getResponseCode();
    if (code < 200 || code >= 300) {
      range.setNote(`Status sync failed (HTTP ${code}). Check the order number, status, and Supabase status-sync setup.`);
      console.error(`Order status sync failed with HTTP ${code}: ${response.getContentText()}`);
      return;
    }
    range.setNote(`Synced to customer order tracking on ${new Date().toLocaleString()}.`);
  } catch (error) {
    range.setNote("Status sync failed. Check Apps Script execution history and the Supabase status-sync setup.");
    console.error(error);
  }
}

function ensureOrderHeaders(sheet) {
  const headers = ["Order Date", "Order Time", "Order ID", "Customer", "Contact", "Delivery area", "Items", "Estimated total (GHS)", "Notes", "Status"];
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else {
    const lastColumn = Math.max(sheet.getLastColumn(), 1);
    const current = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value).trim());
    if (current[0] === "Received at" && current[1] !== "Order Time") {
      // Preserve existing order columns while splitting the timestamp into date and time.
      sheet.insertColumnAfter(1);
      sheet.getRange(1, 1, 1, 2).setValues([["Order Date", "Order Time"]]);
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const timestamps = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
        sheet.getRange(2, 2, timestamps.length, 1).setValues(timestamps);
      }
    } else if (current[0] !== "Order Date" || current[1] !== "Order Time") {
      throw new Error("The Trikonic Orders header row is unexpected. Please check it before accepting orders.");
    }
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  sheet.getRange("A:A").setNumberFormat("dd mmm yyyy");
  sheet.getRange("B:B").setNumberFormat("hh:mm:ss AM/PM");
}
