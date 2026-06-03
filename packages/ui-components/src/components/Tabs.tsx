import React, { useState } from 'react';
import {
  Tabs as MuiTabs,
  Tab,
  Box,
} from '@mui/material';

export interface SignacareTabItem {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface SignacareTabsProps {
  items: SignacareTabItem[];
  value?: string;
  onChange?: (id: string) => void;
  orientation?: 'horizontal' | 'vertical';
  children?: React.ReactNode;
}

export function SignacareTabs({
  items,
  value,
  onChange,
  orientation = 'horizontal',
  children,
}: SignacareTabsProps): React.ReactElement {
  const [internal, setInternal] = useState(
    value ?? items[0]?.id ?? '',
  );
  const current = value ?? internal;

  const handleChange = (
    _: React.SyntheticEvent,
    newValue: string,
  ): void => {
    setInternal(newValue);
    onChange?.(newValue);
  };

  return (
    <Box
      sx={{
        display: orientation === 'vertical' ? 'flex' : 'block',
      }}
    >
      <MuiTabs
        value={current}
        onChange={handleChange}
        orientation={
          orientation === 'vertical'
            ? 'vertical'
            : 'horizontal'
        }
        variant="scrollable"
        sx={{
          borderRight:
            orientation === 'vertical'
              ? 1
              : 0,
          borderColor:
            orientation === 'vertical'
              ? 'divider'
              : 'transparent',
          minWidth:
            orientation === 'vertical' ? 180 : undefined,
        }}
      >
        {items.map((item) => (
          <Tab
            key={item.id}
            value={item.id}
            label={item.label}
            disabled={item.disabled}
            sx={{
              textTransform: 'none',
              fontFamily: 'Albert Sans, sans-serif',
              fontWeight: 500,
            }}
          />
        ))}
      </MuiTabs>
      {children && (
        <Box
          sx={{
            flex: 1,
            ml: orientation === 'vertical' ? 3 : 0,
            mt: orientation === 'horizontal' ? 2 : 0,
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
}
