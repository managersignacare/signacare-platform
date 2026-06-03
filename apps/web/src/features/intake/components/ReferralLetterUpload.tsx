import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { useReferralUpload } from '../hooks/useReferralUpload';

interface Props {
  referralId: string;
  onUploaded?: () => void;
}

export const ReferralLetterUpload = ({ referralId, onUploaded }: Props) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const { mutate, isPending, isError, error } = useReferralUpload();

  const handleFile = (file?: File) => {
    if (!file) {
      return;
    }

    mutate(
      { referralId, file },
      {
        onSuccess: () => {
          onUploaded?.();
        },
      },
    );
  };

  return (
    <Stack spacing={1.5}>
      {isError ? (
        <Alert role="alert" severity="error">{error instanceof Error ? error.message : 'Upload failed.'}</Alert>
      ) : null}

      <Box
        onDragOver={(event) => {
          event.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragActive(false);
          handleFile(event.dataTransfer.files[0]);
        }}
        sx={{
          border: '2px dashed',
          borderColor: dragActive ? '#327C8D' : '#D7D7D7',
          borderRadius: 3,
          p: 3,
          textAlign: 'center',
          backgroundColor: dragActive ? '#eef7f8' : '#FBF8F5',
          '&:focus-within': { outline: '2px solid #327C8D', outlineOffset: 2 },
        }}
      >
        <Typography fontWeight={700}>Drop referral letter here</Typography>
        <Typography variant="body2" color="text.secondary" mt={0.5}>
          PDF, DOCX, or image files supported.
        </Typography>

        <Button
          sx={{ mt: 2 }}
          variant="outlined"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          Choose file
        </Button>

        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.tiff,image/*"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
      </Box>
    </Stack>
  );
};
