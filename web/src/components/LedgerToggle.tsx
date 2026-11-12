import type { TLedger } from '../api/schemas';
import { SegmentedRadio, type TSegmentedOption } from './SegmentedRadio';

const LEDGER_OPTIONS: ReadonlyArray<TSegmentedOption<TLedger>> = [
  { value: 'personal', label: '個人' },
  { value: 'company', label: '公司' },
];

type TLedgerToggleProps = {
  value: TLedger;
  onChange: (ledger: TLedger) => void;
};

/**
 * 帳本切換（個人／公司）。
 */
export function LedgerToggle({ value, onChange }: TLedgerToggleProps) {
  return <SegmentedRadio label="帳本" options={LEDGER_OPTIONS} value={value} onChange={onChange} />;
}
