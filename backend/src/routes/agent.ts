import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { agentService } from '../services/agent.service';

const router = Router();

const proposeSchema = z.object({
  instruction: z.string().min(1).max(500),
  idempotency_key: z.string().max(100).optional(),
});

router.post('/propose', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { instruction, idempotency_key } = proposeSchema.parse(req.body);

    const result = await agentService.proposePayment({
      userId: user.id,
      instruction,
      idempotencyKey: idempotency_key,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
