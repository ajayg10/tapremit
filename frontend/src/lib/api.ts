import { getAuthToken, setAuthToken, setStoredUser, removeAuthToken } from './auth';
import {
  SystemStatus,
  User,
  Proposal,
  AgentProposeResponse,
  ProposalTimelineResponse,
  ApproveResponse,
} from './types';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${API_BASE}${path}`;

  try {
    const res = await fetch(url, { ...options, headers });
    const data = await res.json().catch(() => null);

    if (!res.ok) {
      if (res.status === 401) {
        removeAuthToken();
      }
      const message = data?.error || data?.message || `Request failed with status ${res.status}`;
      throw new Error(message);
    }

    return data as T;
  } catch (err: any) {
    // Sanitize error: never log auth tokens, passwords, or internal URLs
    const sanitizedMsg = err.message || 'Network request failed';
    throw new Error(sanitizedMsg);
  }
}

export const api = {
  // System status & active adapters
  getSystemStatus: async (): Promise<SystemStatus> => {
    return request<SystemStatus>('/system/status');
  },

  // Demo 1-click authentication
  loginDemo: async (handle: string): Promise<User> => {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase().trim();

    // 1. Start login to obtain challenge
    await request<any>('/auth/login/start', {
      method: 'POST',
      body: JSON.stringify({ handle: cleanHandle }),
    });

    // 2. Finish login with mock verification payload
    const finishRes = await request<{ token: string }>('/auth/login/finish', {
      method: 'POST',
      body: JSON.stringify({
        handle: cleanHandle,
        response: { mock: true, clientDataJSON: 'mock_passkey_response' },
      }),
    });

    setAuthToken(finishRes.token);

    // 3. Fetch profile
    const user = await request<User>('/auth/me');
    setStoredUser(user);
    return user;
  },

  getCurrentUser: async (): Promise<User> => {
    return request<User>('/auth/me');
  },

  lookupUser: async (handle: string): Promise<{ handle: string; display_name: string }> => {
    const cleanHandle = handle.replace(/^@/, '').toLowerCase().trim();
    return request<{ handle: string; display_name: string }>(`/users/lookup?handle=${encodeURIComponent(cleanHandle)}`);
  },

  // Proposals
  listProposals: async (limit = 20): Promise<{ proposals: Proposal[] }> => {
    return request<{ proposals: Proposal[] }>(`/proposals?limit=${limit}`);
  },

  getProposal: async (id: string): Promise<Proposal> => {
    return request<Proposal>(`/proposals/${id}`);
  },

  proposePayment: async (instruction: string, idempotencyKey?: string): Promise<AgentProposeResponse> => {
    return request<AgentProposeResponse>('/agent/propose', {
      method: 'POST',
      body: JSON.stringify({
        instruction: instruction.trim(),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
      }),
    });
  },

  approveProposal: async (id: string, proposalHash?: string): Promise<ApproveResponse> => {
    return request<ApproveResponse>(`/proposals/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        ...(proposalHash ? { proposal_hash: proposalHash } : {}),
      }),
    });
  },

  rejectProposal: async (id: string, reason?: string): Promise<Proposal> => {
    return request<Proposal>(`/proposals/${id}/reject`, {
      method: 'POST',
      body: JSON.stringify({
        ...(reason ? { reason: reason.trim() } : {}),
      }),
    });
  },

  getTimeline: async (id: string): Promise<ProposalTimelineResponse> => {
    return request<ProposalTimelineResponse>(`/proposals/${id}/timeline`);
  },
};
