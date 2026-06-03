import {
  Box, Typography, Grid, TextField, MenuItem, Button,
  Divider, CircularProgress, Alert, IconButton,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useForm, Controller, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { CreateInvoiceSchema, type CreateInvoiceDTO } from '../types/billingTypes';
import { useCreateInvoice } from '../hooks/useBilling';
import type { InvoiceCreateDTO } from '@signacare/shared';

interface Props {
  patientId: string;
  episodeId?: string;
  onSuccess: () => void;
  onCancel: () => void;
}

const BILLING_TYPE_BY_CLAIM_TYPE: Record<
  CreateInvoiceDTO['claimType'],
  InvoiceCreateDTO['billingType']
> = {
  medicare: 'bulk_bill',
  dva: 'dva',
  ndis: 'ndis',
  private_health: 'private',
  self_funded: 'private',
};

function toInvoiceCreatePayload(dto: CreateInvoiceDTO): InvoiceCreateDTO {
  return {
    patientId: dto.patientId,
    appointmentId: dto.appointmentId,
    billingType: BILLING_TYPE_BY_CLAIM_TYPE[dto.claimType],
    dueDate: dto.dueDate,
    notes: dto.notes ?? null,
    lineItems: dto.lineItems.map((line) => ({
      mbsItemNumber: line.mbsItemNumber,
      description: line.description,
      quantity: line.quantity,
      unitPriceCents: Math.round(line.unitPrice * 100),
    })),
  };
}

export const InvoiceForm: React.FC<Props> = ({
  patientId, episodeId, onSuccess, onCancel,
}) => {
  const today = new Date().toISOString().split('T')[0]!;

  const { control, handleSubmit, formState: { errors } } = useForm<CreateInvoiceDTO>({
    resolver: zodResolver(CreateInvoiceSchema) as Resolver<CreateInvoiceDTO>,
    defaultValues: {
      patientId,
      episodeId: episodeId ?? undefined,
      claimType: 'self_funded',
      lineItems: [{ description: '', serviceDate: today, quantity: 1, unitPrice: 0, gstApplicable: false }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lineItems' });
  const createInvoice = useCreateInvoice();

  const onSubmit = (data: CreateInvoiceDTO) => {
    createInvoice.mutate(toInvoiceCreatePayload(data), { onSuccess });
  };

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)} sx={{ p: 2 }}>
      <Typography variant="h6" sx={{ mb: 2 }}>New Invoice</Typography>
      <Divider sx={{ mb: 3 }} />

      {createInvoice.isError && (
        <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to create invoice.</Alert>
      )}

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid>
          <Controller name="claimType" control={control}
            render={({ field }) => (
              <TextField {...field} select label="Claim Type *" fullWidth>
                {(['medicare','dva','ndis','private_health','self_funded'] as const).map((c) => (
                  <MenuItem key={c} value={c}>{c.replace('_', ' ').toUpperCase()}</MenuItem>
                ))}
              </TextField>
            )}
          />
        </Grid>
        <Grid>
          <Controller name="dueDate" control={control}
            render={({ field }) => (
              <TextField {...field} label="Due Date" type="date" fullWidth InputLabelProps={{ shrink: true }} />
            )}
          />
        </Grid>
        <Grid>
          <Controller name="notes" control={control}
            render={({ field }) => (
              <TextField {...field} label="Notes" fullWidth multiline rows={2} />
            )}
          />
        </Grid>
      </Grid>

      {/* Line Items */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="subtitle2">Line Items *</Typography>
        <Button size="small" startIcon={<AddIcon />}
          onClick={() => append({ description: '', serviceDate: today, quantity: 1, unitPrice: 0, gstApplicable: false })}
        >
          Add Line
        </Button>
      </Box>

      {fields.map((f, index) => (
        <Grid container spacing={1} key={f.id} sx={{ mb: 1, alignItems: 'flex-start' }}>
          <Grid>
            <Controller name={`lineItems.${index}.mbsItemNumber`} control={control}
              render={({ field }) => <TextField {...field} label="MBS Item" fullWidth size="small" />}
            />
          </Grid>
          <Grid>
            <Controller name={`lineItems.${index}.description`} control={control}
              render={({ field }) => (
                <TextField {...field} label="Description *" fullWidth size="small"
                  error={!!errors.lineItems?.[index]?.description}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller name={`lineItems.${index}.serviceDate`} control={control}
              render={({ field }) => (
                <TextField {...field} label="Date" type="date" fullWidth size="small"
                  InputLabelProps={{ shrink: true }}
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller name={`lineItems.${index}.quantity`} control={control}
              render={({ field }) => (
                <TextField {...field} onChange={(e) => field.onChange(parseInt(e.target.value, 10))}
                  label="Qty" type="number" inputProps={{ min: 1 }} fullWidth size="small"
                />
              )}
            />
          </Grid>
          <Grid>
            <Controller name={`lineItems.${index}.unitPrice`} control={control}
              render={({ field }) => (
                <TextField {...field} onChange={(e) => field.onChange(parseFloat(e.target.value))}
                  label="Unit $" type="number" inputProps={{ min: 0, step: '0.01' }} fullWidth size="small"
                />
              )}
            />
          </Grid>
          <Grid size={1} sx={{ display: 'flex', alignItems: 'center', pt: 1 }}>
            {fields.length > 1 && (
              <IconButton size="small" onClick={() => remove(index)} color="error">
                <DeleteIcon fontSize="small" />
              </IconButton>
            )}
          </Grid>
        </Grid>
      ))}

      {errors.lineItems && (
        <Typography variant="caption" color="error">At least one line item is required.</Typography>
      )}

      <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 3 }}>
        <Button variant="outlined" onClick={onCancel} disabled={createInvoice.isPending}>Cancel</Button>
        <Button variant="contained" type="submit" disabled={createInvoice.isPending}>
          {createInvoice.isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={18} /> : 'Create Invoice'}
        </Button>
      </Box>
    </Box>
  );
};
