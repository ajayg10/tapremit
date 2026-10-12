import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { proposalService } from '../services/proposal.service';
import { auditService } from '../services/audit.service';

const router = Router();

router.get('/:id', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const proposal = proposalService.getProposal(req.params.id, user.id);

    res.json({
      ...proposal,
      policy_reasons: JSON.parse(proposal.policy_reasons || '[]'),
    });
  } catch (error) {
    next(error);
  }
});

const approveSchema = z.object({
  proposal_hash: z.string().optional(),
});

router.post('/:id/approve', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { proposal_hash } = approveSchema.parse(req.body || {});

    const result = await proposalService.approveProposal(req.params.id, user.id, proposal_hash);

    res.json({
      proposal: {
        ...result.proposal,
        policy_reasons: JSON.parse(result.proposal.policy_reasons || '[]'),
      },
      receipt: result.receipt,
    });
  } catch (error) {
    next(error);
  }
});

const rejectSchema = z.object({
  reason: z.string().max(200).optional(),
});

router.post('/:id/reject', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { reason } = rejectSchema.parse(req.body || {});

    const proposal = proposalService.rejectProposal(req.params.id, user.id, reason);

    res.json({
      ...proposal,
      policy_reasons: JSON.parse(proposal.policy_reasons || '[]'),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/timeline', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const timelineData = auditService.getTimeline(req.params.id, user.id);

    res.json(timelineData);
  } catch (error) {
    next(error);
  }
});

export default router;
