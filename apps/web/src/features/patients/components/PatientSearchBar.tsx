// apps/web/src/features/patients/components/PatientSearchBar.tsx
import {
  Box,
  FormControl,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  type SelectChangeEvent,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';

interface OrgUnitOption {
  id: string;
  name: string;
}

interface StaffOption {
  id: string;
  name: string;
}

interface PatientSearchBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  teamFilter: string;
  onTeamFilterChange: (value: string) => void;
  clinicianFilter: string;
  onClinicianFilterChange: (value: string) => void;
  consultantFilter: string;
  onConsultantFilterChange: (value: string) => void;
  juniorMedicalFilter: string;
  onJuniorMedicalFilterChange: (value: string) => void;
  teams: OrgUnitOption[];
  clinicians: StaffOption[];
}

export const PatientSearchBar: React.FC<PatientSearchBarProps> = ({
  search,
  onSearchChange,
  teamFilter,
  onTeamFilterChange,
  clinicianFilter,
  onClinicianFilterChange,
  consultantFilter,
  onConsultantFilterChange,
  juniorMedicalFilter,
  onJuniorMedicalFilterChange,
  teams,
  clinicians,
}) => {
  return (
    <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        size="small"
        placeholder="Search by name, UR number…"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        slotProps={{
          input: {
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
              </InputAdornment>
            ),
          },
        }}
        sx={{
          minWidth: 260,
          '& .MuiOutlinedInput-root': {
            backgroundColor: '#FFFFFF',
            fontFamily: 'Albert Sans, sans-serif',
          },
        }}
      />

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Team</InputLabel>
        <Select
          value={teamFilter}
          onChange={(e: SelectChangeEvent) => onTeamFilterChange(e.target.value)}
          label="Team"
          sx={{ backgroundColor: '#FFFFFF', fontFamily: 'Albert Sans, sans-serif' }}
        >
          <MenuItem value="">All Teams</MenuItem>
          {teams.map((t) => (
            <MenuItem key={t.id} value={t.id}>{t.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 200 }}>
        <InputLabel>Clinician</InputLabel>
        <Select
          value={clinicianFilter}
          onChange={(e: SelectChangeEvent) => onClinicianFilterChange(e.target.value)}
          label="Clinician"
          sx={{ backgroundColor: '#FFFFFF', fontFamily: 'Albert Sans, sans-serif' }}
        >
          <MenuItem value="">All Clinicians</MenuItem>
          {clinicians.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel>Consultant</InputLabel>
        <Select
          value={consultantFilter}
          onChange={(e: SelectChangeEvent) => onConsultantFilterChange(e.target.value)}
          label="Consultant"
          sx={{ backgroundColor: '#FFFFFF', fontFamily: 'Albert Sans, sans-serif' }}
        >
          <MenuItem value="">All Consultants</MenuItem>
          {clinicians.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>

      <FormControl size="small" sx={{ minWidth: 240 }}>
        <InputLabel>Junior Medical Staff</InputLabel>
        <Select
          value={juniorMedicalFilter}
          onChange={(e: SelectChangeEvent) => onJuniorMedicalFilterChange(e.target.value)}
          label="Junior Medical Staff"
          sx={{ backgroundColor: '#FFFFFF', fontFamily: 'Albert Sans, sans-serif' }}
        >
          <MenuItem value="">All Junior Medical Staff</MenuItem>
          {clinicians.map((c) => (
            <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  );
};
