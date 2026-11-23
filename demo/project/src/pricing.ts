export interface LineItem {
  sku: string;
  unitPrice: number;
  quantity: number;
}

export function subtotal(items: LineItem[]): number {
  return items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
}

export function applyDiscount(amount: number, percent: number): number {
  if (percent <= 0) return amount;
  return Math.round(amount * (1 - percent / 100) * 100) / 100;
}

export function shippingFee(subtotalAmount: number): number {
  return subtotalAmount >= 50 ? 0 : 4.99;
}

export function orderTotal(items: LineItem[], discountPercent: number): number {
  const discounted = applyDiscount(subtotal(items), discountPercent);
  return discounted + shippingFee(discounted);
}
