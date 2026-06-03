/**
 * Kanban Board using @dnd-kit — native React 18 + StrictMode support.
 * Cards can be dragged between columns. Dropping on "Discharged" triggers
 * discharge; dropping on "On Leave" triggers leave recording.
 */
import { useState } from 'react';
import {
  DndContext, DragOverlay, closestCenter, PointerSensor, KeyboardSensor, useSensor, useSensors,
  type DragStartEvent, type DragEndEvent,
} from '@dnd-kit/core';
import {
  useSortable,
  SortableContext,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Avatar, Box, Button, Card, CardContent, Chip, Paper, Typography } from '@mui/material';

type BedRow = {
  id: string;
  status: string;
  patientId?: string;
  patient_id?: string;
  patientGivenName?: string;
  patient_given_name?: string;
  patientFamilyName?: string;
  patient_family_name?: string;
  emrNumber?: string;
  emr_number?: string;
  admittedAt?: string;
  admitted_at?: string;
  bedLabel?: string;
  bedNumber?: string;
  bed_label?: string;
  bed_number?: string;
  ward?: string;
};

interface KanbanBoardProps {
  allBeds: BedRow[];
  columns: readonly string[];
  columnColors: Record<string, string>;
  onDischarge: (bedId: string) => void;
  onLeave: (bedId: string) => void;
  onAdmit: (bed: BedRow) => void;
}

export default function KanbanBoard({ allBeds, columns, columnColors, onDischarge, onLeave, onAdmit }: KanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Require 5px movement before drag starts — prevents accidental drags on click.
  // KeyboardSensor + sortableKeyboardCoordinates lets assistive-tech users move
  // cards between columns with Tab (focus) → Space (pick up) → arrow keys
  // (navigate) → Space (drop) — WCAG SC 2.1.1 Keyboard.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const getColumnBeds = (column: string): BedRow[] => {
    switch (column) {
      case 'Admitted': return allBeds.filter((b: BedRow) => b.status === 'occupied' && (b.patientId ?? b.patient_id));
      case 'On Leave': return allBeds.filter((b: BedRow) => b.status === 'on_leave' || b.status === 'onLeave');
      case 'Discharged': return allBeds.filter((b: BedRow) => b.status === 'discharged');
      case 'Pre-Admission': return allBeds.filter((b: BedRow) => b.status === 'available');
      case 'Under Review': return allBeds.filter((b: BedRow) => b.status === 'maintenance' || b.status === 'closed');
      case 'Discharge Planning': return allBeds.filter((b: BedRow) => b.status === 'discharge_pending' || b.status === 'dischargePending');
      default: return [];
    }
  };

  // Find which column a bed belongs to
  const findColumn = (bedId: string): string | null => {
    for (const col of columns) {
      if (getColumnBeds(col).some((b: BedRow) => getBedId(b) === bedId)) return col;
    }
    return null;
  };

  const getBedId = (b: BedRow, index?: number) => String(b.id ?? `bed-${index ?? 0}`);

  const activeBed = activeId ? allBeds.find((b: BedRow) => getBedId(b) === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;

    const bedId = String(active.id);
    const overId = String(over.id);

    // Check if dropped on a column droppable
    const targetColumn = columns.some((column) => column === overId) ? overId : findColumn(overId);
    const sourceColumn = findColumn(bedId);

    if (!targetColumn || targetColumn === sourceColumn) return;

    if (targetColumn === 'Discharged') {
      if (confirm('Discharge this patient from the bed?')) onDischarge(bedId);
    } else if (targetColumn === 'On Leave') {
      onLeave(bedId);
    }
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
        {columns.map(column => {
          const columnBeds = getColumnBeds(column);
          const colColor = columnColors[column] ?? '#666';
          const bedIds = columnBeds.map((b: BedRow, i: number) => getBedId(b, i));
          return (
            <DroppableColumn key={column} id={column} color={colColor} label={column} count={columnBeds.length} isOver={false}>
              <SortableContext items={bedIds} strategy={verticalListSortingStrategy}>
                {columnBeds.map((b: BedRow, index: number) => (
                  <SortableBedCard
                    key={getBedId(b, index)}
                    bed={b}
                    bedId={getBedId(b, index)}
                    colColor={colColor}
                    column={column}
                    onAdmit={onAdmit}
                    onLeave={onLeave}
                    onDischarge={onDischarge}
                  />
                ))}
              </SortableContext>
              {columnBeds.length === 0 && (
                <Box sx={{ p: 2, textAlign: 'center', border: '1px dashed #E0E0E0', borderRadius: 1, bgcolor: '#FAFAFA' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                    {column === 'Discharged' || column === 'On Leave' ? 'Drag patient here' : 'No patients'}
                  </Typography>
                </Box>
              )}
            </DroppableColumn>
          );
        })}
      </Box>

      {/* Drag overlay — shows the card being dragged */}
      <DragOverlay>
        {activeBed ? <BedCardContent bed={activeBed} colColor="#327C8D" column="" /> : null}
      </DragOverlay>
    </DndContext>
  );
}

// ── Droppable Column ─────────────────────────────────────────────────────────

import { useDroppable } from '@dnd-kit/core';

function DroppableColumn({ id, color, label, count, children }: { id: string; color: string; label: string; count: number; isOver: boolean; children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({ id });
  return (
    <Paper
      ref={setNodeRef}
      variant="outlined"
      sx={{
        minWidth: 260, flex: '0 0 260px',
        bgcolor: isOver ? '#EAF4F6' : '#F8F9FA',
        borderRadius: 2, overflow: 'hidden',
        outline: isOver ? `2px dashed ${color}` : 'none',
        transition: 'background 0.15s, outline 0.15s',
      }}
    >
      <Box sx={{ p: 1.5, bgcolor: '#fff', borderBottom: `3px solid ${color}`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 13, color }}>{label}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{count} patient{count !== 1 ? 's' : ''}</Typography>
        </Box>
        <Avatar sx={{ width: 24, height: 24, fontSize: 11, fontWeight: 700, bgcolor: color }}>{count}</Avatar>
      </Box>
      <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 1, minHeight: 120 }}>
        {children}
      </Box>
    </Paper>
  );
}

// ── Sortable Bed Card ────────────────────────────────────────────────────────

function SortableBedCard({ bed, bedId, colColor, column, onAdmit, onLeave, onDischarge }: {
  bed: BedRow; bedId: string; colColor: string; column: string;
  onAdmit: (b: BedRow) => void; onLeave: (id: string) => void; onDischarge: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: bedId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <BedCardContent bed={bed} colColor={colColor} column={column} onAdmit={onAdmit} onLeave={onLeave} onDischarge={onDischarge} />
    </div>
  );
}

// ── Bed Card Content (shared between sortable + drag overlay) ────────────────

function BedCardContent({ bed: b, colColor, column, onAdmit, onLeave, onDischarge }: {
  bed: BedRow; colColor: string; column: string;
  onAdmit?: (b: BedRow) => void; onLeave?: (id: string) => void; onDischarge?: (id: string) => void;
}) {
  const gn = b.patientGivenName ?? b.patient_given_name ?? '';
  const fn = b.patientFamilyName ?? b.patient_family_name ?? '';
  const patientName = (gn || fn) ? `${gn} ${fn}`.trim() : null;
  const emr = b.emrNumber ?? b.emr_number ?? '';
  const admittedAt = b.admittedAt ?? b.admitted_at;
  const daysIn = admittedAt ? Math.floor((Date.now() - new Date(admittedAt).getTime()) / 86400000) : null;
  const initials = patientName ? patientName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) : '?';

  return (
    <Card variant="outlined" sx={{ borderLeft: `4px solid ${colColor}`, cursor: 'grab', '&:hover': { boxShadow: 2 }, '&:active': { cursor: 'grabbing' } }}>
      <CardContent sx={{ py: 1, px: 1.5, '&:last-child': { pb: 1 } }}>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
          <Avatar sx={{ width: 28, height: 28, fontSize: 10, fontWeight: 700, bgcolor: colColor, mt: 0.25 }}>{initials}</Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="body2" fontWeight={700} sx={{ fontSize: 12, lineHeight: 1.2 }}>{patientName || 'Available'}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10, display: 'block' }}>
              Bed {b.bedLabel ?? b.bedNumber ?? b.bed_label ?? b.bed_number} · {b.ward}
            </Typography>
            {emr && <Typography variant="caption" color="text.secondary" sx={{ fontSize: 9 }}>EMR: {emr}</Typography>}
          </Box>
          {daysIn != null && daysIn >= 0 && (
            <Chip label={`${daysIn}d`} size="small" sx={{ fontSize: 8, height: 16, bgcolor: daysIn > 14 ? '#FDECEA' : daysIn > 7 ? '#FFF8E1' : '#E8F5E9', color: daysIn > 14 ? '#D32F2F' : daysIn > 7 ? '#E65100' : '#2E7D32' }} />
          )}
        </Box>
        {column === 'Pre-Admission' && onAdmit && (
          <Button size="small" variant="text" onPointerDown={(e) => e.stopPropagation()} onClick={() => onAdmit(b)}
            sx={{ fontSize: 9, textTransform: 'none', color: '#327C8D', mt: 0.5, px: 0.5 }}>Admit</Button>
        )}
        {column === 'Admitted' && b.id && onLeave && onDischarge && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, justifyContent: 'flex-end' }}>
            <Button size="small" variant="text" onPointerDown={(e) => e.stopPropagation()} onClick={() => onLeave(b.id)}
              sx={{ fontSize: 9, textTransform: 'none', color: '#E65100', minWidth: 0, px: 0.5 }}>Leave</Button>
            <Button size="small" variant="text" onPointerDown={(e) => e.stopPropagation()} onClick={() => { if (confirm('Discharge?')) onDischarge(b.id); }}
              sx={{ fontSize: 9, textTransform: 'none', color: '#D32F2F', minWidth: 0, px: 0.5 }}>D/C</Button>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
