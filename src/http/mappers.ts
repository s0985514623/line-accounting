/**
 * Repository 資料 → API DTO（specs/api/api.yml components/schemas）。
 */
import type { EntryType, Ledger } from '../domain/enums';
import type { CategoryDetail } from '../repositories/category-repository';

export interface CategoryDto {
  id: number;
  ledger: Ledger;
  entryType: EntryType;
  name: string;
  isFallback: boolean;
}

export function toCategoryDto(category: CategoryDetail): CategoryDto {
  return {
    id: category.id,
    ledger: category.ledger,
    entryType: category.entryType,
    name: category.name,
    isFallback: category.isFallback,
  };
}
