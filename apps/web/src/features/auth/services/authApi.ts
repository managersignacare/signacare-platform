// apps/web/src/features/auth/services/authApi.ts
import type { LoginDTO, MFAVerifyDTO, AuthUser } from '@signacare/shared';
import { AuthUserSchema } from '@signacare/shared';
import { apiClient } from '../../../shared/services/apiClient';

export type LoginResult =
  | { requiresMfa: true; tempToken: string }
  | { requiresMfa: false; user: AuthUser; mustChangePassword?: boolean };

export const authApi = {
  async login(dto: LoginDTO): Promise<LoginResult> {
    const result = await apiClient.post<LoginResult>('auth/login', dto);
    return result;
  },

  async verifyMfa(dto: MFAVerifyDTO): Promise<AuthUser> {
    const user = await apiClient.post<AuthUser>('auth/mfa/verify', dto);
    return AuthUserSchema.parse(user);
  },

  async logout(): Promise<void> {
    await apiClient.post('auth/logout');
  },

  async refreshSession(): Promise<void> {
    await apiClient.post('auth/refresh');
  },

  async getMe(): Promise<AuthUser> {
    const user = await apiClient.get<AuthUser>('auth/me');
    return AuthUserSchema.parse(user);
  },
} as const;
