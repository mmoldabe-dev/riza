export const CITY_DELIVERY_FEE = Number(process.env.CITY_DELIVERY_FEE ?? 1500);
export const OUTSIDE_CITY_EXTRA_FEE = Number(
  process.env.OUTSIDE_CITY_EXTRA_FEE ?? 500
);

export function deliveryFee(isCity: boolean): number {
  return isCity ? CITY_DELIVERY_FEE : CITY_DELIVERY_FEE + OUTSIDE_CITY_EXTRA_FEE;
}
