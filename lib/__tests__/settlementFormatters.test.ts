import {
  formatAssetAmount,
  formatRate,
  getStellarExplorerTxUrl,
} from '@/lib/settlementFormatters';

describe('settlementFormatters', () => {
  describe('formatAssetAmount', () => {
    it('shows at least two decimals with the asset code', () => {
      expect(formatAssetAmount(1250, 'XLM')).toBe('1,250.00 XLM');
    });

    it('keeps Stellar 7-decimal precision', () => {
      expect(formatAssetAmount(0.1234567, 'USDC')).toBe('0.1234567 USDC');
      expect(formatAssetAmount(0.123456789, 'XLM')).toBe('0.1234568 XLM');
    });
  });

  describe('formatRate', () => {
    it('formats fractional rates as percentages', () => {
      expect(formatRate(0.025)).toBe('2.5%');
      expect(formatRate(0.1)).toBe('10%');
    });
  });

  describe('getStellarExplorerTxUrl', () => {
    it('links to the matching network on stellar.expert', () => {
      expect(getStellarExplorerTxUrl('abc123', 'public')).toBe(
        'https://stellar.expert/explorer/public/tx/abc123',
      );
      expect(getStellarExplorerTxUrl('abc123', 'testnet')).toBe(
        'https://stellar.expert/explorer/testnet/tx/abc123',
      );
    });
  });
});
