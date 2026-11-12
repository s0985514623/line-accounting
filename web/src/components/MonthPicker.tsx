import { useId } from 'react';
import { isValidMonth } from '../lib/date';
import styles from './MonthPicker.module.css';

type TMonthPickerProps = {
  /** 目前月份 YYYY-MM */
  value: string;
  onChange: (month: string) => void;
};

/**
 * 月份選擇（原生 <input type="month">）；清空或不合法的值會被忽略，維持原月份。
 */
export function MonthPicker({ value, onChange }: TMonthPickerProps) {
  const id = useId();
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        月份
      </label>
      <input
        id={id}
        type="month"
        className={styles.input}
        value={value}
        onChange={(event) => {
          if (isValidMonth(event.target.value)) onChange(event.target.value);
        }}
      />
    </div>
  );
}
