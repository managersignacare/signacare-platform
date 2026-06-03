import React from 'react';
import {
  Card,
  CardHeader,
  CardContent,
  CardActions,
  type CardProps as MuiCardProps,
} from '@mui/material';

export interface SignacareCardProps
  extends Omit<MuiCardProps, 'title'> {
  title?: React.ReactNode;
  subheader?: React.ReactNode;
  actions?: React.ReactNode;
}

export function SignacareCard({
  title,
  subheader,
  actions,
  children,
  ...rest
}: SignacareCardProps): React.ReactElement {
  return (
    <Card
      elevation={0}
      sx={{
        bgcolor: '#FFFFFF',
        boxShadow: '0 1px 4px rgba(61,72,75,0.12)',
        borderRadius: 2,
      }}
      {...rest}
    >
      {(title || subheader) && (
        <CardHeader title={title} subheader={subheader} />
      )}
      <CardContent>{children}</CardContent>
      {actions && <CardActions>{actions}</CardActions>}
    </Card>
  );
}
