import {
  Box,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TablePagination,
  Paper,
  Typography,
  Skeleton,
} from '@mui/material';

export type SortDirection = 'asc' | 'desc';

export interface ColumnDef<TRow> {
  key: string;
  header: string;
  width?: number | string;
  sortable?: boolean;
  render: (row: TRow, index: number) => React.ReactNode;
}

export interface DataTableProps<TRow> {
  columns: ColumnDef<TRow>[];
  rows: TRow[];
  rowKey: (row: TRow) => string;
  caption?: string;
  loading?: boolean;
  emptyMessage?: string;
  sortBy?: string;
  sortDir?: SortDirection;
  onSortChange?: (key: string, dir: SortDirection) => void;
  page?: number;
  rowsPerPage?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  onRowsPerPageChange?: (rowsPerPage: number) => void;
  onRowClick?: (row: TRow) => void;
}

const SKELETON_ROWS = 6;

export function DataTable<TRow>({
  columns,
  rows,
  rowKey,
  caption,
  loading = false,
  emptyMessage = 'No records found.',
  sortBy,
  sortDir = 'asc',
  onSortChange,
  page = 0,
  rowsPerPage = 25,
  totalCount,
  onPageChange,
  onRowsPerPageChange,
  onRowClick,
}: DataTableProps<TRow>): React.ReactElement {
  const handleSort = (key: string): void => {
    if (!onSortChange) return;
    const nextDir: SortDirection =
      sortBy === key && sortDir === 'asc' ? 'desc' : 'asc';
    onSortChange(key, nextDir);
  };

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <TableContainer role="region" aria-label="Data table">
        <Table size="small" aria-label="data-table">
          {caption && <caption className="sr-only">{caption}</caption>}
          <TableHead>
            <TableRow>
              {columns.map((col) => (
                <TableCell
                  component="th"
                  scope="col"
                  key={col.key}
                  width={col.width}
                  sortDirection={sortBy === col.key ? sortDir : false}
                  sx={{
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {col.sortable && onSortChange ? (
                    <TableSortLabel
                      active={sortBy === col.key}
                      direction={
                        sortBy === col.key ? sortDir : 'asc'
                      }
                      onClick={() => handleSort(col.key)}
                    >
                      {col.header}
                    </TableSortLabel>
                  ) : (
                    col.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading
              ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton variant="text" width={80} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : rows.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      align="center"
                      sx={{ py: 6 }}
                    >
                      <Typography
                        variant="body2"
                        color="text.secondary"
                      >
                        {emptyMessage}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.map((row, idx) => (
                    <TableRow
                      key={rowKey(row)}
                      hover={Boolean(onRowClick)}
                      onClick={
                        onRowClick
                          ? () => onRowClick(row)
                          : undefined
                      }
                      sx={{
                        cursor: onRowClick ? 'pointer' : 'default',
                      }}
                    >
                      {columns.map((col) => (
                        <TableCell key={col.key}>
                          {col.render(row, idx)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                )}
          </TableBody>
        </Table>
      </TableContainer>
      <Box
        sx={{
          borderTop: 1,
          borderColor: 'divider',
        }}
      >
        <TablePagination
          component="div"
          count={totalCount ?? rows.length}
          page={page}
          rowsPerPage={rowsPerPage}
          rowsPerPageOptions={[10, 25, 50, 100]}
          onPageChange={(_, p) => onPageChange?.(p)}
          onRowsPerPageChange={(e) =>
            onRowsPerPageChange?.(Number(e.target.value))
          }
        />
      </Box>
    </Paper>
  );
}
