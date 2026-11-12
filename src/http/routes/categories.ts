/**
 * 分類 API（specs/api/api.yml）：
 *  GET    /api/categories?ledger=&entryType=  → 200 { items: Category[] }
 *  POST   /api/categories                     → 201 Category
 *  DELETE /api/categories/{id}                → 204
 * 身分驗證由上層 /api router 的 liff-auth 負責；此處只做輸入驗證與委派 service。
 */
import { Router } from 'express';
import type { CategoryService } from '../../services/category-service';
import { asyncHandler } from '../async-handler';
import { toCategoryDto } from '../mappers';
import {
  CategoryIdParamSchema,
  CreateCategoryBodySchema,
  ListCategoriesQuerySchema,
} from '../schemas/category';
import { parseInput } from '../schemas/parse-input';

export function createCategoriesRouter(categories: CategoryService): Router {
  const router = Router();

  router.get(
    '/categories',
    asyncHandler(async (req, res) => {
      const query = parseInput(ListCategoriesQuerySchema, req.query);
      const items = await categories.list(query.ledger, query.entryType);
      res.status(200).json({ items: items.map(toCategoryDto) });
    }),
  );

  router.post(
    '/categories',
    asyncHandler(async (req, res) => {
      const body = parseInput(CreateCategoryBodySchema, req.body);
      const created = await categories.create(body);
      res.status(201).json(toCategoryDto(created));
    }),
  );

  router.delete(
    '/categories/:id',
    asyncHandler(async (req, res) => {
      const { id } = parseInput(CategoryIdParamSchema, req.params);
      await categories.delete(id);
      res.status(204).end();
    }),
  );

  return router;
}
