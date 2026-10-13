import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

import { ZodError } from 'zod';

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  let status = err.status || 500;
  let message = err.message || 'Internal Server Error';

  if (err instanceof ZodError) {
    status = 400;
    message = 'Validation Error';
  }

  // Strip URLs and credentials from message
  const sanitizedMessage = typeof message === 'string'
    ? message.replace(/https?:\/\/[^\s]+/gi, '[REDACTED_URL]').replace(/0x[a-fA-F0-9]{64}/g, '[REDACTED_KEY]')
    : 'Internal Server Error';

  if (status >= 400 && status < 500) {
    logger.warn({ status, path: req.path, errMessage: sanitizedMessage }, 'Client error');
    return res.status(status).json({ 
      error: sanitizedMessage, 
      details: err instanceof ZodError ? err.errors : undefined 
    });
  }

  // Never log raw err object containing nested cause, details, or URL
  logger.error(
    {
      errCode: err.code || err.name || 'INTERNAL_ERROR',
      errMessage: sanitizedMessage,
      path: req.path,
    },
    'Server execution error'
  );
  
  return res.status(status).json({
    error: sanitizedMessage,
  });
};
