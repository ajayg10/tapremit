import { LLMAdapter, LLMOutput, LLMOutputSchema } from './LLMAdapter';
import { env } from '../../config/env';

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
    const defaultAsset = env.MOCK_PAYMENT_EXECUTOR ? 'AUSD' : 'MON';

    // Check for ambiguous / incomplete instructions
    if (!trimmed || trimmed.length < 5) {
      return {
        type: 'CLARIFICATION',
        message: `Could you please specify how much ${defaultAsset} you would like to send and to whom?`,
      };
    }

    // Pattern matching: e.g. "send 0.01 MON to @riya for design" or "pay @bob 10 ausd"
    const handleMatch = trimmed.match(/@([a-zA-Z0-9_]+)/i) || trimmed.match(/to\s+([a-zA-Z0-9_]+)/i);
    const amountMatch =
      trimmed.match(/(-?\d+(?:\.\d+)?)\s*(?:test\s*)?(ausd|mon)/i) ||
      trimmed.match(/(?:send|pay|transfer)\s+(-?\d+(?:\.\d+)?)/i);

    if (!handleMatch || !amountMatch) {
      return {
        type: 'CLARIFICATION',
        message: `Instruction unclear. Please specify the recipient handle (e.g. @handle) and amount in ${defaultAsset}.`,
      };
    }

    const recipient_handle = handleMatch[1].toLowerCase();
    const rawAmountNum = parseFloat(amountMatch[1]);

    if (isNaN(rawAmountNum) || rawAmountNum <= 0) {
      return {
        type: 'CLARIFICATION',
        message: `Invalid amount. Please provide a positive amount of ${defaultAsset}.`,
      };
    }

    // Determine asset from instruction match or env default
    const matchedAsset = (amountMatch[2]?.toUpperCase() as 'AUSD' | 'MON') || defaultAsset;
    const isMon = matchedAsset === 'MON';

    // Convert to integer base units
    let baseUnits: string;
    const parts = amountMatch[1].split('.');
    if (isMon) {
      if (parts[1] && parts[1].length > 18) {
        return {
          type: 'CLARIFICATION',
          message: 'Amount exceeds maximum supported precision of 18 decimal places for MON.',
        };
      }
      const whole = BigInt(parts[0] || '0') * 10n ** 18n;
      let fraction = 0n;
      if (parts[1]) {
        const fracStr = parts[1].padEnd(18, '0');
        fraction = BigInt(fracStr);
      }
      baseUnits = (whole + fraction).toString();
    } else {
      if (parts[1] && parts[1].length > 6) {
        return {
          type: 'CLARIFICATION',
          message: 'Amount exceeds maximum supported precision of 6 decimal places for AUSD.',
        };
      }
      // 6 decimals for AUSD
      baseUnits = Math.round(rawAmountNum * 1_000_000).toString();
    }

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
      asset: matchedAsset,
      purpose,
    };

    return LLMOutputSchema.parse(rawOutput);
  }
}
