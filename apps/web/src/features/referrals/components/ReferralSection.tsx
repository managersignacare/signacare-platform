import AttachFileIcon from '@mui/icons-material/AttachFile'
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
  Paper,
} from '@mui/material'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { isActiveIntakeReferralStatus } from '../utils/referralsUiHelpers'

const STATUS_OPTIONS = [
  { value: 'received', label: 'Received', color: 'info' as const },
  { value: 'under_review', label: 'Reviewing', color: 'warning' as const },
  { value: 'accepted', label: 'Accepted', color: 'success' as const },
  { value: 'rejected', label: 'Rejected', color: 'error' as const },
]

export interface ReferralSectionItem {
  id: string
  referralNumber: string
  referralDate: string
  source: string
  fromService: string
  fromProviderName: string | null
  reason: string
  urgency: string
  status: string
  patientId: string | null
  patientGivenName?: string
  patientFamilyName?: string
  patientDob?: string
  hasAttachment: boolean
  createdAt: string
}

interface ReferralSectionProps {
  title: string
  color: string
  chipColor: 'info' | 'warning' | 'success' | 'error' | 'default'
  items: ReferralSectionItem[]
  isLoading: boolean
  showActions?: boolean
  onReview?: (id: string) => void
  onAccept?: (r: ReferralSectionItem) => void
  onAcceptExt?: (r: ReferralSectionItem) => void
  onReject?: (r: ReferralSectionItem) => void
}

export function ReferralSection({
  title,
  color,
  chipColor,
  items,
  isLoading,
  showActions,
  onReview,
  onAccept,
  onAcceptExt,
  onReject,
}: ReferralSectionProps) {
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Paper
      elevation={0}
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        mb: 2,
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={`${title} section — ${collapsed ? 'show' : 'hide'}`}
        onClick={() => setCollapsed(!collapsed)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(!collapsed)
          }
        }}
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: color,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          cursor: 'pointer',
          '&:focus-visible': { outline: '2px solid #b8621a', outlineOffset: -2 },
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            variant="subtitle1"
            fontWeight={700}
            fontFamily="Albert Sans, sans-serif"
            sx={{ color: '#3D484B' }}
          >
            {title}
          </Typography>
          <Chip label={items.length} size="small" color={chipColor} sx={{ fontSize: 11, fontWeight: 700 }} />
        </Box>
        <Typography variant="caption" color="text.secondary">
          {collapsed ? 'Show' : 'Hide'}
        </Typography>
      </Box>
      {!collapsed && (
        <TableContainer role="region" aria-label={title}>
          <Table size="small">
            <TableHead>
              <TableRow>
                {[
                  'Family Name',
                  'Given Name',
                  'DOB',
                  'Referral #',
                  'Date',
                  'Source',
                  'Urgency',
                  'Status',
                  '',
                  ...(showActions ? ['Actions'] : []),
                ].map((col) => (
                  <TableCell
                    key={col}
                    sx={{
                      fontFamily: 'Albert Sans, sans-serif',
                      fontWeight: 600,
                      fontSize: 12,
                      color: '#3D484B',
                      backgroundColor: '#FAFAFA',
                    }}
                  >
                    {col}
                  </TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                    <CircularProgress role="progressbar" aria-label="Loading" size={24} sx={{ color: '#b8621a' }} />
                  </TableCell>
                </TableRow>
              ) : !items.length ? (
                <TableRow>
                  <TableCell colSpan={10} align="center" sx={{ py: 4 }}>
                    <Typography variant="body2" color="text.secondary">
                      None
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((r) => (
                  <TableRow
                    key={r.id}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => {
                      if (r.patientId) navigate(`/patients/${r.patientId}`)
                    }}
                  >
                    <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontWeight: 600, color: '#b8621a', fontSize: 13 }}>
                      {r.patientFamilyName || '—'}
                    </TableCell>
                    <TableCell sx={{ fontFamily: 'Albert Sans, sans-serif', fontSize: 13 }}>{r.patientGivenName || '—'}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.patientDob ? new Date(r.patientDob).toLocaleDateString('en-AU') : '—'}</TableCell>
                    <TableCell sx={{ fontWeight: 500, color: '#327C8D', fontSize: 12 }}>{r.referralNumber}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{new Date(r.referralDate).toLocaleDateString('en-AU')}</TableCell>
                    <TableCell sx={{ fontSize: 12 }}>{r.source || r.fromService}</TableCell>
                    <TableCell>
                      <Chip
                        label={r.urgency}
                        size="small"
                        color={r.urgency === 'emergency' ? 'error' : r.urgency === 'urgent' ? 'warning' : 'default'}
                        sx={{ textTransform: 'capitalize', fontSize: 10 }}
                      />
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={STATUS_OPTIONS.find((o) => o.value === r.status)?.label ?? r.status}
                        size="small"
                        color={STATUS_OPTIONS.find((o) => o.value === r.status)?.color ?? 'default'}
                        sx={{ fontSize: 10 }}
                      />
                    </TableCell>
                    <TableCell>{r.hasAttachment && <Tooltip title="Has attachment"><AttachFileIcon sx={{ fontSize: 16, color: '#b8621a' }} /></Tooltip>}</TableCell>
                    {showActions && (
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {(() => {
                          const status = (r.status ?? '').toLowerCase()
                          const canReview = status === 'received' && !!onReview
                          const canDecide = isActiveIntakeReferralStatus(status)
                          if (!canReview && !canDecide) return null
                          return (
                            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'nowrap' }}>
                              {canReview && onReview && (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  sx={{ fontSize: 10, py: 0, minWidth: 0, px: 1 }}
                                  onClick={() => onReview(r.id)}
                                >
                                  Review
                                </Button>
                              )}
                              {canDecide && (
                                <>
                                  {onAccept && (
                                    <Button
                                      size="small"
                                      variant="contained"
                                      color="success"
                                      sx={{ fontSize: 10, py: 0, minWidth: 0, px: 1 }}
                                      onClick={() => onAccept(r)}
                                    >
                                      Accept
                                    </Button>
                                  )}
                                  {onAcceptExt && (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color="success"
                                      sx={{ fontSize: 10, py: 0, minWidth: 0, px: 1 }}
                                      title="Accept to external provider"
                                      onClick={() => onAcceptExt(r)}
                                    >
                                      Accept (Ext)
                                    </Button>
                                  )}
                                  {onReject && (
                                    <Button
                                      size="small"
                                      variant="outlined"
                                      color="error"
                                      sx={{ fontSize: 10, py: 0, minWidth: 0, px: 1 }}
                                      onClick={() => onReject(r)}
                                    >
                                      Reject
                                    </Button>
                                  )}
                                </>
                              )}
                            </Box>
                          )
                        })()}
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  )
}
