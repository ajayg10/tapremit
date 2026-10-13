import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { proposalService } from '../services/proposal.service';
import { proposalsRepo, toPublicProposal } from '../db/proposals.repository';
import { auditService } from '../services/audit.service';

const router = Router();

router.get('/', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const limit = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit as string, 10) || 20, 1), 100) : 20;
    const proposals = proposalsRepo.listByUserId(user.id, limit).map(toPublicProposal);

    res.json({ proposals });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', requireAuth, (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const proposal = proposalService.getProposal(req.params.id, user.id);

    res.json(toPublicProposal(proposal));
  } catch (error) {
    next(error);
  }
});

const approveSchema = z.object({
  proposal_hash: z.string().optional(),
  confirm_new_recipient: z.boolean().optional(),
});

router.post('/:id/approve', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const { proposal_hash, confirm_new_recipient } = approveSchema.parse(req.body || {});

    const result = await proposalService.approveProposal(
      req.params.id,
      user.id,
      proposal_hash,
      confirm_new_recipient
    );

    res.json({
      proposal: toPublicProposal(result.proposal),
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

    res.json(toPublicProposal(proposal));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/reconcile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user = (req as any).user;
    const result = await proposalService.reconcileProposal(req.params.id, user.id);
    res.json({
      proposal: toPublicProposal(result.proposal),
      receipt: result.receipt,
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
