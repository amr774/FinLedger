export const CURRENCY = 'EGP';
export const MAX_TRANSFER_MINOR = 10_000_000n;
export function parseMinor(value: string): bigint {
  if (!/^[1-9]\d{0,7}$/.test(value))
    throw new Error('Use positive integer minor units');
  const amount = BigInt(value);
  if (amount > MAX_TRANSFER_MINOR)
    throw new Error('Maximum transfer is EGP 100,000');
  return amount;
}
export function formatMoney(value: string): string {
  const amount = BigInt(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${(absolute / 100n).toLocaleString('en-US')}.${(absolute % 100n).toString().padStart(2, '0')} EGP`;
}
export function toMinor(value: string): string {
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value))
    throw new Error('Enter EGP with at most two decimal places');
  const [whole, fraction = ''] = value.split('.');
  return parseMinor(
    (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))).toString(),
  ).toString();
}
