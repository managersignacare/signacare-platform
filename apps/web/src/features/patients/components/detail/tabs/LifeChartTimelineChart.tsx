import React from 'react';
import { Box, Divider, Typography } from '@mui/material';
import { RESIDUAL_COLORS, buildContinuousLine, buildWavePath } from './lifeChartDomain';

interface ChartPoint {
  x: number;
  y: number;
}

interface MedicationBar {
  id: string;
  name: string;
  dose?: string | null;
  x1: number;
  x2: number;
  y: number;
  color: string;
  active: boolean;
}

interface EpisodeCurve {
  id: string;
  x1: number;
  x2: number;
  w: number;
  direction: 'up' | 'down' | 'both';
  color: string;
  typeLabel: string;
  onsetX: number;
  remissionX: number;
  ongoing: boolean;
  startDate?: string | null;
  endDate?: string | null;
  diagnosis?: string | null;
  title?: string | null;
  durationLabel?: string | null;
  symptomChannel?: string;
  evidenceAnchors?: string[];
  pts: ChartPoint[];
  path: string;
  peakY: number;
}

interface TimelineAnnotation {
  x: number;
  label: string;
  color: string;
  direction: 'up' | 'down';
  date: string;
  priority?: number;
}

interface ResidualHit {
  x: number;
  label: string;
  category: string;
  date: string;
}

interface SubstanceHit {
  x: number;
  label: string;
  date: string;
}

interface CareEpisodeBlock {
  id: string;
  x: number;
  width: number;
  y: number;
  color: string;
  isOpen: boolean;
  label: string;
  startDate: string | null;
  endDate: string | null;
  status: string | null;
}

interface LifeChartTimelineChartProps {
  totalWidth: number;
  totalHeight: number;
  years: number[];
  leftLabel: number;
  yearWidth: number;
  symptomBaselineY: number;
  medicationHeight: number;
  chartWidth: number;
  medicationBars: MedicationBar[];
  symptomScale: number;
  isBipolar: boolean;
  primaryDomainLabel: string;
  symptomPoints: ChartPoint[];
  isContinuous: boolean;
  episodeCurves: EpisodeCurve[];
  annotations: TimelineAnnotation[];
  residualTopY: number;
  residualCategories: string[];
  residuals: ResidualHit[];
  substanceTopY: number;
  substances: SubstanceHit[];
  careTopY: number;
  careEpisodeBlocks: CareEpisodeBlock[];
  eventTopY: number;
}

export function LifeChartTimelineChart({
  totalWidth: TOTAL_WIDTH,
  totalHeight: TOTAL_H,
  years,
  leftLabel: LEFT_LABEL,
  yearWidth: YEAR_W,
  symptomBaselineY: SYMPTOM_BASELINE_Y,
  medicationHeight: MED_H,
  chartWidth: CHART_WIDTH,
  medicationBars: medBars,
  symptomScale: SYMPTOM_SCALE,
  isBipolar,
  primaryDomainLabel,
  symptomPoints,
  isContinuous,
  episodeCurves,
  annotations: uniqueAnnotations,
  residualTopY: RESIDUAL_TOP_Y,
  residualCategories,
  residuals: uniqueResiduals,
  substanceTopY: SUBSTANCE_TOP_Y,
  substances: uniqueSubstances,
  careTopY: CARE_TOP_Y,
  careEpisodeBlocks,
  eventTopY: EVENT_TOP_Y,
}: LifeChartTimelineChartProps) {
  return (
    <>
        <Box sx={{ overflowX: 'auto', pb: 1 }}>
          <svg width={TOTAL_WIDTH} height={TOTAL_H} style={{ fontFamily: 'Albert Sans, sans-serif' }}>
            {years.map((yr, i) => {
              const x = LEFT_LABEL + i * YEAR_W;
              return (
                <g key={yr}>
                  <line x1={x} y1={0} x2={x} y2={TOTAL_H} stroke="#E0E0E0" strokeWidth={0.5} strokeDasharray="4,4" />
                  <text x={x + YEAR_W / 2} y={SYMPTOM_BASELINE_Y + 4} textAnchor="middle" fontSize={10} fill="#CCC" fontWeight={300}>{yr}</text>
                </g>
              );
            })}

            <text x={5} y={12} fontSize={9} fill="#666" fontWeight={700}>Medications</text>
            <line x1={LEFT_LABEL} y1={MED_H} x2={LEFT_LABEL + CHART_WIDTH} y2={MED_H} stroke="#BDBDBD" strokeWidth={1} />
            {medBars.map(m => (
              <g key={m.id}>
                <rect x={m.x1} y={m.y} width={Math.max(m.x2 - m.x1, 3)} height={6} rx={2} fill={m.color} opacity={m.active ? 0.9 : 0.4} />
                {(m.x2 - m.x1) > 50 && <text x={m.x1 + 3} y={m.y + 5} fontSize={5.5} fill="#fff" fontWeight={700}>{m.name} {m.dose}</text>}
                <title>{`${m.name} ${m.dose} (${m.active ? 'active' : 'ceased'})`}</title>
              </g>
            ))}

            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.95} fontSize={7} fill="#999">Severe</text>
            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.6} fontSize={7} fill="#999">Moderate</text>
            <text x={5} y={SYMPTOM_BASELINE_Y - SYMPTOM_SCALE * 0.3} fontSize={7} fill="#999">Mild</text>
            {isBipolar && (
              <>
                <text x={55} y={SYMPTOM_BASELINE_Y - 10} fontSize={9} fill="#D32F2F" fontWeight={700}>Mania / Psychosis ↑</text>
                <text x={55} y={SYMPTOM_BASELINE_Y + 16} fontSize={9} fill="#1565C0" fontWeight={700}>Depression ↓</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.3} fontSize={7} fill="#999">Mild</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.6} fontSize={7} fill="#999">Moderate</text>
                <text x={5} y={SYMPTOM_BASELINE_Y + SYMPTOM_SCALE * 0.95} fontSize={7} fill="#999">Severe</text>
              </>
            )}
            {!isBipolar && (
              <>
                <text x={55} y={SYMPTOM_BASELINE_Y - 10} fontSize={9} fill="#7B1FA2" fontWeight={700}>
                  {primaryDomainLabel} ↑
                </text>
                <text x={5} y={SYMPTOM_BASELINE_Y + 10} fontSize={7} fill="#999">Baseline</text>
              </>
            )}

            {[0.33, 0.66, 1].map(s => (
              <React.Fragment key={s}>
                <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y - s * SYMPTOM_SCALE} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y - s * SYMPTOM_SCALE} stroke="#F5F5F5" strokeWidth={0.5} />
                {isBipolar && <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y + s * SYMPTOM_SCALE} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y + s * SYMPTOM_SCALE} stroke="#F5F5F5" strokeWidth={0.5} />}
              </React.Fragment>
            ))}

            <line x1={LEFT_LABEL} y1={SYMPTOM_BASELINE_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={SYMPTOM_BASELINE_Y} stroke="#333" strokeWidth={1.5} />

            {isContinuous && symptomPoints.length > 2 ? (
              <>
                <path d={buildContinuousLine(symptomPoints)} fill="none" stroke="#7B1FA2" strokeWidth={2} opacity={0.8} />
                <path d={buildWavePath(symptomPoints, SYMPTOM_BASELINE_Y)} fill="#7B1FA2" opacity={0.08} />
                {episodeCurves.slice(0, 24).map((ec) => (
                  <g key={`continuous-marker-${ec.id}`}>
                    <circle cx={ec.onsetX} cy={SYMPTOM_BASELINE_Y} r={2} fill="#fff" stroke="#7B1FA2" strokeWidth={1} />
                    <circle cx={ec.remissionX} cy={SYMPTOM_BASELINE_Y} r={2} fill={ec.ongoing ? '#7B1FA2' : '#fff'} stroke="#7B1FA2" strokeWidth={1} />
                    {ec.w > 20 && (
                      <>
                        <text x={ec.onsetX} y={SYMPTOM_BASELINE_Y - 5} textAnchor="middle" fontSize={5.5} fill="#7B1FA2" fontWeight={700}>
                          {ec.w > 80 ? 'Onset' : 'O'}
                        </text>
                        <text x={ec.remissionX} y={SYMPTOM_BASELINE_Y + 10} textAnchor="middle" fontSize={5.5} fill="#7B1FA2" fontWeight={700}>
                          {ec.w > 80 ? (ec.ongoing ? 'Ongoing' : 'Remission') : (ec.ongoing ? 'Now' : 'R')}
                        </text>
                      </>
                    )}
                  </g>
                ))}
              </>
            ) : (
              episodeCurves.map(ec => (
                <g key={ec.id}>
                  <path d={ec.path} fill={ec.color} opacity={0.25} />
                  <path d={buildContinuousLine(ec.pts)} fill="none" stroke={ec.color} strokeWidth={2} />
                  {ec.w > 30 && (
                    <text x={ec.x1 + ec.w / 2} y={ec.peakY + (ec.direction === 'down' ? 12 : -5)} textAnchor="middle" fontSize={7} fill={ec.color} fontWeight={700}>
                      {ec.typeLabel}
                    </text>
                  )}
                  {ec.w > 24 && ec.durationLabel && (
                    <text x={ec.x1 + ec.w / 2} y={ec.peakY + (ec.direction === 'down' ? 22 : 9)} textAnchor="middle" fontSize={6.5} fill="#333" fontWeight={600}>
                      {ec.durationLabel}
                    </text>
                  )}
                  <line x1={ec.onsetX} y1={SYMPTOM_BASELINE_Y} x2={ec.onsetX} y2={ec.peakY} stroke={ec.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.45} />
                  <line x1={ec.remissionX} y1={SYMPTOM_BASELINE_Y} x2={ec.remissionX} y2={ec.peakY} stroke={ec.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.45} />
                  <circle cx={ec.onsetX} cy={SYMPTOM_BASELINE_Y} r={2.2} fill="#fff" stroke={ec.color} strokeWidth={1.2} />
                  <circle cx={ec.remissionX} cy={SYMPTOM_BASELINE_Y} r={2.2} fill={ec.ongoing ? ec.color : '#fff'} stroke={ec.color} strokeWidth={1.2} />
                  {ec.w > 18 && (
                    <>
                      <text x={ec.onsetX} y={ec.direction === 'down' ? SYMPTOM_BASELINE_Y + 11 : SYMPTOM_BASELINE_Y - 6} textAnchor="middle" fontSize={6} fill={ec.color} fontWeight={700}>
                        {ec.w > 80 ? 'Onset' : 'O'}
                      </text>
                      <text x={ec.remissionX} y={ec.direction === 'down' ? SYMPTOM_BASELINE_Y + 21 : SYMPTOM_BASELINE_Y + 4} textAnchor="middle" fontSize={6} fill={ec.color} fontWeight={700}>
                        {ec.w > 80 ? (ec.ongoing ? 'Ongoing' : 'Remission') : (ec.ongoing ? 'Now' : 'R')}
                      </text>
                    </>
                  )}
                  <title>{`${ec.typeLabel}: ${ec.title ?? ''}\nChannel: ${(ec as { symptomChannel?: string }).symptomChannel ?? 'general'}\nSymptom onset: ${ec.startDate ?? 'unknown'}\nSymptom remission: ${ec.endDate ?? 'ongoing'}\n${ec.diagnosis ?? ''}${((ec as { evidenceAnchors?: string[] }).evidenceAnchors?.length ?? 0) > 0 ? `\nEvidence: ${(ec as { evidenceAnchors?: string[] }).evidenceAnchors?.slice(0, 2).join(' || ')}` : ''}`}</title>
                </g>
              ))
            )}

            {uniqueAnnotations.map((a, i) => (
              <g key={`annot-${i}`}>
                <line x1={a.x} y1={SYMPTOM_BASELINE_Y - (a.direction === 'up' ? 30 : -10)} x2={a.x} y2={SYMPTOM_BASELINE_Y + (a.direction === 'up' ? -10 : 30)} stroke={a.color} strokeWidth={1.2} markerEnd="url(#arrowDown)" />
                <text x={a.x + 4} y={a.direction === 'up' ? SYMPTOM_BASELINE_Y - SYMPTOM_SCALE - 8 - (i % 2) * 12 : (isBipolar ? SYMPTOM_BASELINE_Y + SYMPTOM_SCALE + 12 + (i % 2) * 12 : SYMPTOM_BASELINE_Y + 26 + (i % 2) * 12)} fontSize={7} fill={a.color} fontWeight={600}>
                  {a.label}
                </text>
                <title>{`${a.label}\n${a.date ? new Date(a.date).toLocaleDateString('en-AU') : ''}`}</title>
              </g>
            ))}

            <defs>
              <marker id="arrowDown" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
                <polygon points="0,0 6,3 0,6" fill="#333" />
              </marker>
            </defs>

            <line x1={LEFT_LABEL} y1={RESIDUAL_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={RESIDUAL_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={RESIDUAL_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Residual / Inter-episode</text>
            <text x={5} y={RESIDUAL_TOP_Y + 22} fontSize={7} fill="#999">Symptoms</text>

            {residualCategories.map((cat, ci) => {
              const catItems = uniqueResiduals.filter(r => r.category === cat);
              const rowY = RESIDUAL_TOP_Y + 8 + ci * 12;
              const color = RESIDUAL_COLORS[cat] ?? '#666';
              return (
                <g key={`res-${cat}`}>
                  {catItems.map((r, ri) => (
                    <g key={`res-${cat}-${ri}`}>
                      <circle cx={r.x} cy={rowY} r={3} fill={color} opacity={0.6} />
                      {ri === 0 && <text x={r.x + 6} y={rowY + 3} fontSize={6} fill={color} fontWeight={600}>{r.label}</text>}
                      <title>{`${r.label}\n${new Date(r.date).toLocaleDateString('en-AU')}`}</title>
                    </g>
                  ))}
                  {catItems.length > 1 && (
                    <line x1={Math.min(...catItems.map(c => c.x))} y1={rowY} x2={Math.max(...catItems.map(c => c.x))} y2={rowY} stroke={color} strokeWidth={1} strokeDasharray="3,3" opacity={0.3} />
                  )}
                </g>
              );
            })}

            <line x1={LEFT_LABEL} y1={SUBSTANCE_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={SUBSTANCE_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={SUBSTANCE_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Substance Use Pattern</text>
            {uniqueSubstances.map((item, idx) => {
              const y = SUBSTANCE_TOP_Y + 14 + (idx % 2) * 12;
              return (
                <g key={`substance-${idx}`}>
                  <line x1={item.x} y1={SUBSTANCE_TOP_Y + 1} x2={item.x} y2={y - 3} stroke={RESIDUAL_COLORS.substance} strokeWidth={1} opacity={0.4} />
                  <rect x={item.x - 2} y={y - 2} width={4} height={4} fill={RESIDUAL_COLORS.substance} opacity={0.75} />
                  <text x={item.x + 5} y={y + 1} fontSize={6.5} fill={RESIDUAL_COLORS.substance} fontWeight={600}>
                    {item.label}
                  </text>
                  <title>{`${item.label}\n${new Date(item.date).toLocaleDateString('en-AU')}`}</title>
                </g>
              );
            })}

            <line x1={LEFT_LABEL} y1={CARE_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={CARE_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={CARE_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Care Episodes</text>
            <text x={5} y={CARE_TOP_Y + 22} fontSize={7} fill="#999">Active care windows</text>
            {careEpisodeBlocks.map((bar) => (
              <g key={`care-episode-${bar.id}`}>
                <rect x={bar.x} y={bar.y} width={bar.width} height={6} rx={3} fill={bar.color} opacity={0.75} />
                {bar.isOpen && (
                  <polygon
                    points={`${bar.x - 5},${bar.y + 3} ${bar.x},${bar.y} ${bar.x},${bar.y + 6}`}
                    fill={bar.color}
                    opacity={0.9}
                  />
                )}
                {bar.width > 76 && (
                  <text x={bar.x + 3} y={bar.y + 5} fontSize={5.8} fill="#fff" fontWeight={700}>
                    {bar.label}
                  </text>
                )}
                <title>{`${bar.label}\nStart: ${bar.startDate ?? 'unknown'}\nEnd: ${bar.endDate ?? 'ongoing'}\nStatus: ${bar.status ?? 'unknown'}`}</title>
              </g>
            ))}

            <line x1={LEFT_LABEL} y1={EVENT_TOP_Y} x2={LEFT_LABEL + CHART_WIDTH} y2={EVENT_TOP_Y} stroke="#BDBDBD" strokeWidth={1} />
            <text x={5} y={EVENT_TOP_Y + 12} fontSize={8} fill="#666" fontWeight={700}>Life Events</text>
            {uniqueAnnotations.filter(a => a.direction === 'up').map((ev, i) => (
              <g key={`le-${i}`}>
                <line x1={ev.x} y1={EVENT_TOP_Y} x2={ev.x} y2={EVENT_TOP_Y + 25 + (i % 3) * 15} stroke={ev.color} strokeWidth={0.8} strokeDasharray="2,2" opacity={0.4} />
                <circle cx={ev.x} cy={EVENT_TOP_Y + 28 + (i % 3) * 15} r={3} fill={ev.color} />
                <text x={ev.x + 6} y={EVENT_TOP_Y + 31 + (i % 3) * 15} fontSize={6.5} fill={ev.color} fontWeight={600}>{ev.label}</text>
              </g>
            ))}
          </svg>
        </Box>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mt: 2, px: 1 }}>
          {[
            { color: '#D32F2F', label: 'Mania / Psychosis' },
            { color: '#1565C0', label: 'Depression' },
            { color: '#9C27B0', label: 'Psychotic Episode' },
            { color: '#b8621a', label: 'Anxiety / PTSD' },
            { color: '#E65100', label: 'Personality / Other' },
            { color: '#7B1FA2', label: 'Continuous Symptoms' },
          ].map(l => (
            <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 8, bgcolor: l.color, borderRadius: 0.5, opacity: 0.5 }} />
              <Typography variant="caption" fontSize={9}>{l.label}</Typography>
            </Box>
          ))}
          <Divider orientation="vertical" flexItem />
          {Object.entries(RESIDUAL_COLORS)
            .filter(([cat]) => cat !== 'substance')
            .map(([cat, color]) => (
            <Box key={cat} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, opacity: 0.6 }} />
              <Typography variant="caption" fontSize={9} sx={{ textTransform: 'capitalize' }}>{cat}</Typography>
            </Box>
          ))}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 4, bgcolor: RESIDUAL_COLORS.substance, borderRadius: 0.5, opacity: 0.75 }} />
            <Typography variant="caption" fontSize={9}>Substance use lane</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 12, height: 4, bgcolor: '#2E7D32', borderRadius: 0.5, opacity: 0.8 }} />
            <Typography variant="caption" fontSize={9}>Care episode block (open = left arrow)</Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 6, height: 6, border: '1px solid #D32F2F', borderRadius: '50%', bgcolor: '#fff' }} />
            <Typography variant="caption" fontSize={9}>Symptom onset/remission markers</Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          {medBars.slice(0, 5).map(m => (
            <Box key={m.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 12, height: 5, bgcolor: m.color, borderRadius: 0.5 }} />
              <Typography variant="caption" fontSize={9}>{m.name}</Typography>
            </Box>
          ))}
        </Box>
    </>
  );
}
