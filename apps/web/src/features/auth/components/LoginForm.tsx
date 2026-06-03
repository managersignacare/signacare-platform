// apps/web/src/features/auth/components/LoginForm.tsx
import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  TextField,
  Button,
  IconButton,
  InputAdornment,
  Alert,
  Typography,
  CircularProgress,
  keyframes,
} from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema } from '@signacare/shared';
import type { LoginDTO } from '@signacare/shared';
import { useLogin } from '../hooks/useLogin';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '../../../shared/services/apiClient';
import { authKeys } from '../queryKeys';

// Logo entrance animation — multi-stage with rotation and glow
const logoEntrance = keyframes`
  0% { opacity: 0; transform: scale(0.3) rotate(-180deg) translateY(20px); filter: blur(8px); }
  40% { opacity: 0.8; transform: scale(1.1) rotate(10deg) translateY(-4px); filter: blur(0); }
  60% { opacity: 1; transform: scale(0.95) rotate(-3deg) translateY(2px); }
  80% { transform: scale(1.02) rotate(0deg) translateY(-1px); }
  100% { opacity: 1; transform: scale(1) rotate(0deg) translateY(0); }
`;

const logoGlow = keyframes`
  0%, 100% { filter: drop-shadow(0 0 0px transparent); }
  50% { filter: drop-shadow(0 0 18px rgba(50,124,141,0.4)) drop-shadow(0 0 40px rgba(184,98,26,0.15)); }
`;

const logoPulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.03); }
`;

const cardSlideUp = keyframes`
  0% { opacity: 0; transform: translateY(30px); }
  100% { opacity: 1; transform: translateY(0); }
`;

const textFadeIn = keyframes`
  0% { opacity: 0; transform: translateY(8px); }
  100% { opacity: 1; transform: translateY(0); }
`;

interface PublicBranding {
  logoUrl?: string;
  sidebarTitle?: string;
}

interface BrandingResponse extends PublicBranding {
  branding?: PublicBranding;
}

function extractBranding(response: BrandingResponse | null): PublicBranding | null {
  if (!response) return null;
  return response.branding ?? response;
}

export function LoginForm() {
  // Fetch branding for login page (logo override)
  const { data: brandingData } = useQuery({
    queryKey: authKeys.branding(),
    queryFn: async () => {
      try {
        const response = await apiClient.get<BrandingResponse>('power-settings/branding/public');
        return extractBranding(response);
      } catch { return null; }
    },
    staleTime: 5 * 60 * 1000,
  });
  const logoSrc = brandingData?.logoUrl ?? '/signacare-logo.svg';
  const orgName = brandingData?.sidebarTitle ?? 'Signacare';
  const [showPassword, setShowPassword] = useState(false);
  const { mutate: login, isPending, error } = useLogin();

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginDTO>({ resolver: zodResolver(LoginSchema) });

  const errorMessage =
    error != null
      ? ((error as { message?: string }).message ?? 'Sign-in failed. Please try again.')
      : null;

  return (
    <Box
      component="main"
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FBF8F5',
        px: 2,
      }}
    >
      <Card
        elevation={0}
        sx={{
          width: '100%',
          maxWidth: 420,
          borderRadius: 3,
          boxShadow: '0 4px 24px rgba(61,72,75,0.12)',
          backgroundColor: '#FFFFFF',
          animation: `${cardSlideUp} 0.6s ease-out`,
        }}
      >
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 1 }}>
            <Box
              component="img"
              src={logoSrc}
              alt={orgName}
              sx={{
                width: 72, height: 72, mb: 1,
                animation: `${logoEntrance} 1s cubic-bezier(0.34, 1.56, 0.64, 1), ${logoGlow} 3s ease-in-out 1.2s infinite, ${logoPulse} 4s ease-in-out 2s infinite`,
              }}
            />
          </Box>
          <Typography
            component="div"
            sx={{
              fontFamily: '"Albert Sans", sans-serif',
              fontWeight: 700,
              fontSize: '2rem',
              color: '#1D2D44',
              textAlign: 'center',
              mb: 0.5,
              letterSpacing: '-0.5px',
              animation: `${textFadeIn} 0.5s ease-out 0.4s both`,
            }}
          >
            {orgName}
          </Typography>
          <Typography
            variant="body2"
            sx={{
              textAlign: 'center',
              color: '#3D484B',
              mb: 3,
              fontFamily: '"Albert Sans", sans-serif',
              animation: `${textFadeIn} 0.5s ease-out 0.6s both`,
            }}
          >
            Mental Health EMR
          </Typography>

          {errorMessage != null && (
            <Alert role="alert"
              severity="error"
              sx={{
                mb: 2,
                backgroundColor: '#FFF0E6',
                color: '#3D484B',
                border: '1px solid #F0852C',
                '& .MuiAlert-icon': { color: '#F0852C' },
              }}
            >
              {errorMessage}
            </Alert>
          )}

          <Box component="form" onSubmit={handleSubmit((dto) => login(dto))} noValidate>
            <TextField
              {...register('email')}
              label="Email address"
              type="email"
              fullWidth
              autoComplete="email"
              autoFocus
              error={!!errors.email}
              helperText={errors.email?.message}
              sx={{ mb: 2 }}
            />
            <TextField
              {...register('password')}
              label="Password"
              type={showPassword ? 'text' : 'password'}
              fullWidth
              autoComplete="current-password"
              error={!!errors.password}
              helperText={errors.password?.message}
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <IconButton
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      onClick={() => setShowPassword((p) => !p)}
                      edge="end"
                    >
                      {showPassword ? <VisibilityOff /> : <Visibility />}
                    </IconButton>
                  </InputAdornment>
                ),
              }}
              sx={{ mb: 1 }}
            />

            <Box sx={{ textAlign: 'right', mb: 3 }}>
              <Typography
                component="a"
                href="/forgot-password"
                variant="body2"
                sx={{
                  color: '#327C8D',
                  textDecoration: 'none',
                  fontFamily: '"Albert Sans", sans-serif',
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                Forgot password?
              </Typography>
            </Box>

            <Button
              type="submit"
              fullWidth
              variant="contained"
              disabled={isPending}
              sx={{
                backgroundColor: '#327C8D',
                color: '#FFFFFF',
                fontFamily: '"Albert Sans", sans-serif',
                fontWeight: 600,
                py: 1.5,
                borderRadius: 2,
                textTransform: 'none',
                fontSize: '1rem',
                '&:hover': { backgroundColor: '#2a6878' },
                '&.Mui-disabled': { backgroundColor: '#b0bec5' },
              }}
            >
              {isPending ? <CircularProgress role="progressbar" aria-label="Loading" size={22} color="inherit" /> : 'Sign in'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
