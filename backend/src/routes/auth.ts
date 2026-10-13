import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authService } from '../services/auth.service';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/auth';

const router = Router();

const strictAuthIpLimiter = rateLimit({
  windowMs: process.env.AUTH_IP_RATE_LIMIT_WINDOW_MS ? parseInt(process.env.AUTH_IP_RATE_LIMIT_WINDOW_MS) : 900000,
  max: process.env.AUTH_IP_RATE_LIMIT_MAX ? parseInt(process.env.AUTH_IP_RATE_LIMIT_MAX) : 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' },
  skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true',
});

const strictAuthLimiter = rateLimit({
  windowMs: process.env.AUTH_RATE_LIMIT_WINDOW_MS ? parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS) : 900000,
  max: process.env.AUTH_RATE_LIMIT_MAX ? parseInt(process.env.AUTH_RATE_LIMIT_MAX) : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' },
  skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true',
  keyGenerator: (req) => req.body?.handle ? `${req.ip}|${req.body.handle.toLowerCase()}` : req.ip || '',
});

const meLimiter = rateLimit({
  windowMs: process.env.ME_RATE_LIMIT_WINDOW_MS ? parseInt(process.env.ME_RATE_LIMIT_WINDOW_MS) : 60000,
  max: process.env.ME_RATE_LIMIT_MAX ? parseInt(process.env.ME_RATE_LIMIT_MAX) : 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too Many Requests' },
  skip: () => process.env.NODE_ENV === 'test' && process.env.TEST_RATE_LIMIT !== 'true',
});

router.use('/register', strictAuthIpLimiter, strictAuthLimiter);
router.use('/login', strictAuthIpLimiter, strictAuthLimiter);
router.use('/me', meLimiter);

const registerStartSchema = z.object({
  handle: z.string().min(3).max(20).regex(/^[a-zA-Z0-9_]+$/).toLowerCase(),
  display_name: z.string().min(1),
  phone: z.string().optional(),
});

router.post('/register/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { handle, display_name, phone } = registerStartSchema.parse(req.body);
    const options = await authService.registerStart(handle, display_name, phone);
    res.json(options);
  } catch (error: any) {
    if (error.status === 409) {
      error.message = 'Registration failed due to a conflict';
    }
    next(error);
  }
});

const registerFinishSchema = z.object({
  handle: z.string(),
  response: z.any(),
});

router.post('/register/finish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { handle, response } = registerFinishSchema.parse(req.body);
    const user = await authService.registerFinish(handle.toLowerCase(), response);
    const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRY as any, algorithm: 'HS256' });
    res.json({ token });
  } catch (error: any) {
    next(error);
  }
});

const loginStartSchema = z.object({
  handle: z.string(),
});

router.post('/login/start', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { handle } = loginStartSchema.parse(req.body);
    const options = await authService.loginStart(handle.toLowerCase());
    res.json(options);
  } catch (error: any) {
    // Hide true existence of handle
    next({ status: 400, message: 'Invalid credentials or user not found' });
  }
});

router.post('/login/finish', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { handle, response } = req.body;
    if (!handle || !response) throw { status: 400, message: 'Invalid request' };
    const user = await authService.loginFinish(handle.toLowerCase(), response);
    const token = jwt.sign({ sub: user.id }, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRY as any, algorithm: 'HS256' });
    res.json({ token });
  } catch (error) {
    next({ status: 400, message: 'Invalid credentials or verification failed' });
  }
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  res.json((req as any).user);
});

export default router;
