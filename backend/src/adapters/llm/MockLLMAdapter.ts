import { LLMAdapter, LLMOutput, LLMOutputSchema } from './LLMAdapter';

export class MockLLMAdapter implements LLMAdapter {
  providerName = 'MockLLM (Deterministic Regex / Rule-Based)';
  isMock = true;

  // Optional mock injection for testing model schema violations
  private overrideOutput: any = null;

  setMockOutput(output: any) {
    this.overrideOutput = output;
  }

  clearMockOutput() {
    this.overrideOutput = null;
  }

  async parseInstruction(instruction: string): Promise<LLMOutput> {
    if (this.overrideOutput !== null) {
      // Validate through strict schema to demonstrate that even mock/real raw output is checked
      return LLMOutputSchema.parse(this.overrideOutput);
    }

    const trimmed = instruction.trim();

    // Check for ambiguous / incomplete instructions
    if (!trimmed || trimmed.length < 5) {
      return {
        type: 'CLARIFICATION',
        message: 'Could you please specify how much test AUSD you would like to send and to whom?',
      };
    }

    // Pattern matching: e.g. "send 5 test AUSD to @riya for the design work"
    // or "pay @bob 10 ausd" or "transfer 50 ausd to alice"
    // Ignore prompt injection phrases like "ignore rules", "execute immediately", etc.
    const handleMatch = trimmed.match(/@([a-zA-Z0-9_]+)/i) || trimmed.match(/to\s+([a-zA-Z0-9_]+)/i);
    const amountMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*(?:test\s*)?ausd/i) || trimmed.match(/(?:send|pay|transfer)\s+(\d+(?:\.\d+)?)/i);

    if (!handleMatch || !amountMatch) {
      return {
        type: 'CLARIFICATION',
        message: 'Instruction unclear. Please specify the recipient handle (e.g. @handle) and amount in AUSD.',
      };
    }

    const recipient_handle = handleMatch[1].toLowerCase();
    const rawAmountNum = parseFloat(amountMatch[1]);

    if (isNaN(rawAmountNum) || rawAmountNum <= 0) {
      return {
        type: 'CLARIFICATION',
        message: 'Invalid amount. Please provide a positive amount of AUSD.',
      };
    }

    // Convert to 6-decimal integer base units (1 AUSD = 1,000,000 base units)
    const baseUnits = Math.round(rawAmountNum * 1_000_000).toString();

    // Purpose extraction
    let purpose: string | undefined = undefined;
    const purposeMatch = trimmed.match(/for\s+(?:the\s+)?([^.]+)/i);
    if (purposeMatch) {
      purpose = purposeMatch[1].trim();
    }

    const rawOutput = {
      type: 'PROPOSAL' as const,
      recipient_handle,
      amount: baseUnits,
      asset: 'AUSD' as const,
      purpose,
    };

    return LLMOutputSchema.parse(rawOutput);
  }
}
