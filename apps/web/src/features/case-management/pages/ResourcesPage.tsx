import React, { useState } from 'react';
import {
  Alert, Box, Card, CardContent, Chip, CircularProgress, Grid, IconButton,
  TextField, Typography,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { apiClient } from '../../../shared/services/apiClient';
import { useQuery } from '@tanstack/react-query';
import { caseManagementKeys } from '../queryKeys';
import {
  AUSTRALIAN_MENTAL_HEALTH_RESOURCES,
  type CommunityResource,
} from '../mentalHealthResourcesAu';

function normalizeWebsite(website: string | undefined): string {
  if (!website) return '';
  return website.startsWith('http://') || website.startsWith('https://')
    ? website
    : `https://${website}`;
}

interface CommunityResourcesResponse {
  resources?: CommunityResource[];
  data?: CommunityResource[];
}

export default function ResourcesPage(): React.ReactElement {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useQuery({
    queryKey: caseManagementKeys.communityResources(),
    queryFn: () =>
      apiClient
        .get<CommunityResource[] | CommunityResourcesResponse>('community-resources')
        .catch((err) => {
          console.warn('ResourcesPage: query failed', err);
          return [];
        }),
  });

  const clinicResources: CommunityResource[] = Array.isArray(data) ? data : data?.resources ?? data?.data ?? [];
  const allResources = React.useMemo<CommunityResource[]>(() => {
    const seen = new Set<string>();
    const merged: CommunityResource[] = [];
    const addUnique = (resource: CommunityResource, sourcePrefix: string): void => {
      const key = `${sourcePrefix}:${(resource.name ?? '').trim().toLowerCase()}|${normalizeWebsite(resource.website).toLowerCase()}`;
      if (seen.has(key)) return;
      seen.add(key);
      merged.push(resource);
    };

    for (const resource of AUSTRALIAN_MENTAL_HEALTH_RESOURCES) addUnique(resource, 'au');
    for (const resource of clinicResources) addUnique(resource, 'clinic');
    return merged;
  }, [clinicResources]);

  const filtered = allResources.filter((r) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (r.name ?? '').toLowerCase().includes(s) ||
      (r.category ?? '').toLowerCase().includes(s) ||
      (r.description ?? '').toLowerCase().includes(s) ||
      (r.phone ?? '').toLowerCase().includes(s) ||
      (r.website ?? '').toLowerCase().includes(s) ||
      (r.email ?? '').toLowerCase().includes(s) ||
      (r.address ?? '').toLowerCase().includes(s);
  });

  return (
    <Box sx={{ px: { xs: 2, sm: 3, md: 4 }, py: 3, bgcolor: '#FBF8F5', minHeight: '100vh' }}>
      <Typography variant="h5" fontWeight={700} fontFamily="Albert Sans, sans-serif" sx={{ color: '#3D484B', mb: 0.5 }}>
        Community Resources
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Australian mental health supports, crisis lines, and clinic-linked community services
      </Typography>

      <TextField size="small" placeholder="Search resources..." value={search} onChange={(e) => setSearch(e.target.value)}
        InputProps={{ startAdornment: <SearchIcon sx={{ color: '#999', mr: 1 }} /> }}
        sx={{ mb: 3, width: 400, maxWidth: '100%' }} />

      {error && <Alert role="alert" severity="error" sx={{ mb: 2 }}>Failed to load resources</Alert>}
      {isLoading && <CircularProgress role="progressbar" aria-label="Loading" sx={{ display: 'block', mx: 'auto', mt: 4 }} />}
      {filtered.length === 0 && !isLoading && !error && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No resources found</Typography>
      )}
      <Grid container spacing={2}>
        {filtered.map((r, i) => (
          <Grid size={{ xs: 12, sm: 6, md: 4 }} key={r.id ?? i}>
            <Card variant="outlined" sx={{ height: '100%' }}>
              <CardContent sx={{ pb: '12px !important' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <Typography variant="body1" fontWeight={700} color="#3D484B" fontFamily="Albert Sans, sans-serif">
                    {r.name ?? 'Resource'}
                  </Typography>
                  {r.website && (
                    <IconButton
                      size="small"
                      href={normalizeWebsite(r.website)}
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ color: '#327C8D' }}
                    >
                      <OpenInNewIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  )}
                </Box>
                {r.category && <Chip label={r.category} size="small" sx={{ bgcolor: '#E8F5F7', color: '#327C8D', fontSize: 10, mt: 0.5, mb: 1 }} />}
                {r.description && <Typography variant="body2" color="text.secondary" sx={{ mb: 1, fontSize: 12 }}>{r.description}</Typography>}
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                  {r.phone && <Chip label={r.phone} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                  {r.email && <Chip label={r.email} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                  {r.address && <Chip label={r.address} size="small" variant="outlined" sx={{ fontSize: 10, height: 20 }} />}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
