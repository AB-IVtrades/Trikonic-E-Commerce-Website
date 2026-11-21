import { environment, RequestError } from "./server.ts";
function normalizeVariantOption(value: unknown) {
  return String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ")
    .toLocaleLowerCase();
}
function isHairProduct(product: any) {
  return /\bhair\b/i.test(String(product?.category || ""));
}
function normalizeHairLength(value: unknown) {
  const text = normalizeVariantOption(value);
  const match = text.match(/^(\d+(?:\.\d+)?)\s*(?:inches|inch|in|["″])?$/);
  return match ? `${Number(match[1])}in` : text;
}
function normalizeClosureSize(value: unknown) {
  const text = normalizeVariantOption(value);
  const match = text.match(
    /^(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)(?:\s*closure)?$/,
  );
  return match ? `${Number(match[1])}x${Number(match[2])}` : text;
}
function productVariantOptions(product: any): string[] {
  if (product?.types?.length) return product.types;
  return [
    ...new Set<string>(
      (product?.variantPrices || []).map((option: any) =>
        String(option.label || "").trim()
      ).filter(Boolean),
    ),
  ];
}
function regularPriceFor(product: any, selection: any = {}) {
  const prices = product?.variantPrices || [];
  const color = normalizeVariantOption(selection.color),
    size = normalizeVariantOption(selection.size);
  const find = (matchColor: string, matchSize: string) =>
    prices.find((option: any) =>
      normalizeVariantOption(option.color) === matchColor &&
      normalizeVariantOption(option.size) === matchSize
    );
  const variant = normalizeVariantOption(selection.variant);
  // The existing Sheet API serializes two-part rules as color/size. For hair,
  // those same two fields represent Hair Length | Closure Size.
  const hairCombination = isHairProduct(product) && selection.size &&
    selection.variant &&
    prices.find((option: any) =>
      normalizeHairLength(option.color) ===
        normalizeHairLength(selection.size) &&
      normalizeClosureSize(option.size) ===
        normalizeClosureSize(selection.variant)
    );
  const match = hairCombination || (color && size && find(color, size)) ||
    (variant &&
      prices.find((option: any) =>
        normalizeVariantOption(option.label) === variant
      )) ||
    (color && find(color, "")) || (size && find("", size));
  return Number(match?.price) || Number(product?.price) || 0;
}
function shippingFeeFor(product: any) {
  const fee = product?.shippingFee == null ? NaN : Number(product.shippingFee);
  return Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : null;
}
function priceFor(product: any, selection: any = {}, includeShipping = false) {
  const regular = regularPriceFor(product, selection);
  const sale = Number(product?.salePrice);
  const onSale = Boolean(product?.flashSale && sale > 0 && sale < regular);
  const current = onSale ? sale : regular;
  if (!includeShipping) return { regular, current, onSale };
  const shippingCents = Math.round((shippingFeeFor(product) || 0) * 100);
  return {
    regular: (Math.round(regular * 100) + shippingCents) / 100,
    current: (Math.round(current * 100) + shippingCents) / 100,
    onSale,
  };
}
export async function loadCatalog() {
  const endpoint = Deno.env.get("APPS_SCRIPT_ORDER_ENDPOINT") || "";
  if (!endpoint) {
    throw new RequestError(
      "The product catalog is temporarily unavailable.",
      503,
    );
  }
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.hostname !== "script.google.com") {
    throw new RequestError("Catalog configuration is invalid.", 503);
  }
  url.searchParams.set("callback", "receiveTrikonicProducts");
  url.searchParams.set("t", String(Date.now()));
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!response.ok) {
    throw new RequestError(
      "Could not check current product prices. Please try again.",
      503,
    );
  }
  const body = await response.text();
  if (!body.startsWith("receiveTrikonicProducts(")) {
    throw new RequestError("Product prices are unavailable.", 503);
  }
  const catalog = JSON.parse(
    body.slice(body.indexOf("(") + 1, body.lastIndexOf(")")),
  );
  if (!catalog.ready || !Array.isArray(catalog.products)) {
    throw new RequestError("Product prices are unavailable.", 503);
  }
  return catalog.products;
}
function trustedPhoto(product: any, requested: unknown) {
  // Keep the selected receipt photo, but accept only URLs from the trusted catalog.
  const clean = (value: unknown) => {
    const text = String(value || "");
    const path = text.includes("|")
      ? text.slice(text.indexOf("|") + 1).trim()
      : text.trim();
    try {
      return new URL(path, "https://trikonicimports.com/").href;
    } catch {
      return "";
    }
  };
  const photos = [product.image, ...(product.images || [])].filter(Boolean).map(
    clean,
  );
  const selected = clean(requested);
  const withoutVersion = (value: string) => {
    const url = new URL(value);
    url.searchParams.delete("v");
    return url.href;
  };
  return photos.find((photo: string) =>
    photo && selected && withoutVersion(photo) === withoutVersion(selected)
  ) || photos[0] || "";
}
export function priceOrder(requested: any[], catalog: any[]) {
  if (
    !Array.isArray(requested) || !requested.length || requested.length > 100
  ) throw new RequestError("Please review your cart.");
  const seen = new Set<string>(), quantities = new Map<string, number>();
  let amount = 0;
  const items = requested.map((input) => {
    const product = catalog.find((p) => p.id === input.id);
    if (!product || product.availability === "out_of_stock") {
      throw new RequestError(
        "An item is unavailable. Please refresh your cart.",
        409,
      );
    }
    const quantity = input.quantity;
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000) {
      throw new RequestError("Invalid item quantity.");
    }
    const canonical = (values: string[], value: unknown) => {
      if (!values?.length) {
        if (value) throw new RequestError("Invalid product option.");
        return "";
      }
      const match = values.find((v) =>
        normalizeVariantOption(v) === normalizeVariantOption(value)
      );
      if (!match) {
        throw new RequestError(
          "Please choose the available product options.",
          409,
        );
      }
      return match;
    };
    const color = canonical(product.colors, input.color),
      size = canonical(product.sizes, input.size),
      variant = canonical(productVariantOptions(product), input.variant);
    const signature = JSON.stringify([product.id, color, size, variant]);
    if (seen.has(signature)) {
      throw new RequestError("Duplicate cart selection.");
    }
    seen.add(signature);
    quantities.set(product.id, (quantities.get(product.id) || 0) + quantity);
    if (
      Number.isSafeInteger(product.stockQuantity) &&
      quantities.get(product.id)! > product.stockQuantity
    ) {
      throw new RequestError(
        "The requested quantity is no longer in stock.",
        409,
      );
    }
    const { current, regular, onSale } = priceFor(product, {
      color,
      size,
      variant,
    });
    const unitCents = Math.round(current * 100);
    const shippingFee = shippingFeeFor(product);
    const shippingCents = shippingFee == null
      ? null
      : Math.round(shippingFee * 100) * quantity;
    if (!Number.isSafeInteger(unitCents) || unitCents < 1) {
      throw new RequestError("Invalid catalog price.", 503);
    }
    const lineTotal = unitCents * quantity / 100;
    amount += unitCents * quantity + (shippingCents ?? 0);
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      image: trustedPhoto(product, input.image),
      color,
      size,
      variant,
      availability: product.availability,
      flashSale: onSale,
      quantity,
      unitPrice: unitCents / 100,
      originalUnitPrice: regular,
      lineTotal,
      shippingTotal: shippingCents == null ? null : shippingCents / 100,
    };
  });
  if (!Number.isSafeInteger(amount) || amount < 1) {
    throw new RequestError("Invalid order total.");
  }
  return { items, total: amount / 100, amount };
}
export async function assertTrustedPricing(order: any) {
  if (order.pricing_verified_at) return;
  const checked = priceOrder(order.items, await loadCatalog());
  if (
    checked.amount !== Math.round(Number(order.estimated_total) * 100) ||
    order.currency !== "GHS"
  ) {
    throw new RequestError(
      "This order needs a new price check. Please place a new order from your cart.",
      409,
    );
  }
  const env = environment();
  const pricing_verified_at = new Date().toISOString();
  const saved = await fetch(
    `${env.url}/rest/v1/orders?id=eq.${order.id}&payment_status=eq.pending`,
    {
      method: "PATCH",
      headers: { ...env.headers, Prefer: "return=representation" },
      body: JSON.stringify({ items: checked.items, pricing_verified_at }),
    },
  );
  if (!saved.ok) {
    throw new RequestError(
      "Could not verify this order’s pricing. Please try again.",
      503,
    );
  }
  const [current] = await saved.json();
  if (!current || current.payment_status !== "pending") {
    throw new RequestError(
      "This order changed. Please refresh and try again.",
      409,
    );
  }
  Object.assign(order, current);
}
