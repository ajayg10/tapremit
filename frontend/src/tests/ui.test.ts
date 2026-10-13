import { describe, it, expect } from 'vitest';
import { DEMO_USERS } from '../lib/auth';

describe('Frontend UI & Demo Config Tests', () => {
  it('should have all 4 required demo accounts configured', () => {
    expect(DEMO_USERS.length).toBe(4);
    const handles = DEMO_USERS.map((u) => u.handle);
    expect(handles).toContain('alice_agent');
    expect(handles).toContain('riya');
    expect(handles).toContain('bob_builder');
    expect(handles).toContain('charlie');
  });

  it('should have primary demo sender clearly marked as recommended', () => {
    const alice = DEMO_USERS.find((u) => u.handle === 'alice_agent');
    expect(alice).toBeDefined();
    expect(alice?.badge).toBe('Recommended');
  });

  it('should have distinct roles for each demo persona', () => {
    const roles = DEMO_USERS.map((u) => u.role);
    const uniqueRoles = new Set(roles);
    expect(uniqueRoles.size).toBe(DEMO_USERS.length);
  });
});
