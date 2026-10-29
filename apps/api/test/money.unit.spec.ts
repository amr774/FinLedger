import { formatMoney, parseMinor, toMinor } from '@finledger/shared';
describe('Exact money utilities', () => {
  test.each(['0', '-1', '1.5', '1e4', '01', '10000001', '9007199254740992'])(
    'rejects invalid minor amount %s',
    (value) => expect(() => parseMinor(value)).toThrow(),
  );
  test('maximum allowed transfer is exact', () =>
    expect(parseMinor('10000000')).toBe(10000000n));
  test('decimal entry never uses floating point', () => {
    expect(toMinor('100.01')).toBe('10001');
    expect(toMinor('0.29')).toBe('29');
  });
  test('formats values beyond JS safe integers without precision loss', () =>
    expect(formatMoney('9007199254740993')).toBe('90,071,992,547,409.93 EGP'));
  test.each(['1.001', '-1', 'Infinity', '1e3'])(
    'rejects malformed decimal %s',
    (value) => expect(() => toMinor(value)).toThrow(),
  );
});
