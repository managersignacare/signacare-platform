import React from 'react';
import { AvailabilityBlock, type AppointmentMode, type AppointmentResponse } from '@signacare/shared';
import { Box, Paper, Tooltip, Typography } from '@mui/material';
import {
  buildRescheduledTimes,
  getAvailabilityColourForSlot,
  listAvailabilityBlocksForSlot,
  summarizeAvailabilityForSlot,
} from './schedulingWorkspaceSupport';

export type DragSlot = `${string}|${string}`;

export interface AppointmentSummary {
  clinicianId: string;
  clinicianName: string;
  date: string;
  endTimeLabel: string;
  modeLabel: string;
  raw: AppointmentResponse;
  startHour: number;
  startTimeLabel: string;
  teamId: string | null;
  teamName: string;
  title: string;
}

const HOURS = Array.from({ length: 12 }, (_, index) => index + 7);

export function appointmentModeLabel(mode?: AppointmentMode | null, telehealthLink?: string | null): string {
  switch (mode) {
    case 'direct':
      return 'Direct';
    case 'telehealth':
      return 'Telehealth';
    case 'videoconference':
      return 'Videoconference';
    case 'other':
      return 'Other';
    default:
      return telehealthLink ? 'Videoconference' : 'Direct';
  }
}

export function DayWeekGrid({
  appointments,
  availabilityBlocks,
  dates,
  dayLabels,
  draggingAppointmentId,
  dropTargetSlot,
  slotMinutes,
  onDragHoverSlot,
  onDragEndAppointment,
  onDragStartAppointment,
  onDropAppointment,
  onCreateSlot,
  onSelect,
}: {
  appointments: AppointmentSummary[];
  availabilityBlocks: readonly AvailabilityBlock[];
  dates: Date[];
  dayLabels: string[];
  draggingAppointmentId: string | null;
  dropTargetSlot: DragSlot | null;
  slotMinutes: number;
  onDragHoverSlot: (slot: DragSlot | null) => void;
  onDragEndAppointment: () => void;
  onDragStartAppointment: (appointment: AppointmentResponse) => void;
  onDropAppointment: (appointment: AppointmentResponse, date: string, startTime: string) => void;
  onCreateSlot: (date: string, startTime: string) => void;
  onSelect: (appointment: AppointmentResponse) => void;
}) {
  return (
    <Paper variant="outlined" sx={{ overflow: 'auto' }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: `60px repeat(${dates.length}, 1fr)`, minWidth: dates.length > 5 ? 920 : 720 }}>
        <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, bgcolor: '#FBF8F5' }} />
        {dates.map((date, index) => {
          const isToday = date.toDateString() === new Date().toDateString();
          return (
            <Box key={date.toISOString()} sx={{ borderBottom: '1px solid', borderLeft: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'center', bgcolor: isToday ? '#FFF3E0' : '#FBF8F5' }}>
              <Typography variant="caption" fontWeight={600} sx={{ color: isToday ? '#b8621a' : '#3D484B' }}>
                {dayLabels[index]}
              </Typography>
              <Typography variant="caption" display="block" sx={{ color: isToday ? '#b8621a' : 'text.secondary' }}>
                {date.getDate()}
              </Typography>
            </Box>
          );
        })}

        {HOURS.map((hour) => (
          <React.Fragment key={hour}>
            <Box sx={{ borderBottom: '1px solid', borderColor: 'divider', p: 0.5, textAlign: 'right', pr: 1 }}>
              <Typography variant="caption" color="text.secondary">
                {`${hour}:00`}
              </Typography>
            </Box>
            {dates.map((date) => {
              const iso = date.toISOString().slice(0, 10);
              const slotAppointments = appointments.filter((appointment) => appointment.date === iso && appointment.startHour === hour);
              const slotKey = `${iso}|${String(hour).padStart(2, '0')}:00` as DragSlot;
              const slotBlocks = listAvailabilityBlocksForSlot(
                availabilityBlocks,
                iso,
                hour * 60,
                Math.max(slotMinutes, 60),
              );
              const slotTooltip = slotBlocks
                .map((block) => block.label?.trim() || block.notes?.trim())
                .filter((value): value is string => Boolean(value))
                .join(' · ');
              const slotSummary = summarizeAvailabilityForSlot(
                availabilityBlocks,
                iso,
                hour * 60,
                Math.max(slotMinutes, 60),
              );
              const availabilityColour = getAvailabilityColourForSlot(
                availabilityBlocks,
                iso,
                hour * 60,
                Math.max(slotMinutes, 60),
              );
              return (
                <Tooltip key={`${iso}-${hour}`} title={slotTooltip || ''} disableHoverListener={!slotTooltip}>
                  <Box
                    role="button"
                    tabIndex={0}
                    aria-label={`Create appointment on ${iso} at ${String(hour).padStart(2, '0')}:00`}
                    sx={{
                      borderBottom: '1px solid',
                      borderLeft: '1px solid',
                      borderColor: 'divider',
                      minHeight: 54,
                      p: 0.25,
                      cursor: 'pointer',
                      bgcolor: dropTargetSlot === slotKey
                        ? '#FFF3E0'
                        : availabilityColour === 'red'
                          ? '#FFEBEE'
                          : availabilityColour === 'yellow'
                            ? '#FFF8E1'
                            : availabilityColour === 'green'
                              ? '#F1F8E9'
                              : undefined,
                    }}
                    onClick={() => onCreateSlot(iso, `${String(hour).padStart(2, '0')}:00`)}
                    onDragOver={(event) => {
                      if (draggingAppointmentId) {
                        event.preventDefault();
                        onDragHoverSlot(slotKey);
                      }
                    }}
                    onDrop={(event) => {
                      if (!draggingAppointmentId) return;
                      event.preventDefault();
                      const appointmentId = event.dataTransfer.getData('text/appointment-id');
                      const appointment = appointments.find((row) => row.raw.id === appointmentId);
                      if (appointment) {
                        onDropAppointment(
                          appointment.raw,
                          iso,
                          `${String(hour).padStart(2, '0')}:00`,
                        );
                      }
                      onDragHoverSlot(null);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onCreateSlot(iso, `${String(hour).padStart(2, '0')}:00`);
                      }
                    }}
                  >
                    {slotSummary.primaryText ? (
                      <Box
                        sx={{
                          mb: slotAppointments.length ? 0.35 : 0,
                          px: 0.5,
                          py: 0.35,
                          borderRadius: 0.5,
                          bgcolor:
                            availabilityColour === 'red'
                              ? 'rgba(211, 47, 47, 0.10)'
                              : availabilityColour === 'yellow'
                                ? 'rgba(197, 138, 0, 0.10)'
                                : availabilityColour === 'green'
                                  ? 'rgba(46, 125, 50, 0.10)'
                                  : 'rgba(61, 72, 75, 0.06)',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            display: 'block',
                            fontSize: 9,
                            fontWeight: 700,
                            lineHeight: 1.15,
                            color:
                              availabilityColour === 'red'
                                ? '#9A1F1F'
                                : availabilityColour === 'yellow'
                                  ? '#8A5A00'
                                  : availabilityColour === 'green'
                                    ? '#2E7D32'
                                    : '#3D484B',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {slotSummary.primaryText}
                        </Typography>
                        {slotSummary.primaryNote && slotSummary.primaryNote !== slotSummary.primaryText ? (
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'block',
                              fontSize: 8,
                              lineHeight: 1.15,
                              color: 'text.secondary',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {slotSummary.primaryNote}
                          </Typography>
                        ) : null}
                      </Box>
                    ) : null}
                    {slotAppointments.map((appointment) => (
                      <Tooltip key={appointment.raw.id} title={`${appointment.clinicianName} | ${appointment.modeLabel}`}>
                        <Box
                          draggable
                          role="button"
                          tabIndex={0}
                          sx={{
                            bgcolor: '#E3F2FD',
                            borderLeft: '3px solid #2196F3',
                            borderRadius: 0.5,
                            p: 0.5,
                            mb: 0.25,
                            cursor: 'pointer',
                            opacity: draggingAppointmentId === appointment.raw.id ? 0.55 : 1,
                          }}
                          onDragEnd={onDragEndAppointment}
                          onDragStart={(event) => {
                            event.dataTransfer.setData('text/appointment-id', appointment.raw.id);
                            event.dataTransfer.effectAllowed = 'move';
                            onDragStartAppointment(appointment.raw);
                          }}
                          onClick={(event) => {
                            event.stopPropagation();
                            onSelect(appointment.raw);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.stopPropagation();
                              onSelect(appointment.raw);
                            }
                          }}
                        >
                          <Typography variant="caption" fontWeight={600} sx={{ fontSize: 10, display: 'block', lineHeight: 1.2 }}>
                            {appointment.title}
                          </Typography>
                          <Typography variant="caption" sx={{ fontSize: 9, color: 'text.secondary' }}>
                            {appointment.startTimeLabel}–{appointment.endTimeLabel}
                          </Typography>
                        </Box>
                      </Tooltip>
                    ))}
                  </Box>
                </Tooltip>
              );
            })}
          </React.Fragment>
        ))}
      </Box>
    </Paper>
  );
}

export function ListView({
  appointments,
  onSelect,
}: {
  appointments: AppointmentSummary[];
  onSelect: (appointment: AppointmentResponse) => void;
}) {
  const sorted = [...appointments].sort((left, right) =>
    `${left.raw.startTime}`.localeCompare(`${right.raw.startTime}`),
  );
  if (!sorted.length) {
    return (
      <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No appointments to display.</Typography>
      </Paper>
    );
  }

  return (
    <Box>
      {sorted.map((appointment) => (
        <Paper
          key={appointment.raw.id}
          variant="outlined"
          component="button"
          type="button"
          sx={{ p: 1.5, cursor: 'pointer', '&:hover': { borderColor: '#b8621a' }, textAlign: 'left', width: '100%', background: '#fff', mb: 1 }}
          onClick={() => onSelect(appointment.raw)}
        >
          <Typography variant="body2" fontWeight={600}>
            {appointment.title}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {new Date(appointment.raw.startTime).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })} | {appointment.startTimeLabel}–{appointment.endTimeLabel} | {appointment.clinicianName} | {appointment.teamName} | {appointment.modeLabel}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}

export { buildRescheduledTimes };
