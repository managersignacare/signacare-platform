import React from 'react';
import {
  Card,
  CardContent,
  Chip,
  Divider,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import EventAvailableIcon from '@mui/icons-material/EventAvailable';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import AssignmentTurnedInIcon from '@mui/icons-material/AssignmentTurnedIn';
import { useNavigate } from 'react-router-dom';
import type { TodayViewResponse } from '@signacare/shared';

interface Props {
  data: TodayViewResponse;
  mode?: 'summary' | 'contacts' | 'dna';
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-AU', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_COLOUR: Record<string, 'default' | 'primary' | 'success' | 'warning' | 'error'> = {
  scheduled: 'default',
  confirmed: 'primary',
  arrived: 'primary',
  in_session: 'primary',
  completed: 'success',
  cancelled: 'warning',
  no_show: 'error',
};

function AppointmentsCard({ data }: { data: TodayViewResponse }) {
  const navigate = useNavigate();
  const { appointments, counts } = data;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <EventAvailableIcon color="primary" />
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Appointments
          </Typography>
          <Chip size="small" label={appointments.length} />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {appointments.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            Nothing scheduled.
          </Typography>
        ) : (
          <List dense disablePadding>
            {appointments.map((a) => (
              <ListItemButton
                key={a.id}
                onClick={() => navigate(`/patients/${a.patientId}`)}
              >
                <ListItemText
                  primary={`${formatClock(a.appointmentStart)} — ${a.patientName}`}
                  secondary={a.appointmentType}
                />
                <Chip
                  size="small"
                  label={a.status}
                  color={STATUS_COLOUR[a.status] ?? 'default'}
                />
              </ListItemButton>
            ))}
          </List>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Scheduled {counts.scheduled} · Confirmed {counts.confirmed} · Arrived {counts.arrived} · In session {counts.inSession} · Completed {counts.completed} · Cancelled {counts.cancelled}
        </Typography>
      </CardContent>
    </Card>
  );
}

function ContactsCard({ data }: { data: TodayViewResponse }) {
  const navigate = useNavigate();
  const { contacts, counts } = data;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <AssignmentTurnedInIcon color="success" />
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Contacts completed
          </Typography>
          <Chip size="small" label={contacts.length} />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {contacts.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No contacts recorded yet.
          </Typography>
        ) : (
          <List dense disablePadding>
            {contacts.map((c) => (
              <ListItemButton
                key={c.id}
                onClick={() => navigate(`/patients/${c.patientId}`)}
              >
                <ListItemText
                  primary={c.patientName}
                  secondary={`${c.durationMinutes} min · ${c.status}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          Draft {counts.contactsDraft} · Signed {counts.contactsSigned}
        </Typography>
      </CardContent>
    </Card>
  );
}

function DnaCard({ data }: { data: TodayViewResponse }) {
  const navigate = useNavigate();
  const { dnas, counts } = data;

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} mb={1}>
          <EventBusyIcon color="error" />
          <Typography variant="subtitle1" sx={{ flex: 1 }}>
            Did not attend
          </Typography>
          <Chip size="small" label={dnas.length} color="error" />
        </Stack>
        <Divider sx={{ mb: 1 }} />
        {dnas.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            No DNAs.
          </Typography>
        ) : (
          <List dense disablePadding>
            {dnas.map((a) => (
              <ListItemButton
                key={a.id}
                onClick={() => navigate(`/patients/${a.patientId}`)}
              >
                <ListItemText
                  primary={`${formatClock(a.appointmentStart)} — ${a.patientName}`}
                  secondary={a.appointmentType}
                />
              </ListItemButton>
            ))}
          </List>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
          No-show count today: {counts.noShow}
        </Typography>
      </CardContent>
    </Card>
  );
}

export const TodayContactsView: React.FC<Props> = ({
  data,
  mode = 'summary',
}) => {
  if (mode === 'contacts') {
    return <ContactsCard data={data} />;
  }

  if (mode === 'dna') {
    return <DnaCard data={data} />;
  }

  return (
    <Stack spacing={2}>
      <AppointmentsCard data={data} />
      <ContactsCard data={data} />
      <DnaCard data={data} />
    </Stack>
  );
};
