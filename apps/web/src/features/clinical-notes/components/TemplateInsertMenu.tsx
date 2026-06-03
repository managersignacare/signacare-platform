import React, { useState } from 'react';
import {
  Button, Menu, MenuItem, ListItemText, ListItemIcon,
  Typography, CircularProgress, Divider,
} from '@mui/material';
import ArticleIcon from '@mui/icons-material/Article';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import { useTemplates } from '../../templates/hooks/useTemplates';
import type { SoapContent } from '../types/noteTypes';
import type { TemplateResponse } from '../../templates/types/templateTypes';

interface Props {
  onInsert: (partial: Partial<SoapContent>) => void;
}

const buildSoapSnippet = (tpl: TemplateResponse): Partial<SoapContent> => {
  const by = (field: string) =>
    tpl.sections
      .filter((s) => s.soapField === field)
      .map((s) => `${s.label}:\n`)
      .join('');
  return {
    subjective: by('subjective') || undefined,
    objective:  by('objective')  || undefined,
    assessment: by('assessment') || undefined,
    plan:       by('plan')       || undefined,
  };
};

export const TemplateInsertMenu: React.FC<Props> = ({ onInsert }) => {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const { data: templates, isLoading } = useTemplates({ status: 'published' });

  const handleInsert = (tpl: TemplateResponse) => {
    onInsert(buildSoapSnippet(tpl));
    setAnchor(null);
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        startIcon={<ArticleIcon />}
        endIcon={<KeyboardArrowDownIcon />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ borderColor: '#4E9C82', color: '#4E9C82', fontFamily: 'Albert Sans, sans-serif' }}
      >
        Insert Template
      </Button>

      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        PaperProps={{ sx: { minWidth: 300, maxHeight: 420 } }}
      >
        {isLoading ? (
          <MenuItem disabled>
            <CircularProgress role="progressbar" aria-label="Loading" size={16} sx={{ mr: 1 }} />
            <Typography variant="body2">Loading…</Typography>
          </MenuItem>
        ) : !templates?.length ? (
          <MenuItem disabled>
            <Typography variant="body2" color="text.secondary">No published templates</Typography>
          </MenuItem>
        ) : (
          templates.map((tpl) => (
            <MenuItem key={tpl.id} onClick={() => handleInsert(tpl)}>
              <ListItemIcon>
                <ArticleIcon fontSize="small" sx={{ color: '#4E9C82' }} />
              </ListItemIcon>
              <ListItemText
                primary={tpl.name}
                secondary={tpl.category}
                primaryTypographyProps={{ variant: 'body2', fontWeight: 600, fontFamily: 'Albert Sans, sans-serif' }}
                secondaryTypographyProps={{ variant: 'caption' }}
              />
            </MenuItem>
          ))
        )}
        <Divider />
        <MenuItem onClick={() => setAnchor(null)} dense>
          <Typography variant="caption" color="text.secondary">Close</Typography>
        </MenuItem>
      </Menu>
    </>
  );
};
