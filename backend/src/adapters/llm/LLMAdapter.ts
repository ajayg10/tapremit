import { z } from 'zod';

export const ProposalDraftSchema = z.object({
  type: z.literal('PROPOSAL'),
  recipient_handle: z.string().min(1).max(30).regex(/^@?[a-zA-Z0-9_]+$/).transform(h => h.replace(/^@/, '').toLowerCase()),
  amount: z.string().regex(/^[1-9]\d*$/, 'Amount must be a positive integer in base units'),
  asset: z.literal('AUSD'),
  purpose: z.string().max(200).optional(),
}).strict(); // Reject any unexpected/extra fields

export const ClarificationSchema = z.object({
  type: z.literal('CLARIFICATION'),
  message: z.string().min(1),
}).strict();

export const LLMOutputSchema = z.discriminatedUnion('type', [
  ProposalDraftSchema,
  ClarificationSchema,
]);

export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;
export type Clarification = z.infer<typeof ClarificationSchema>;
export type LLMOutput = z.infer<typeof LLMOutputSchema>;

export interface LLMAdapter {
  providerName: string;
  isMock: boolean;
  parseInstruction(instruction: string): Promise<LLMOutput>;
}
