import qrcode from 'qrcode-generator';

export const PIX_FIXED_PAYLOADS: Readonly<Record<number, string>> = {
  5: '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-00000000000052040000530398654045.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***6304F3E7',
  10: '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-000000000000520400005303986540510.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***6304483A',
  25: '00020126580014BR.GOV.BCB.PIX013600000000-0000-4000-8000-000000000000520400005303986540525.005802BR5910SONARY APP6009SAO PAULO61080100100062070503***63045696',
};

export const PIX_CONFIG = {
  pixKey: '00000000-0000-4000-8000-000000000000',
  merchantName: 'SONARY APP',
  merchantDisplayName: 'Sonary App',
  merchantCity: 'SAO PAULO',
  postalCode: '01001000',
  fixedPayloads: PIX_FIXED_PAYLOADS,
} as const;

// Alias mantido para compatibilidade de importação
export const PIX_MOCK_CONFIG = PIX_CONFIG;

export type PixPresetId = '5' | '10' | '25' | 'other';

export interface PixPresetOption {
  id: PixPresetId;
  label: string;
  amount: number | null;
}

export const PIX_PRESET_OPTIONS: readonly PixPresetOption[] = [
  { id: '5', label: 'R$ 5', amount: 5 },
  { id: '10', label: 'R$ 10', amount: 10 },
  { id: '25', label: 'R$ 25', amount: 25 },
  { id: 'other', label: 'Outro', amount: null },
];

function tlv(id: string, value: string): string {
  const len = String(value.length).padStart(2, '0');
  return `${id}${len}${value}`;
}

export function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i += 1) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) !== 0 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function parsePixAmount(raw: string): number | null {
  const cleaned = raw.replace(/[^\d.,]/g, '').replace(',', '.');
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

export function formatPixAmountBrl(amount: number | null): string {
  if (amount === null || !Number.isFinite(amount) || amount <= 0) {
    return 'Valor livre';
  }
  return `R$ ${amount.toFixed(2).replace('.', ',')}`;
}

/**
 * Retorna a cobrança exata do banco para R$ 5, R$ 10 e R$ 25 ou gera BR Code EMV válido para outros valores.
 */
export function buildPixPayload(amount: number | null): string {
  if (amount !== null && Object.prototype.hasOwnProperty.call(PIX_FIXED_PAYLOADS, amount)) {
    return PIX_FIXED_PAYLOADS[amount];
  }

  const merchantAccountInfo = tlv(
    '26',
    tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', PIX_CONFIG.pixKey)
  );
  const amountTag =
    amount !== null && Number.isFinite(amount) && amount > 0
      ? tlv('54', amount.toFixed(2))
      : '';

  const base =
    tlv('00', '01') +
    merchantAccountInfo +
    tlv('52', '0000') +
    tlv('53', '986') +
    amountTag +
    tlv('58', 'BR') +
    tlv('59', PIX_CONFIG.merchantName) +
    tlv('60', PIX_CONFIG.merchantCity) +
    tlv('61', PIX_CONFIG.postalCode) +
    tlv('62', tlv('05', '***')) +
    '6304';

  return `${base}${crc16Ccitt(base)}`;
}

export const buildMockPixPayload = buildPixPayload;

/**
 * Gera matriz QR Code ISO-18004 real e escaneável em apps bancários.
 */
export function buildQrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const grid: boolean[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => qr.isDark(r, c))
  );
  return grid;
}

export function qrMatrixToSvgPath(matrix: boolean[][]): string {
  const parts: string[] = [];
  for (let r = 0; r < matrix.length; r += 1) {
    for (let c = 0; c < matrix[r].length; c += 1) {
      if (matrix[r][c]) {
        parts.push(`M${c} ${r}h1v1h-1z`);
      }
    }
  }
  return parts.join('');
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;
    if (nav?.clipboard && typeof nav.clipboard.writeText === 'function') {
      await nav.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Segue para fallback nativo
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rn = require('react-native');
    const nativeClipboard =
      rn?.TurboModuleRegistry?.get?.('Clipboard') ?? rn?.NativeModules?.Clipboard;
    if (nativeClipboard && typeof nativeClipboard.setString === 'function') {
      nativeClipboard.setString(text);
      return true;
    }
    if (rn?.Clipboard && typeof rn.Clipboard.setString === 'function') {
      rn.Clipboard.setString(text);
      return true;
    }
  } catch {
    // Ambiente sem módulo nativo de clipboard
  }

  return false;
}
