// apps/web/src/shared/components/specialty/SpecialtyMdtBanner.tsx
//
// Reusable MDT banner shown at the top of each specialty tab
// (Internal Medicine, Endocrinology, Paediatrics, …). Mirrors the
// MDT card that EpisodesTab shows on the Mental Health side, but
// scoped to the patient's most recent active episode in the given
// specialty rather than a specific episode id.
//
// Lookup chain (entirely client-side, no new backend endpoint):
//   1. GET episodes/patient/:patientId           — list patient episodes
//   2. Filter to status='open' and specialty_code=<specialty>
//   3. Pick the most recent (newest start_date)
//   4. GET episodes/:id/allocation               — fetch its MDT
//   5. Render orgUnit + key clinician + MDT roles + role names
//
// Tap the banner to launch the existing MDT edit dialog from
// EpisodesTab — the dialog is a self-contained Dialog component,
// the user just needs to navigate to the Episodes tab to edit
// (we surface a link rather than re-mounting the dialog here so
// there's exactly one MDT-edit code path per app).
import GroupsIcon from '@mui/icons-material/Groups'
import { Box, Card, CardContent, Chip, CircularProgress, Typography } from '@mui/material'
import { useQuery } from '@tanstack/react-query'
import type { SpecialtyType } from '@signacare/shared'
import { apiClient } from '../../services/apiClient'
import { sharedSpecialtyKeys } from '../../queryKeys'

interface Props {
  patientId: string
  specialty: SpecialtyType
  /** Display label for the banner (e.g. "Internal Medicine MDT"). */
  specialtyLabel: string
}

interface EpisodeRow {
  id: string
  status?: string
  specialty_code?: string
  specialtyCode?: string
  title?: string | null
  start_date?: string
  startDate?: string
}

interface MdtRow {
  staffId: string
  roleName: string
  staffName?: string
}

interface AllocationResponse {
  episodeId: string
  orgUnitId: string | null
  teamName: string | null
  primaryClinicianId: string | null
  mdt: MdtRow[]
}

function pickActiveEpisodeForSpecialty(
  episodes: EpisodeRow[],
  specialty: SpecialtyType,
): EpisodeRow | null {
  const matching = episodes.filter((e) => {
    const status = e.status ?? 'open'
    const specCode = e.specialtyCode ?? e.specialty_code
    return status === 'open' && specCode === specialty
  })
  if (matching.length === 0) return null
  // Newest start date wins (defensive: fall back to id-string compare).
  return matching.sort((a, b) => {
    const da = a.startDate ?? a.start_date ?? ''
    const db = b.startDate ?? b.start_date ?? ''
    return db.localeCompare(da)
  })[0] ?? null
}

export function SpecialtyMdtBanner({ patientId, specialty, specialtyLabel }: Props) {
  // Episode list — this is a wide query other tabs already use, so the
  // cache is usually warm when the banner mounts.
  const { data: episodesData, isLoading: epsLoading } = useQuery<{ data: EpisodeRow[] }>({
    queryKey: sharedSpecialtyKeys.patientEpisodes(patientId),
    queryFn: () => apiClient.get<{ data: EpisodeRow[] }>(`episodes/patient/${patientId}`),
    staleTime: 30_000,
    enabled: !!patientId,
  })

  const episodes = episodesData?.data ?? []
  const activeEpisode = pickActiveEpisodeForSpecialty(episodes, specialty)

  const { data: alloc, isLoading: allocLoading } = useQuery<AllocationResponse>({
    queryKey: sharedSpecialtyKeys.episodeAllocation(activeEpisode?.id),
    queryFn: () => apiClient.get<AllocationResponse>(`episodes/${activeEpisode!.id}/allocation`),
    enabled: !!activeEpisode?.id,
    staleTime: 30_000,
  })

  const isLoading = epsLoading || (!!activeEpisode && allocLoading)

  return (
    <Card variant="outlined" sx={{ mb: 2, borderColor: '#E8E8E8' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <GroupsIcon sx={{ fontSize: 18, color: '#327C8D' }} />
          <Typography variant="overline" sx={{ fontSize: 10, color: '#327C8D', letterSpacing: 1 }}>
            {specialtyLabel} MDT
          </Typography>
          {isLoading && <CircularProgress size={14} sx={{ ml: 1 }} />}
        </Box>

        {!isLoading && !activeEpisode && (
          <Typography variant="caption" color="text.secondary">
            No active {specialtyLabel.toLowerCase()} episode for this patient. Open an episode from
            the Mental Health → Episodes tab to allocate an MDT.
          </Typography>
        )}

        {!isLoading && activeEpisode && (
          <Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
              Episode: {activeEpisode.title ?? '(untitled)'}
              {alloc?.teamName ? ` · Team: ${alloc.teamName}` : ''}
            </Typography>
            {(!alloc || alloc.mdt.length === 0) ? (
              <Typography variant="caption" color="text.secondary">
                No MDT allocated yet — edit from the Episodes tab.
              </Typography>
            ) : (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                {alloc.mdt.map((m, i) => (
                  <Chip
                    key={`${m.staffId}-${i}`}
                    size="small"
                    label={`${m.roleName}: ${m.staffName ?? '—'}`}
                    sx={{
                      fontSize: 10,
                      bgcolor: '#EEF7FA',
                      color: '#327C8D',
                      '& .MuiChip-label': { px: 1 },
                    }}
                  />
                ))}
              </Box>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}

export default SpecialtyMdtBanner
