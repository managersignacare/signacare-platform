import { apiClient } from '../../../shared/services/apiClient'

export interface SubscriptionSummary {
  id: string
  planType: string
  seats: number
  pricePerMonth: number
  pricePerYear: number | null
  discountPercent: number | null
  discountAmount: number | null
  status: string
  startDate: string
  endDate: string | null
  renewalDate: string | null
  reminderDays: number
  notes: string | null
  updatedAt: string
}

export interface ClinicSubscriptionOverview {
  clinicId: string
  clinicName: string
  clinicEmail: string | null
  clinicIsActive: boolean
  subscription: SubscriptionSummary | null
}

export const subscriptionApi = {
  getOverview(): Promise<ClinicSubscriptionOverview[]> {
    return apiClient
      .get<{ subscriptions: ClinicSubscriptionOverview[] }>('power-settings/subscriptions/overview')
      .then((r) => r.subscriptions ?? [])
  },
}

