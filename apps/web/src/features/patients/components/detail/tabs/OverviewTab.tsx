// apps/web/src/features/patients/components/detail/tabs/OverviewTab.tsx
import React, { useState } from 'react';
import { Box, Button, Chip, Grid, Paper, Skeleton, Tooltip, Typography } from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import PersonIcon from '@mui/icons-material/Person';
import LocalHospitalIcon from '@mui/icons-material/LocalHospital';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import HomeIcon from '@mui/icons-material/Home';
import FamilyRestroomIcon from '@mui/icons-material/FamilyRestroom';
import GroupIcon from '@mui/icons-material/Group';
import { usePatient } from '../../../hooks/usePatient';
import { usePatientContacts } from '../../../hooks/usePatientContacts';
import { calculateAge } from '../../../types/patientTypes';
import { EditPatientWizard } from '../../registration/EditPatientWizard';

interface OverviewTabProps { patientId: string; }

export const OverviewTab: React.FC<OverviewTabProps> = ({ patientId }) => {
  const { data: patient, isLoading } = usePatient(patientId);
  const { data: contactsData } = usePatientContacts(patientId);
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <Skeleton height={200} />;
  if (!patient) return null;

  const age = calculateAge(patient.dateOfBirth);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="outlined"
          startIcon={<EditIcon />}
          onClick={() => setEditOpen(true)}
          sx={{ fontFamily: 'Albert Sans, sans-serif', textTransform: 'none', borderColor: '#b8621a', color: '#b8621a', '&:hover': { borderColor: '#d0741e', bgcolor: 'rgba(240,133,44,0.04)' } }}
        >
          Edit Patient Details
        </Button>
      </Box>

      <SectionCard icon={<PersonIcon />} title="Demographics">
        <Grid container spacing={2}>
          <InfoItem label="Given Name" value={patient.givenName} />
          <InfoItem label="Family Name" value={patient.familyName} />
          <InfoItem label="Preferred Name" value={patient.preferredName} />
          <InfoItem label="Date of Birth" value={patient.dateOfBirth ? new Date(patient.dateOfBirth).toLocaleDateString('en-AU') : '—'} />
          <InfoItem label="Age" value={`${age} years`} />
          <InfoItem label="Gender" value={patient.gender} />
          <InfoItem label="Pronouns" value={patient.pronouns} />
          <InfoItem label="MRN" value={patient.emrNumber} />
        </Grid>
      </SectionCard>

      <SectionCard icon={<ContactPhoneIcon />} title="Contact Details">
        <Grid container spacing={2}>
          <InfoItem label="Mobile Phone" value={patient.phoneMobile} />
          <InfoItem label="Home Phone" value={patient.phoneHome} />
          <InfoItem label="Email" value={patient.emailPrimary} />
        </Grid>
      </SectionCard>

      <SectionCard icon={<HomeIcon />} title="Address">
        <Grid container spacing={2}>
          <InfoItem label="Street" value={patient.addressStreet} />
          <InfoItem label="Suburb" value={patient.addressSuburb} />
          <InfoItem label="State" value={patient.addressState} />
          <InfoItem label="Postcode" value={patient.addressPostcode} />
        </Grid>
      </SectionCard>

      <SectionCard icon={<CreditCardIcon />} title="Identifiers & Cards">
        <Grid container spacing={2}>
          <InfoItem label="Medicare Number" value={patient.medicareNumber} />
          <InfoItem label="Medicare IRN" value={patient.medicareIrn} />
          <InfoItem label="Medicare Expiry" value={patient.medicareExpiry} />
          <InfoItem label="IHI Number" value={patient.ihi} />
          <InfoItem label="DVA Number" value={patient.dvaNumber} />
          <InfoItem label="DVA Card Type" value={patient.dvaCardType} />
        </Grid>
      </SectionCard>

      <SectionCard icon={<FamilyRestroomIcon />} title="Next of Kin">
        {(() => {
          // Determine consent level for NOK: check patient-level consentToShareWithCarer
          // or match NOK name against support persons with consentLevel
          const nokContact = (contactsData?.contacts ?? []).find(c =>
            c.givenName && patient.nokName && patient.nokName.includes(c.givenName)
          );
          const nokConsent: string = nokContact?.consentLevel
            ?? (patient.consentToShareWithCarer ? 'full' : 'emergency_only');
          const consentColor = nokConsent === 'full' ? '#2E7D32' : nokConsent === 'partial' ? '#E65100' : '#D32F2F';
          const consentLabel = nokConsent === 'full' ? 'Full Consent' : nokConsent === 'partial' ? 'Partial Consent' : 'Emergency Only';
          return (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Tooltip title={consentLabel}>
                  <Chip label={consentLabel} size="small" sx={{ fontSize: 10, height: 20, bgcolor: consentColor, color: '#fff', fontWeight: 600 }} />
                </Tooltip>
              </Box>
              <Grid container spacing={2}>
                <ConsentInfoItem label="Name" value={patient.nokName} consentColor={consentColor} />
                <InfoItem label="Relationship" value={patient.nokRelationship} />
                <ConsentInfoItem label="Phone" value={patient.nokPhone} consentColor={consentColor} />
              </Grid>
            </Box>
          );
        })()}
      </SectionCard>

      <SectionCard icon={<GroupIcon />} title="Support Persons">
        {(contactsData?.contacts ?? []).length === 0 ? (
          <Typography variant="body2" color="text.secondary" fontFamily="Albert Sans, sans-serif">No support persons recorded.</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
            {(contactsData?.contacts ?? []).map((c, i) => {
              const consent = c.consentLevel || (c.hasConsent ? 'full' : 'emergency_only');
              const consentColor = consent === 'full' ? '#2E7D32' : consent === 'partial' ? '#E65100' : '#D32F2F';
              const consentLabel = consent === 'full' ? 'Full Consent' : consent === 'partial' ? 'Partial Consent' : 'Emergency Only';
              const borderColor = consent === 'full' ? '#C8E6C9' : consent === 'partial' ? '#FFE0B2' : '#FFCDD2';
              return (
                <Box key={c.id ?? i} sx={{ p: 1.5, border: '1px solid', borderColor, borderLeft: `4px solid ${consentColor}`, borderRadius: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                    <Chip label={consentLabel} size="small" sx={{ fontSize: 9, height: 18, bgcolor: consentColor, color: '#fff', fontWeight: 600 }} />
                    {c.isEmergencyContact && <Chip label="Emergency Contact" size="small" variant="outlined" sx={{ fontSize: 9, height: 18, borderColor: '#D32F2F', color: '#D32F2F' }} />}
                    {c.isCarer && <Chip label="Carer" size="small" variant="outlined" sx={{ fontSize: 9, height: 18, borderColor: '#1565C0', color: '#1565C0' }} />}
                  </Box>
                  <Grid container spacing={1}>
                    <ConsentInfoItem label="Name" value={[c.givenName, c.familyName].filter(Boolean).join(' ') || null} consentColor={consentColor} />
                    <InfoItem label="Relationship" value={c.relationship} />
                    <ConsentInfoItem label="Mobile" value={c.phoneMobile} consentColor={consentColor} />
                    <ConsentInfoItem label="Home Phone" value={c.phoneHome} consentColor={consentColor} />
                    <ConsentInfoItem label="Email" value={c.email} consentColor={consentColor} />
                  </Grid>
                  {c.consentNotes && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block', fontStyle: 'italic' }}>
                      Consent notes: {c.consentNotes}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </SectionCard>

      <SectionCard icon={<LocalHospitalIcon />} title="Health Providers">
        <Grid container spacing={2}>
          <InfoItem label="GP Name" value={patient.gpName} />
          <InfoItem label="GP Practice" value={patient.gpPractice} />
          <InfoItem label="Provider Number" value={patient.gpProviderNumber} />
          <InfoItem label="GP Phone" value={patient.gpPhone} />
          <InfoItem label="GP Fax" value={patient.gpFax} />
          <InfoItem label="GP Email" value={patient.gpEmail} />
          <InfoItem label="GP Street" value={patient.gpAddressStreet} />
          <InfoItem label="GP Suburb" value={patient.gpAddressSuburb} />
          <InfoItem label="GP State" value={patient.gpAddressState} />
          <InfoItem label="GP Postcode" value={patient.gpAddressPostcode} />
        </Grid>
      </SectionCard>

      <SectionCard icon={<CreditCardIcon />} title="Funding">
        <Grid container spacing={2}>
          <InfoItem label="Health Fund" value={patient.healthFundName} />
          <InfoItem label="Fund Number" value={patient.healthFundNumber} />
        </Grid>
      </SectionCard>

      {editOpen && (
        <EditPatientWizard
          open={editOpen}
          patient={patient}
          patientId={patientId}
          onClose={() => setEditOpen(false)}
        />
      )}
    </Box>
  );
};

// ── Shared helpers ───────────────────────────────────────────────────────────

interface SectionCardProps { icon: React.ReactNode; title: string; children: React.ReactNode }
function SectionCard({ icon, title, children }: SectionCardProps) {
  return (
    <Paper elevation={0} sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Box sx={{ color: '#b8621a' }}>{icon}</Box>
        <Typography variant="subtitle2" fontWeight={600} fontFamily="Albert Sans, sans-serif">{title}</Typography>
      </Box>
      {children}
    </Paper>
  );
}

interface InfoItemProps { label: string; value?: string | null }
function InfoItem({ label, value }: InfoItemProps) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={500}>{value || '—'}</Typography>
    </Grid>
  );
}

interface ConsentInfoItemProps { label: string; value?: string | null; consentColor: string }
function ConsentInfoItem({ label, value, consentColor }: ConsentInfoItemProps) {
  return (
    <Grid size={{ xs: 12, sm: 6, md: 4 }}>
      <Typography variant="caption" color="text.secondary" display="block">{label}</Typography>
      <Typography variant="body2" fontWeight={600} sx={{ color: value ? consentColor : 'text.disabled' }}>{value || '—'}</Typography>
    </Grid>
  );
}
