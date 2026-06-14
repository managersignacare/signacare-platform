// apps/web/src/features/appointments/components/AppointmentCalendar.tsx
import { Alert, Box, Chip, Grid, Paper, Stack, Tooltip, Typography } from '@mui/material';
import type { Appointment } from '../types/appointmentTypes';
import { getAppointmentStatusMeta } from '../types/appointmentTypes';
import type { AvailabilityColour } from '@signacare/shared';

interface Props {
  appointments: Appointment[];
  month: Date;
  getAvailabilitySummary?: (day: Date) => {
    blockCount: number;
    dominantColour: AvailabilityColour | null;
    labels?: string[];
  };
  onDropAppointment?: (appointment: Appointment, day: Date) => void;
  onSelectAppointment?: (appointment: Appointment) => void;
  onSelectDay?: (day: Date) => void;
}

const getMonthGrid = (month: Date): Date[] => {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start);
    day.setDate(start.getDate() + index);
    return day;
  });
};

const isSameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() &&
  left.getMonth() === right.getMonth() &&
  left.getDate() === right.getDate();

export const AppointmentCalendar = ({
  appointments,
  month,
  getAvailabilitySummary,
  onDropAppointment,
  onSelectAppointment,
  onSelectDay,
}: Props) => {
  const days = getMonthGrid(month);

  if (!appointments) return <Alert severity="info">No appointments to display.</Alert>;

  return (
    <Box>
      <Grid container spacing={1}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((label) => (
          <Grid size={12 / 7} key={label}>
            <Typography
              align="center"
              variant="body2"
              sx={{ fontWeight: 700, color: '#3D484B', py: 1 }}
            >
              {label}
            </Typography>
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={1}>
        {days.map((day) => {
          const dayAppointments = appointments.filter((appointment) =>
            isSameDay(new Date(appointment.startTime), day),
          );
          const availability = getAvailabilitySummary?.(day) ?? {
            blockCount: 0,
            dominantColour: null,
            labels: [],
          };
          const availabilityLabel = availability.labels?.length
            ? availability.labels[0]
            : availability.dominantColour === 'red'
              ? 'Blocked'
              : availability.dominantColour === 'yellow'
                ? 'Tentative'
                : 'Available';
          const isCurrentMonth = day.getMonth() === month.getMonth();
          return (
            <Grid size={12 / 7} key={day.toISOString()}>
              <Paper
                variant="outlined"
                onDragOver={(event) => {
                  if (onDropAppointment) {
                    event.preventDefault();
                  }
                }}
                onDrop={(event) => {
                  if (!onDropAppointment) return;
                  event.preventDefault();
                  const appointmentId = event.dataTransfer.getData('text/appointment-id');
                  const appointment = appointments.find((row) => row.id === appointmentId);
                  if (appointment) {
                    onDropAppointment(appointment, day);
                  }
                }}
                sx={{
                  minHeight: 132,
                  p: 1,
                  borderRadius: 2,
                  backgroundColor: isCurrentMonth ? '#FFFFFF' : '#FBF8F5',
                }}
              >
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {day.getDate()}
                  </Typography>
                  {isCurrentMonth && onSelectDay ? (
                    <Chip
                      size="small"
                      variant="outlined"
                      label="Add"
                      onClick={() => onSelectDay(day)}
                    />
                  ) : null}
                </Stack>
                <Stack spacing={0.75} mt={1}>
                  {availability.blockCount > 0 ? (
                    <Tooltip
                      title={availability.labels?.length ? availability.labels.join(' · ') : availabilityLabel}
                    >
                      <Chip
                        size="small"
                        variant="outlined"
                        label={availabilityLabel}
                        sx={{
                          justifyContent: 'flex-start',
                          maxWidth: '100%',
                          borderColor:
                            availability.dominantColour === 'red'
                              ? '#D32F2F'
                              : availability.dominantColour === 'yellow'
                                ? '#C58A00'
                                : '#2E7D32',
                          color:
                            availability.dominantColour === 'red'
                              ? '#D32F2F'
                              : availability.dominantColour === 'yellow'
                                ? '#8A5A00'
                                : '#2E7D32',
                          bgcolor:
                            availability.dominantColour === 'red'
                              ? '#FFEBEE'
                              : availability.dominantColour === 'yellow'
                                ? '#FFF8E1'
                                : '#E8F5E9',
                          '& .MuiChip-label': {
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        }}
                      />
                    </Tooltip>
                  ) : null}
                  {availability.labels?.slice(1, 2).map((label) => (
                    <Typography
                      key={label}
                      variant="caption"
                      sx={{
                        color: 'text.secondary',
                        display: 'block',
                        lineHeight: 1.2,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </Typography>
                  ))}
                  {dayAppointments.slice(0, 3).map((appointment) => {
                    const meta = getAppointmentStatusMeta(appointment.status);
                    return (
                      <Chip
                        key={appointment.id}
                        draggable
                        size="small"
                        label={`${new Date(appointment.startTime).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })} ${appointment.type}`}
                        color={meta.color}
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/appointment-id', appointment.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onClick={() => onSelectAppointment?.(appointment)}
                        sx={{ justifyContent: 'flex-start' }}
                      />
                    );
                  })}
                  {dayAppointments.length > 3 ? (
                    <Typography variant="caption" color="text.secondary">
                      +{dayAppointments.length - 3} more
                    </Typography>
                  ) : null}
                </Stack>
              </Paper>
            </Grid>
          );
        })}
      </Grid>
    </Box>
  );
};
