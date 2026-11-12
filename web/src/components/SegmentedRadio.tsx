import { useId } from 'react';
import styles from './SegmentedRadio.module.css';

export type TSegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type TSegmentedRadioProps<T extends string> = {
  /** 群組名稱（radiogroup 的 accessible name，也是畫面上的小標） */
  label: string;
  options: ReadonlyArray<TSegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
};

/**
 * 分段式單選（原生 radio + radiogroup），供帳本、收支切換共用。
 */
export function SegmentedRadio<T extends string>({
  label,
  options,
  value,
  onChange,
}: TSegmentedRadioProps<T>) {
  const id = useId();
  const labelId = `${id}-label`;

  return (
    <div className={styles.field}>
      <span id={labelId} className={styles.groupLabel}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className={styles.group}>
        {options.map((option) => (
          <label key={option.value} className={styles.option}>
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className={styles.input}
            />
            <span className={styles.text}>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
