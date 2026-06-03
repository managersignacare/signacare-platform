import CancelIcon from '@mui/icons-material/Cancel';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import LocalPharmacyIcon from '@mui/icons-material/LocalPharmacy';
import ScienceIcon from '@mui/icons-material/Science';
import ShieldIcon from '@mui/icons-material/Shield';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import {
    Box, Chip, Grid, LinearProgress,
    Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    Typography
} from '@mui/material';
import React from 'react';
import { ConnectOutlookButton } from '../../waitlist/components/ConnectOutlookButton';

interface IntegrationItem {
  name: string;
  status: 'ready' | 'partial' | 'not_started';
  detail: string;
}

interface Integration {
  id: string;
  name: string;
  icon: React.ReactNode;
  overallStatus: 'operational' | 'framework_ready' | 'not_configured';
  readiness: number; // 0-100
  description: string;
  items: IntegrationItem[];
  envVars: string[];
  nextSteps: string[];
}

const INTEGRATIONS: Integration[] = [
  {
    id: 'erx', name: 'eRx Script Exchange (NPDS)',
    icon: <LocalPharmacyIcon sx={{ fontSize: 28 }} />,
    overallStatus: 'framework_ready', readiness: 95,
    description: 'Electronic prescriptions via ADHA National Prescription Delivery Service. Active Script List (ASL) for pharmacies.',
    items: [
      { name: 'Prescription data model', status: 'ready', detail: 'prescriptions table with erx_token, erx_status columns' },
      { name: 'eScript service interface', status: 'ready', detail: 'Submit/cancel methods defined, audit logging' },
      { name: 'Prescription CRUD API', status: 'ready', detail: 'Full routes + repository + controller' },
      { name: 'PBS authority codes', status: 'ready', detail: '30+ psychiatric medication codes' },
      { name: 'Frontend eRx token field', status: 'ready', detail: 'Token field in prescribe dialog' },
      { name: 'FHIR R4 MedicationRequest builder', status: 'ready', detail: 'AU-profile FHIR resource with PBS, S8, route SNOMED coding' },
      { name: 'NPDS HTTP client', status: 'ready', detail: 'Mutual-TLS support, submit/cancel/ASL query' },
      { name: 'FHIR validation', status: 'ready', detail: 'Validates IHI, HPII, medication, dosage, repeats' },
      { name: 'Offline/online mode', status: 'ready', detail: 'Builds FHIR resource even when NPDS not configured' },
      { name: 'ADHA Conformance ID', status: 'partial', detail: 'Code ready — apply at developer.digitalhealth.gov.au' },
      { name: 'Mutual TLS certificate', status: 'partial', detail: 'Client supports mTLS — need ADHA-issued cert' },
    ],
    envVars: ['NPDS_API_URL', 'NPDS_CONFORMANCE_ID', 'ADHA_HPII', 'ADHA_CERT_PATH'],
    nextSteps: ['Apply for ADHA Conformance ID', 'Register for HI Service access', 'Build FHIR MedicationRequest payload', 'Wire NPDS endpoint'],
  },
  {
    id: 'safescript', name: 'SafeScript (Victoria RTPM)',
    icon: <ShieldIcon sx={{ fontSize: 28 }} />,
    overallStatus: 'framework_ready', readiness: 95,
    description: 'Real-time prescription monitoring for Schedule 8 and high-risk Schedule 4 medicines. Mandatory check before prescribing controlled substances.',
    items: [
      { name: 'SafeScript service interface', status: 'ready', detail: 'checkPatient method with audit logging' },
      { name: 'Patient identifier model', status: 'ready', detail: 'IHI, Medicare, name, DOB' },
      { name: 'Supply history model', status: 'ready', detail: 'SafeScriptSupply with all fields' },
      { name: 'Risk indicator handling', status: 'ready', detail: 'riskIndicators array mapped' },
      { name: 'S8 medication flagging', status: 'ready', detail: 'is_s8 flag on medications' },
      { name: 'Frontend SafeScript panel', status: 'ready', detail: 'Alert card in medications tab' },
      { name: 'Audit logging (APP 12)', status: 'ready', detail: 'All checks audit-logged' },
      { name: 'OAuth2 client', status: 'ready', detail: 'Token caching, client_credentials flow implemented' },
      { name: 'Supply history query', status: 'ready', detail: 'Patient lookup by IHI/Medicare, 90-day lookback' },
      { name: 'Risk indicator query', status: 'ready', detail: 'Separate risk endpoint with graceful fallback' },
      { name: 'Mandatory S8 check enforcement', status: 'ready', detail: 'enforceSafeScriptCheck() blocks S8 Rx without check' },
      { name: 'SafeScript API credentials', status: 'partial', detail: 'Code ready — apply via safescript.vic.gov.au' },
    ],
    envVars: ['SAFESCRIPT_API_URL', 'SAFESCRIPT_CLIENT_ID', 'SAFESCRIPT_CLIENT_SECRET'],
    nextSteps: ['Apply for SafeScript API access', 'Wire OAuth2 client credentials', 'Enforce mandatory check before S8 Rx', 'Add supply history display'],
  },
  {
    id: 'pathology', name: 'Pathology (HL7 v2 / FHIR)',
    icon: <ScienceIcon sx={{ fontSize: 28 }} />,
    overallStatus: 'framework_ready', readiness: 98,
    description: 'Send pathology orders and receive results via HL7 v2.5 messages. Supports ORM^O01 (orders) and ORU^R01 (results).',
    items: [
      { name: 'HL7 v2.5 ORM^O01 builder', status: 'ready', detail: 'Order message construction' },
      { name: 'HL7 v2 ORU^R01 parser', status: 'ready', detail: 'Parse OBX segments to structured results' },
      { name: 'Flag/status mapping', status: 'ready', detail: 'Normal/Low/High/Critical mapping' },
      { name: 'Pathology order CRUD', status: 'ready', detail: 'pathology_orders table + service' },
      { name: 'Pathology result CRUD', status: 'ready', detail: 'pathology_results table + service' },
      { name: 'BullMQ async workers', status: 'ready', detail: 'Outbound + inbound queues' },
      { name: 'Order number generation', status: 'ready', detail: 'PATH-YYYYMMDD-XXXXXXXX' },
      { name: 'Frontend order form', status: 'ready', detail: 'PathologyOrderForm component' },
      { name: 'Frontend results display', status: 'ready', detail: 'PathologyResultsList component' },
      { name: 'MLLP transport (send)', status: 'ready', detail: 'TCP socket with VT/FS framing, ACK/NACK handling' },
      { name: 'MLLP listener (receive)', status: 'ready', detail: 'TCP server for incoming ORU^R01, auto-ACK' },
      { name: 'Abnormal result notifications', status: 'ready', detail: 'Auto-creates task for clinician, critical/urgent/routine triage' },
      { name: 'Medication monitoring rules', status: 'ready', detail: 'Lithium, clozapine, valproate, antipsychotic metabolic rules' },
      { name: 'Lab endpoint config', status: 'partial', detail: 'Set HL7_LAB_HOST + HL7_LAB_PORT for your lab' },
    ],
    envVars: ['HL7_LAB_HOST', 'HL7_LAB_PORT', 'REDIS_HOST'],
    nextSteps: ['Implement MLLP TCP transport', 'Configure first pathology lab endpoint', 'Build abnormal result notifications', 'Add cumulative result trending'],
  },
];

export function IntegrationStatusPanel() {
  return (
    <Box>
      <Typography variant="h6" fontWeight={600} sx={{ mb: 0.5 }}>Integration Readiness</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Status of external system integrations: eRx electronic prescriptions, SafeScript monitoring, and pathology.
      </Typography>

      {/* Office 365 Integration */}
      <Box sx={{ mb: 3 }}>
        <ConnectOutlookButton />
      </Box>

      <Grid container spacing={3}>
        {INTEGRATIONS.map(intg => {
          const readyCount = intg.items.filter(i => i.status === 'ready').length;
          const totalCount = intg.items.length;
          return (
            <Grid key={intg.id} size={{ xs: 12 }}>
              <Paper variant="outlined" sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}>
                  <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                    <Box sx={{ color: intg.readiness >= 70 ? '#2E7D32' : intg.readiness >= 40 ? '#b8621a' : '#D32F2F' }}>
                      {intg.icon}
                    </Box>
                    <Box>
                      <Typography variant="subtitle1" fontWeight={700}>{intg.name}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 500 }}>{intg.description}</Typography>
                    </Box>
                  </Box>
                  <Box sx={{ textAlign: 'right', minWidth: 120 }}>
                    <Typography variant="h4" fontWeight={800} color={intg.readiness >= 70 ? '#2E7D32' : intg.readiness >= 40 ? '#b8621a' : '#D32F2F'}>
                      {intg.readiness}%
                    </Typography>
                    <Chip label={intg.overallStatus === 'operational' ? 'Operational' : intg.overallStatus === 'framework_ready' ? 'Framework Ready' : 'Not Configured'}
                      size="small" color={intg.overallStatus === 'operational' ? 'success' : intg.overallStatus === 'framework_ready' ? 'warning' : 'error'} sx={{ fontSize: 10 }} />
                  </Box>
                </Box>

                <LinearProgress variant="determinate" value={intg.readiness}
                  sx={{ mb: 2, height: 6, borderRadius: 3, bgcolor: '#eee',
                    '& .MuiLinearProgress-bar': { bgcolor: intg.readiness >= 70 ? '#2E7D32' : intg.readiness >= 40 ? '#b8621a' : '#D32F2F', borderRadius: 3 } }} />

                {/* Component Status */}
                <TableContainer role="region" aria-label="Data table">
                  <Table size="small">
                    <TableHead>
                      <TableRow sx={{ bgcolor: '#FBF8F5' }}>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Component</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12, width: 100 }}>Status</TableCell>
                        <TableCell sx={{ fontWeight: 600, fontSize: 12 }}>Detail</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {intg.items.map(item => (
                        <TableRow key={item.name}>
                          <TableCell sx={{ fontSize: 13 }}>{item.name}</TableCell>
                          <TableCell>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                              {item.status === 'ready' && <CheckCircleIcon sx={{ fontSize: 16, color: '#2E7D32' }} />}
                              {item.status === 'partial' && <WarningAmberIcon sx={{ fontSize: 16, color: '#b8621a' }} />}
                              {item.status === 'not_started' && <CancelIcon sx={{ fontSize: 16, color: '#D32F2F' }} />}
                              <Typography variant="caption" sx={{ textTransform: 'capitalize', fontSize: 11 }}>{item.status.replace('_', ' ')}</Typography>
                            </Box>
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{item.detail}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>

                {/* Env Vars & Next Steps */}
                <Grid container spacing={2} sx={{ mt: 1 }}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" fontWeight={600} color="text.secondary">Environment Variables:</Typography>
                    <Box sx={{ mt: 0.5 }}>
                      {intg.envVars.map(v => (
                        <Chip key={v} label={v} size="small" variant="outlined" sx={{ mr: 0.5, mb: 0.5, fontFamily: 'monospace', fontSize: 10 }} />
                      ))}
                    </Box>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Typography variant="caption" fontWeight={600} color="text.secondary">Next Steps:</Typography>
                    <Box component="ol" sx={{ m: 0, pl: 2, mt: 0.5 }}>
                      {intg.nextSteps.map(s => (
                        <Typography key={s} component="li" variant="caption" sx={{ fontSize: 11, mb: 0.25 }}>{s}</Typography>
                      ))}
                    </Box>
                  </Grid>
                </Grid>

                <Typography variant="caption" color="text.secondary" sx={{ mt: 1.5, display: 'block' }}>
                  {readyCount}/{totalCount} components ready
                </Typography>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
}
