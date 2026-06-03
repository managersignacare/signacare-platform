// apps/web/src/features/pathology/components/PathologyOrdersList.tsx
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  Button,
  Link,
} from '@mui/material';
import CancelOutlinedIcon from '@mui/icons-material/CancelOutlined';
import { useLabOrders, useCancelLabOrder } from '../hooks/usePathology';
import type { LabOrderResponse } from '../types/pathologyTypes';

type ChipColor = 'default' | 'warning' | 'info' | 'success' | 'error';

const STATUS_COLOR: Record<string, ChipColor> = {
  pending: 'warning',
  collected: 'info',
  in_transit: 'info',
  resulted: 'success',
  partial: 'warning',
  cancelled: 'error',
};

interface Props {
  patientId: string;
  onNewOrder: () => void;
  onViewResult: (orderId: string) => void;
}

export const PathologyOrdersList: React.FC<Props> = ({
  patientId,
  onNewOrder,
  onViewResult,
}) => {
  const { data: orders, isLoading, isError } = useLabOrders(patientId);
  const cancelMutation = useCancelLabOrder();

  if (isLoading) return <CircularProgress role="progressbar" aria-label="Loading" size={24} />;
  if (isError)
    return <Alert role="alert" severity="error">Failed to load pathology orders.</Alert>;

  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          mb: 2,
        }}
      >
        <Typography variant="h6">Pathology Orders</Typography>
        <Button variant="contained" size="small" onClick={onNewOrder}>
          New Order
        </Button>
      </Box>

      {!orders || orders.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No pathology orders found.
        </Typography>
      ) : (
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Order #</TableCell>
              <TableCell>Tests</TableCell>
              <TableCell>Lab Provider</TableCell>
              <TableCell>Urgency</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Collection Date</TableCell>
              <TableCell align="center">Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {orders.map((order: LabOrderResponse) => (
              <TableRow key={order.id} hover>
                <TableCell>
                  <Link
                    component="button"
                    type="button"
                    variant="body2"
                    underline="always"
                    sx={{ textAlign: 'left', color: 'primary.main' }}
                    onClick={() => onViewResult(order.id)}
                    aria-label={`View pathology order ${order.orderNumber}`}
                  >
                    {order.orderNumber}
                  </Link>
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
                    {order.tests.slice(0, 3).map((t) => (
                      <Chip key={t.testCode} label={t.testName} size="small" />
                    ))}
                    {order.tests.length > 3 && (
                      <Chip
                        label={`+${order.tests.length - 3}`}
                        size="small"
                        variant="outlined"
                      />
                    )}
                  </Box>
                </TableCell>
                <TableCell>{order.labProvider ?? '—'}</TableCell>
                <TableCell>
                  <Chip
                    label={order.urgency}
                    size="small"
                    color={
                      order.urgency === 'stat'
                        ? 'error'
                        : order.urgency === 'urgent'
                          ? 'warning'
                          : 'default'
                    }
                  />
                </TableCell>
                <TableCell>
                  <Chip
                    label={order.status}
                    size="small"
                    color={STATUS_COLOR[order.status] ?? 'default'}
                  />
                </TableCell>
                <TableCell>{order.collectionDate ?? '—'}</TableCell>
                <TableCell align="center">
                  {order.status !== 'cancelled' &&
                    order.status !== 'resulted' && (
                      <Tooltip title="Cancel Order">
                        <span>
                          <IconButton
                            size="small"
                            onClick={() => cancelMutation.mutate(order.id)}
                            disabled={cancelMutation.isPending}
                          >
                            <CancelOutlinedIcon fontSize="small" />
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Box>
  );
};
