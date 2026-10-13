import { User } from './types';

const TOKEN_KEY = 'tapremit_token';
const USER_KEY = 'tapremit_user';

export const DEMO_USERS = [
  {
    handle: 'alice_agent',
    name: 'Alice',
    role: 'Primary Demo Sender',
    description: 'Has 1 prior settled tx with @riya. Clean state for demo flow.',
    badge: 'Recommended',
  },
  {
    handle: 'riya',
    name: 'Riya Patel',
    role: 'Known Contact Recipient',
    description: 'Designer with verified prior payments from Alice.',
    badge: 'Known Contact',
  },
  {
    handle: 'bob_builder',
    name: 'Bob Miller',
    role: 'First-Time Recipient',
    description: 'Never received payments from Alice before.',
    badge: 'New Recipient',
  },
  {
    handle: 'charlie',
    name: 'Charlie Zhang',
    role: 'Contractor',
    description: 'Engineering contractor contact.',
    badge: 'Contact',
  },
];

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(TOKEN_KEY, token);
}

export function removeAuthToken() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

export function getStoredUser(): User | null {
  if (typeof window === 'undefined') return null;
  const userJson = localStorage.getItem(USER_KEY);
  if (!userJson) return null;
  try {
    return JSON.parse(userJson) as User;
  } catch {
    return null;
  }
}

export function setStoredUser(user: User) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}
