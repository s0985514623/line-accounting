import type { TEntryType } from '../api/schemas';
import { SegmentedRadio, type TSegmentedOption } from './SegmentedRadio';

const ENTRY_TYPE_OPTIONS: ReadonlyArray<TSegmentedOption<TEntryType>> = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
];

type TEntryTypeToggleProps = {
  value: TEntryType;
  onChange: (entryType: TEntryType) => void;
};

/**
 * 收支切換（支出／收入）。
 */
export function EntryTypeToggle({ value, onChange }: TEntryTypeToggleProps) {
  return (
    <SegmentedRadio label="收支" options={ENTRY_TYPE_OPTIONS} value={value} onChange={onChange} />
  );
}
