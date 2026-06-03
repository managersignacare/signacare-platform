import {
  Box,
  Divider,
  Grid,
  List,
  ListItem,
  ListItemText,
  Paper,
  Typography,
} from '@mui/material';

interface Props {
  documentUrl?: string | null;
  extractedFields?: Record<string, string | number | boolean | null | undefined> | null;
}

export const OcrPreviewPanel = ({ documentUrl, extractedFields }: Props) => {
  const entries = Object.entries(extractedFields ?? {});

  return (
    <Grid container spacing={2}>
      <Grid>
        <Paper variant="outlined" sx={{ height: 520, borderRadius: 3, overflow: 'hidden' }}>
          {documentUrl ? (
            <Box
              component="iframe"
              src={documentUrl}
              title="Referral letter preview"
              sx={{ width: '100%', height: '100%', border: 0 }}
            />
          ) : (
            <Box display="flex" alignItems="center" justifyContent="center" height="100%">
              <Typography color="text.secondary">No document preview available.</Typography>
            </Box>
          )}
        </Paper>
      </Grid>

      <Grid>
        <Paper variant="outlined" sx={{ borderRadius: 3, height: 520, overflow: 'auto' }}>
          <Box p={2}>
            <Typography variant="h6">Extracted fields</Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>
              Review OCR output before clinical use.
            </Typography>
          </Box>

          <Divider />

          {entries.length === 0 ? (
            <Box p={2}>
              <Typography color="text.secondary">No OCR fields detected.</Typography>
            </Box>
          ) : (
            <List dense>
              {entries.map(([key, value]) => (
                <ListItem key={key} divider>
                  <ListItemText
                    primary={key}
                    secondary={value === null || value === undefined || value === '' ? '—' : String(value)}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Paper>
      </Grid>
    </Grid>
  );
};
