// apps/web/src/features/settings/services/hiServiceApi.ts
//
// BUG-336 + BUG-339 — client for the /hi-service/verify-hpii and
// /hi-service/verify-hpio admin endpoints. Backend wraps the NASH mTLS
// verifyHpii / verifyHpio helpers (BUG-297); offline/stub mode returns
// { found: true, ..., error: '…unverified' } for format+Luhn-valid
// identifiers.
import { apiClient } from '../../../shared/services/apiClient'
import type { HpiiVerifyResponse, HpioVerifyResponse } from '@signacare/shared'

export const hiServiceApi = {
  verifyHpii(hpii: string): Promise<HpiiVerifyResponse> {
    return apiClient.post<HpiiVerifyResponse>('hi-service/verify-hpii', { hpii })
  },

  verifyHpio(hpio: string): Promise<HpioVerifyResponse> {
    return apiClient.post<HpioVerifyResponse>('hi-service/verify-hpio', { hpio })
  },
}
