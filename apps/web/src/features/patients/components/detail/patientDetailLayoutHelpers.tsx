import React from 'react';

import { SpecialtyInformationExchangeTab } from '../../../../shared/components/specialty/SpecialtyInformationExchangeTab';

export const GENDER_LABELS: Record<string, string> = {
  male: 'Male', female: 'Female', nonbinary: 'Non-binary', other: 'Other',
  transgendermale: 'Trans Male', transgenderfemale: 'Trans Female',
  genderqueer: 'Genderqueer', prefernottosay: 'Not disclosed',
};

export function getInitials(given: string, family: string): string {
  return `${given.charAt(0)}${family.charAt(0)}`.toUpperCase();
}

export const GimInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Internal Medicine" />
);

export const EndoInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Endocrinology" />
);

export const PaedInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Paediatrics" />
);

export const ObsGyneInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Obstetrics & Gynaecology" />
);

export const SurgeryInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Surgery" />
);

export const OncologyInformationExchangeTab: React.FC<{ patientId: string }> = ({ patientId }) => (
  <SpecialtyInformationExchangeTab patientId={patientId} specialtyLabel="Oncology" />
);
