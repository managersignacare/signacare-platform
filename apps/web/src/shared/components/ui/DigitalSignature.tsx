import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import SignatureCanvas from 'react-signature-canvas';
import { apiClient } from '../../services/apiClient';
import { sharedStaffKeys } from '../../queryKeys';

/** Hook to load/save the current user's digital signature */
export function useStaffSignature() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: sharedStaffKeys.mySignature(),
    queryFn: () => apiClient.get<{ signature: string | null }>('staff/me/signature').then(r => r.signature),
    staleTime: 10 * 60 * 1000,
  });
  const saveMut = useMutation({
    mutationFn: (signature: string) => apiClient.put('staff/me/signature', { signature }),
    onSuccess: () => qc.invalidateQueries({ queryKey: sharedStaffKeys.mySignature() }),
  });
  return { signature: data ?? null, isLoading, save: saveMut.mutate, isSaving: saveMut.isPending };
}

interface DigitalSignatureProps {
  open: boolean;
  onClose: () => void;
  onSign: (signatureDataUrl: string) => void;
  signerName: string;
  documentTitle?: string;
  savedSignature?: string | null;
}

export function DigitalSignatureDialog({ open, onClose, onSign, signerName, documentTitle, savedSignature }: DigitalSignatureProps) {
  const sigRef = useRef<SignatureCanvas>(null);
  const [isEmpty, setIsEmpty] = useState(true);

  const handleClear = () => {
    sigRef.current?.clear();
    setIsEmpty(true);
  };

  const handleSign = () => {
    if (sigRef.current && !sigRef.current.isEmpty()) {
      const dataUrl = sigRef.current.getTrimmedCanvas().toDataURL('image/png');
      onSign(dataUrl);
      onClose();
    }
  };

  return (
    <Dialog aria-labelledby="dialog-title" open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle id="dialog-title" sx={{ fontWeight: 700 }}>Digital Signature</DialogTitle>
      <Divider />
      <DialogContent>
        {documentTitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Signing: <strong>{documentTitle}</strong>
          </Typography>
        )}
        <Typography variant="body2" sx={{ mb: 2 }}>
          I, <strong>{signerName}</strong>, confirm that the information in this document is accurate and complete to the best of my knowledge.
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
          Draw your signature below:
        </Typography>
        <Box sx={{ border: '2px solid #ddd', borderRadius: 1, bgcolor: '#fff', mb: 1 }}>
          <SignatureCanvas
            ref={sigRef}
            penColor="#3D484B"
            canvasProps={{ width: 460, height: 150, style: { width: '100%', height: 150 } }}
            onBegin={() => setIsEmpty(false)}
          />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Button size="small" onClick={handleClear} sx={{ color: 'text.secondary' }}>Clear</Button>
          <Typography variant="caption" color="text.secondary">
            {new Date().toLocaleString('en-AU')}
          </Typography>
        </Box>
      </DialogContent>
      <Divider />
      <DialogActions sx={{ px: 3, py: 2 }}>
        <Button onClick={onClose} sx={{ color: 'text.secondary' }}>Cancel</Button>
        {savedSignature && (
          <Button variant="outlined" onClick={() => { onSign(savedSignature); onClose(); }}
            sx={{ borderColor: '#327C8D', color: '#327C8D' }}>
            Use Saved Signature
          </Button>
        )}
        <Button variant="contained" onClick={handleSign} disabled={isEmpty}
          sx={{ bgcolor: '#327C8D', '&:hover': { bgcolor: '#265f6d' } }}>
          Sign & Confirm
        </Button>
      </DialogActions>
    </Dialog>
  );
}
