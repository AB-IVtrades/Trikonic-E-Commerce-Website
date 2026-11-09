/**
 * Optional Google Sheets order receiver for Trikonic Imports.
 * See README.md for setup. Deploy this project as a Web App, then put its URL
 * into config.js. Do not put any Google credentials in the website.
 */
const SHEET_NAME = "Trikonic Orders";

function doPost(e) {
  try {
    const order = JSON.parse(e.postData.contents);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME)
      || SpreadsheetApp.getActiveSpreadsheet().insertSheet(SHEET_NAME);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(["Received at", "Order ID", "Customer", "Contact", "Delivery area", "Items", "Estimated total (GHS)", "Notes", "Status"]);
      sheet.setFrozenRows(1);
    }
    const items = (order.items || []).map(item => `${item.quantity} x ${item.name}${item.availability === "preorder" ? " [PRE-ORDER]" : " [IN STOCK]"} @ GHS ${item.unitPrice}`).join("; ");
    sheet.appendRow([
      new Date(), order.orderId || "", order.customer?.name || "", order.customer?.contact || "",
      order.customer?.location || "", items, Number(order.estimatedTotal || 0), order.customer?.notes || "", "New"
    ]);
    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ ok: false, error: String(error) })).setMimeType(ContentService.MimeType.JSON);
  }
}
