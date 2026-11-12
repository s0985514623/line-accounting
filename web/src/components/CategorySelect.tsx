import type { TCategory } from '../api/schemas';

type TCategorySelectProps = {
  /** select 的 id（供外部 label 關聯） */
  id: string;
  categories: readonly TCategory[];
  /** 已選分類 id（字串）；未選為空字串 */
  value: string;
  onChange: (categoryId: string) => void;
  className?: string;
  /** 錯誤訊息元素的 id（有錯誤時傳入） */
  errorId?: string;
};

/**
 * 分類下拉選單：第一個選項「請選擇」（value=""），其後依 API 順序列出分類。
 */
export function CategorySelect({
  id,
  categories,
  value,
  onChange,
  className,
  errorId,
}: TCategorySelectProps) {
  return (
    <select
      id={id}
      className={className}
      value={value}
      aria-invalid={errorId ? true : undefined}
      aria-describedby={errorId}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">請選擇</option>
      {categories.map((category) => (
        <option key={category.id} value={String(category.id)}>
          {category.name}
        </option>
      ))}
    </select>
  );
}
