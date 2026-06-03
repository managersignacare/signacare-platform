// apps/web/src/features/risk-allergies/components/AllergyList.tsx
import React, { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import MedicationOutlinedIcon from '@mui/icons-material/MedicationOutlined';
import { useAllergies, useDeleteAllergy, useUpdateAllergy } from '../hooks/useAllergies';
import {
  SEVERITY_CONFIG,
  ALLERGEN_TYPE_LABELS,
  isHighSeverityAllergy,
} from '../types/allergyTypes';
import type { AllergyResponse } from '../types/allergyTypes';
import { AllergyForm } from './AllergyForm';

interface Props {
  patientId: string;
  readOnly?:  boolean;
}

export const AllergyList: React.FC<Props> = ({ patientId, readOnly = false }) => {
  const [showInactive, setShowInactive] = useState(false);
  const { data: allergies, isLoading } = useAllergies(
    patientId,
    showInactive ? undefined : true,
  );
  const deleteMutation = useDeleteAllergy();
  const updateMutation = useUpdateAllergy();
  const [formOpen, setFormOpen]           = useState(false);
  const [editTarget, setEditTarget]       = useState<AllergyResponse | null>(null);

  const lifeThreateningActive = (allergies ?? []).some(
    (a) => a.status === 'active' && a.severity === 'life_threatening',
  );

  const handleDeactivate = (a: AllergyResponse) => {
    updateMutation.mutate({
      patientId,
      id: a.id,
      dto: { status: 'inactive' },
    });
  };

  const handleDelete = (id: string) => {
    if (!window.confirm('Soft-delete this allergy record? It will be retained for audit purposes.')) return;
    deleteMutation.mutate({ patientId, id });
  };

  if (isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={4}>
        <CircularProgress role="progressbar" aria-label="Loading" size={28} />
      </Box>
    );
  }

  return (
    <Box>
      {lifeThreateningActive && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>
          ⚠ Life-Threatening Allergy on Record — This patient has one or more life-threatening active allergies. Review before prescribing.
        </Alert>
      )}

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Box display="flex" alignItems="center" gap={1}>
          <MedicationOutlinedIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>Allergies</Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          <Typography variant="body2" color="text.secondary">Show inactive</Typography>
          <Switch
            size="small"
            checked={showInactive}
            onChange={(_, v) => setShowInactive(v)}
          />
          {!readOnly && (
            <Button
              startIcon={<AddIcon />}
              variant="contained"
              size="small"
              onClick={() => { setEditTarget(null); setFormOpen(true); }}
            >
              Add Allergy
            </Button>
          )}
        </Stack>
      </Stack>

      {(!allergies || allergies.length === 0) ? (
        <Typography variant="body2" color="text.secondary" py={2}>
          No allergies recorded.
        </Typography>
      ) : (
        <TableContainer role="region" aria-label="Data table" component={Paper} variant="outlined">
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Allergen</TableCell>
                <TableCell>Type</TableCell>
                <TableCell>Reaction</TableCell>
                <TableCell>Severity</TableCell>
                <TableCell>Recorded</TableCell>
                <TableCell>Status</TableCell>
                {!readOnly && <TableCell align="right">Actions</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {allergies.map((a) => {
                const sev = SEVERITY_CONFIG[a.severity];
                return (
                  <TableRow
                    key={a.id}
                    hover
                    sx={
                      isHighSeverityAllergy(a.severity) && a.status === 'active'
                        ? { bgcolor: 'error.light' }
                        : a.status !== 'active'
                        ? { opacity: 0.5 }
                        : undefined
                    }
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{a.allergen}</Typography>
                    </TableCell>
                    <TableCell>{ALLERGEN_TYPE_LABELS[a.allergenType]}</TableCell>
                    <TableCell>{a.reaction ?? '—'}</TableCell>
                    <TableCell>
                      <Chip
                        label={sev.label}
                        size="small"
                        color={sev.chipColour}
                        sx={
                          sev.chipColour === 'default'
                            ? undefined
                            : { fontWeight: 700 }
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {a.recordedAt
                        ? new Date(a.recordedAt).toLocaleDateString('en-AU')
                        : '—'}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={a.status === 'active' ? 'Active' : a.status === 'inactive' ? 'Inactive' : 'Entered in error'}
                        size="small"
                        color={a.status === 'active' ? 'success' : 'default'}
                      />
                    </TableCell>
                    {!readOnly && (
                      <TableCell align="right">
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => { setEditTarget(a); setFormOpen(true); }}
                          >
                            <EditOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {a.status === 'active' && (
                          <Tooltip title="Mark inactive">
                            <IconButton
                              size="small"
                              onClick={() => handleDeactivate(a)}
                              disabled={updateMutation.isPending}
                            >
                              <DeleteOutlineIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                        <Tooltip title="Delete record">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleDelete(a.id)}
                            disabled={deleteMutation.isPending}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <Dialog aria-labelledby="dialog-title"
        open={formOpen}
        onClose={() => setFormOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle id="dialog-title">
          {editTarget ? 'Edit Allergy' : 'Add Allergy'}
        </DialogTitle>
        <DialogContent dividers>
          <AllergyForm
            patientId={patientId}
            existing={editTarget ?? undefined}
            onSuccess={() => setFormOpen(false)}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
};
