/**
 * Letterhead — wraps content with clinic header and signer footer.
 * Used for letters, reports, and discharge summaries when printing or generating PDFs.
 *
 * Top: Clinic/org name, address, phone, ABN
 * Bottom: Signer name, title, qualifications, digital signature image, date
 */
import { Box, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../services/apiClient';
import { sharedClinicProfileKeys } from '../../queryKeys';
import { useAuthStore } from '../../store/authStore';
import { useStaffSignature } from './DigitalSignature';

interface ClinicProfile {
  name: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  state?: string;
  postcode?: string;
  phone?: string;
  fax?: string;
  email?: string;
  abn?: string;
  logoUrl?: string;
}

function useClinicProfile() {
  return useQuery({
    queryKey: sharedClinicProfileKeys.current(),
    queryFn: () => apiClient.get<ClinicProfile>('settings/clinic-profile').catch((err) => { console.warn('Letterhead: query failed', err); return null; }),
    staleTime: 10 * 60 * 1000,
  });
}

interface LetterheadProps {
  children: React.ReactNode;
  showSignature?: boolean;
  signatureData?: string | null;
  signerName?: string;
  signerTitle?: string;
  signerQualifications?: string;
  signerPrescriberNo?: string;
  signedAt?: string;
  /** Hide the letterhead visually (use for screen display; shows on print) */
  printOnly?: boolean;
}

export function Letterhead({
  children,
  showSignature = false,
  signatureData,
  signerName,
  signerTitle,
  signerQualifications,
  signerPrescriberNo,
  signedAt,
  printOnly = false,
}: LetterheadProps) {
  const { data: clinic } = useClinicProfile();
  const user = useAuthStore(s => s.user);
  const { signature: savedSignature } = useStaffSignature();

  const effectiveSignature = signatureData ?? savedSignature;
  const effectiveSignerName = signerName ?? `${user?.givenName ?? ''} ${user?.familyName ?? ''}`.trim();
  const effectiveSignerTitle = signerTitle ?? user?.role ?? '';

  const address = [clinic?.addressLine1, clinic?.addressLine2, [clinic?.suburb, clinic?.state, clinic?.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  return (
    <Box sx={printOnly ? { '@media screen': { '& .letterhead-header, & .letterhead-footer': { display: 'none' } } } : undefined}>
      {/* Header */}
      <Box className="letterhead-header" sx={{ mb: 3, pb: 2, borderBottom: '2px solid #327C8D' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="h5" fontWeight={800} sx={{ color: '#327C8D', fontFamily: 'Albert Sans, sans-serif' }}>
              {clinic?.name ?? 'Signacare Mental Health'}
            </Typography>
            {address && <Typography variant="body2" color="text.secondary">{address}</Typography>}
            <Box sx={{ display: 'flex', gap: 3, mt: 0.5 }}>
              {clinic?.phone && <Typography variant="caption" color="text.secondary">Tel: {clinic.phone}</Typography>}
              {clinic?.fax && <Typography variant="caption" color="text.secondary">Fax: {clinic.fax}</Typography>}
              {clinic?.email && <Typography variant="caption" color="text.secondary">Email: {clinic.email}</Typography>}
            </Box>
            {clinic?.abn && <Typography variant="caption" color="text.secondary">ABN: {clinic.abn}</Typography>}
          </Box>
          {clinic?.logoUrl && (
            <Box component="img" src={clinic.logoUrl} alt="Clinic logo" sx={{ maxHeight: 60, maxWidth: 150, objectFit: 'contain' }} />
          )}
        </Box>
      </Box>

      {/* Content */}
      <Box sx={{ minHeight: 200 }}>
        {children}
      </Box>

      {/* Footer — signer details + digital signature */}
      {showSignature && (
        <Box className="letterhead-footer" sx={{ mt: 4, pt: 2, borderTop: '1px solid #E0E0E0' }}>
          <Typography variant="body2" sx={{ mb: 1 }}>Yours sincerely,</Typography>
          {effectiveSignature && (
            <Box sx={{ my: 1 }}>
              <img src={effectiveSignature} alt="Digital signature" style={{ maxHeight: 60, maxWidth: 200 }} />
            </Box>
          )}
          <Typography variant="body2" fontWeight={700}>{effectiveSignerName}</Typography>
          {effectiveSignerTitle && <Typography variant="body2" color="text.secondary" sx={{ textTransform: 'capitalize' }}>{effectiveSignerTitle}</Typography>}
          {signerQualifications && <Typography variant="caption" color="text.secondary">{signerQualifications}</Typography>}
          {signerPrescriberNo && <Typography variant="caption" display="block" color="text.secondary">Prescriber No: {signerPrescriberNo}</Typography>}
          <Typography variant="caption" color="text.secondary">
            {signedAt ? `Signed: ${new Date(signedAt).toLocaleString('en-AU')}` : `Date: ${new Date().toLocaleDateString('en-AU')}`}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default Letterhead;
