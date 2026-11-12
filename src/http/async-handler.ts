/**
 * Express 4 不會捕捉 async handler 的 rejection；以此包裝後交給 error-handler。
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
