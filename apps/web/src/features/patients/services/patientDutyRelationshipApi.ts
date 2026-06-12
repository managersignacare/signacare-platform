import { apiClient } from '../../../shared/services/apiClient';
import type {
  DutyRelationshipDurationHours,
  DutyRelationshipType,
} from '@signacare/shared';

export interface PatientDutyRelationship {
  id: string;
  relationshipType: DutyRelationshipType;
  reason: string;
  createdAt: string;
  expiresAt: string;
  createdById: string | null;
}

interface PatientDutyRelationshipEnvelope {
  relationship: PatientDutyRelationship & {
    status: 'created' | 'existing';
  };
}

interface PatientDutyRelationshipListEnvelope {
  relationships: PatientDutyRelationship[];
}

export const patientDutyRelationshipApi = {
  create: async (
    patientId: string,
    payload: {
      relationshipType: DutyRelationshipType;
      reason: string;
      expiresInHours: DutyRelationshipDurationHours;
    },
  ): Promise<PatientDutyRelationshipEnvelope['relationship']> => {
    const response = await apiClient.post<PatientDutyRelationshipEnvelope>(
      `patients/${patientId}/duty-relationships`,
      payload,
    );
    return response.relationship;
  },

  listMine: async (patientId: string): Promise<PatientDutyRelationship[]> => {
    const response = await apiClient.get<PatientDutyRelationshipListEnvelope>(
      `patients/${patientId}/duty-relationships/me`,
    );
    return response.relationships ?? [];
  },
};

