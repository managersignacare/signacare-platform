import {
  Box,
  Typography,
  Divider,
  Paper,
} from '@mui/material';

interface Props {
  title: string;
  description?: string;
  children: React.ReactNode;
  // Wrap content in a Paper card (default true)
  card?: boolean;
  // Space between this section and the next
  mb?: number;
}

export function FormSection({
  title,
  description,
  children,
  card = true,
  mb = 4,
}: Props): React.ReactElement {
  const content = (
    <Box sx={{ p: card ? 3 : 0 }}>
      <Box sx={{ mb: 2.5 }}>
        <Typography
          variant="subtitle1"
          fontWeight={600}
          color="text.primary"
        >
          {title}
        </Typography>
        {description && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5 }}
          >
            {description}
          </Typography>
        )}
      </Box>
      <Divider sx={{ mb: 3 }} />
      {children}
    </Box>
  );

  return (
    <Box sx={{ mb }}>
      {card ? (
        <Paper
          variant="outlined"
          sx={{ borderRadius: 2, overflow: 'hidden' }}
        >
          {content}
        </Paper>
      ) : (
        content
      )}
    </Box>
  );
}
