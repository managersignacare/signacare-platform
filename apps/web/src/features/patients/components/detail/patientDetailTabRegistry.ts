import React from 'react';

import type { PatientTabId } from '../../types/patientTypes';
import {
  EndoInformationExchangeTab,
  GimInformationExchangeTab,
  ObsGyneInformationExchangeTab,
  OncologyInformationExchangeTab,
  PaedInformationExchangeTab,
  SurgeryInformationExchangeTab,
} from './patientDetailLayoutHelpers';

type PatientTabComponent = React.ComponentType<{ patientId: string }>;
type PatientTabModule = Record<string, unknown> & { default?: unknown };

function lazyPatientTab(
  loader: () => Promise<PatientTabModule>,
  exportName: string,
): React.LazyExoticComponent<PatientTabComponent> {
  return React.lazy(async () => {
    const module = await loader();
    const component = module[exportName] ?? module.default;
    if (!component) {
      throw new Error(`Patient tab module did not export ${exportName}`);
    }
    return { default: component as PatientTabComponent };
  });
}

const SummaryTab = lazyPatientTab(() => import('./tabs/SummaryTab'), 'SummaryTab');
const OverviewTab = lazyPatientTab(() => import('./tabs/OverviewTab'), 'OverviewTab');
const EpisodesTab = lazyPatientTab(() => import('./tabs/EpisodesTab'), 'EpisodesTab');
const DocumentationTab = lazyPatientTab(() => import('./tabs/DocumentationTab'), 'DocumentationTab');
const AlertsPlansTab = lazyPatientTab(() => import('./tabs/AlertsPlansTab'), 'AlertsPlansTab');
const MedicationsTab = lazyPatientTab(() => import('./tabs/MedicationsTab'), 'MedicationsTab');
const MedicationHistoryTab = lazyPatientTab(() => import('./tabs/MedicationHistoryTab'), 'MedicationHistoryTab');
const PathologyTab = lazyPatientTab(() => import('./tabs/PathologyTab'), 'PathologyTab');
const LegalTab = lazyPatientTab(() => import('./tabs/LegalTab'), 'LegalTab');
const ReferralsTab = lazyPatientTab(() => import('./tabs/ReferralsTab'), 'ReferralsTab');
const DocumentsTab = lazyPatientTab(() => import('./tabs/DocumentsTab'), 'DocumentsTab');
const CorrespondenceTab = lazyPatientTab(() => import('./tabs/CorrespondenceTab'), 'CorrespondenceTab');
const AppointmentsTab = lazyPatientTab(() => import('./tabs/AppointmentsTab'), 'AppointmentsTab');
const AssessmentsTab = lazyPatientTab(() => import('./tabs/AssessmentsTab'), 'AssessmentsTab');
const OutcomeMeasuresTab = lazyPatientTab(() => import('./tabs/OutcomeMeasuresTab'), 'OutcomeMeasuresTab');
const TrackingTab = lazyPatientTab(() => import('./tabs/TrackingTab'), 'TrackingTab');
const NinetyOneDayReviewTab = lazyPatientTab(() => import('./tabs/NinetyOneDayReviewTab'), 'NinetyOneDayReviewTab');
const PathwaysTab = lazyPatientTab(() => import('./tabs/PathwaysTab'), 'PathwaysTab');
const PhysicalHealthTab = lazyPatientTab(() => import('./tabs/PhysicalHealthTab'), 'PhysicalHealthTab');
const LivedExperienceTab = lazyPatientTab(() => import('./tabs/LivedExperienceTab'), 'LivedExperienceTab');
const InpatientCareTab = lazyPatientTab(() => import('./tabs/InpatientCareTab'), 'InpatientCareTab');
const EctTab = lazyPatientTab(() => import('./tabs/EctTab'), 'EctTab');
const TmsTab = lazyPatientTab(() => import('./tabs/TmsTab'), 'TmsTab');
const VivaTab = lazyPatientTab(() => import('./tabs/VivaTab'), 'VivaTab');
const PatientBillingTab = lazyPatientTab(() => import('../../../../features/billing/components/PatientBillingTab'), 'PatientBillingTab');
const ProblemListTab = lazyPatientTab(() => import('../../../internal-medicine/tabs/ProblemListTab'), 'ProblemListTab');
const ChronicDiseaseRegisterTab = lazyPatientTab(() => import('../../../internal-medicine/tabs/ChronicDiseaseRegisterTab'), 'ChronicDiseaseRegisterTab');
const GlucoseFlowsheetTab = lazyPatientTab(() => import('../../../endocrinology/tabs/GlucoseFlowsheetTab'), 'GlucoseFlowsheetTab');
const PaediatricsTab = lazyPatientTab(() => import('../../../paediatrics/tabs/PaediatricsTab'), 'PaediatricsTab');
const ObsGyneTab = lazyPatientTab(() => import('../../../obs-gyne/tabs/ObsGyneTab'), 'ObsGyneTab');
const SurgeryTab = lazyPatientTab(() => import('../../../surgery/tabs/SurgeryTab'), 'SurgeryTab');
const OncologyTab = lazyPatientTab(() => import('../../../oncology/tabs/OncologyTab'), 'OncologyTab');
const MentalHealthInformationExchangeTab = lazyPatientTab(
  () => import('./tabs/MentalHealthInformationExchangeTab'),
  'MentalHealthInformationExchangeTab',
);

export const TAB_COMPONENTS: Record<PatientTabId, PatientTabComponent> = {
  summary: SummaryTab,
  overview: OverviewTab,
  episodes: EpisodesTab,
  documentation: DocumentationTab,
  'alerts-plans': AlertsPlansTab,
  medications: MedicationsTab,
  'medication-history': MedicationHistoryTab,
  pathology: PathologyTab,
  legal: LegalTab,
  referrals: ReferralsTab,
  documents: DocumentsTab,
  correspondence: CorrespondenceTab,
  appointments: AppointmentsTab,
  assessments: AssessmentsTab,
  'outcome-measures': OutcomeMeasuresTab,
  tracking: TrackingTab,
  '91day-review': NinetyOneDayReviewTab,
  pathways: PathwaysTab,
  'physical-health': PhysicalHealthTab,
  'lived-experience': LivedExperienceTab,
  'inpatient-care': InpatientCareTab,
  ect: EctTab,
  tms: TmsTab,
  viva: VivaTab,
  billing: PatientBillingTab,
  problems: ProblemListTab,
  'chronic-diseases': ChronicDiseaseRegisterTab,
  glucose: GlucoseFlowsheetTab,
  paediatrics: PaediatricsTab,
  'mh-exchange': MentalHealthInformationExchangeTab,
  'gim-exchange': GimInformationExchangeTab,
  'endo-exchange': EndoInformationExchangeTab,
  'paed-exchange': PaedInformationExchangeTab,
  'obs-gyne': ObsGyneTab,
  'obs-exchange': ObsGyneInformationExchangeTab,
  surgery: SurgeryTab,
  oncology: OncologyTab,
  'onco-exchange': OncologyInformationExchangeTab,
  'surg-exchange': SurgeryInformationExchangeTab,
};
