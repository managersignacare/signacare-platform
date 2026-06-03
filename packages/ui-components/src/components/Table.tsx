import React, {
  useState,
  useMemo,
} from 'react';
import {
  Table as MuiTable,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TablePagination,
  TableSortLabel,
  Checkbox,
  Paper,
  Box,
  Typography,
  Skeleton,
} from '@mui/material';
import TableRowsIcon from '@mui/icons-material/TableRows';

export interface SignacareTableColumn<T> {
  key: keyof T | string;
  header: string;
  sortable?: boolean;
  width?: string | number;
  align?: 'left' | 'center' | 'right';
  render?: (value: T[keyof T], row: T) => React.ReactNode;
}

export interface SignacareTableProps<T extends { id: string }> {
  columns: SignacareTableColumn<T>[];
  rows: T[];
  loading?: boolean;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  rowsPerPageOptions?: number[];
  defaultRowsPerPage?: number;
  stickyHeader?: boolean;
  maxHeight?: string | number;
}

type SortDir = 'asc' | 'desc';

export function SignacareTable<T extends { id: string }>({
  columns,
  rows,
  loading = false,
  selectable = false,
  selectedIds,
  onSelectionChange,
  onRowClick,
  emptyMessage = 'No records found.',
  rowsPerPageOptions = [10, 25, 50],
  defaultRowsPerPage = 10,
  stickyHeader = false,
  maxHeight,
}: SignacareTableProps<T>): React.ReactElement {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] =
    useState(defaultRowsPerPage);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] =
    useState<SortDir>('asc');

  const allSelected =
    selectable &&
    rows.length > 0 &&
    selectedIds &&
    selectedIds.length === rows.length;

  const handleToggleAll = (): void => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange([]);
    } else {
      onSelectionChange(rows.map((r) => r.id));
    }
  };

  const handleToggleRow = (id: string): void => {
    if (!onSelectionChange) return;
    const set = new Set(selectedIds ?? []);
    if (set.has(id)) {
      set.delete(id);
    } else {
      set.add(id);
    }
    onSelectionChange(Array.from(set));
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const colKey = sortKey as keyof T;
    return [...rows].sort((a, b) => {
      const av = a[colKey];
      const bv = b[colKey];
      if (av === bv) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < (bv as unknown as string)) {
        return sortDir === 'asc' ? -1 : 1;
      }
      if (av > (bv as unknown as string)) {
        return sortDir === 'asc' ? 1 : -1;
      }
      return 0;
    });
  }, [rows, sortKey, sortDir]);

  const pageRows = useMemo(
    () =>
      sortedRows.slice(
        page * rowsPerPage,
        page * rowsPerPage + rowsPerPage,
      ),
    [sortedRows, page, rowsPerPage],
  );

  const handleSort = (key: string): void => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleChangePage = (
    _: unknown,
    newPage: number,
  ): void => {
    setPage(newPage);
  };

  const handleChangeRowsPerPage = (
    e: React.ChangeEvent<HTMLInputElement>,
  ): void => {
    setRowsPerPage(Number(e.target.value));
    setPage(0);
  };

  const showEmpty =
    !loading && rows.length === 0;

  return (
    <Paper
      variant="outlined"
      sx={{ borderRadius: 2, overflow: 'hidden' }}
    >
      <TableContainer
        sx={{
          maxHeight: maxHeight ?? 'none',
        }}
      >
        <MuiTable
          size="small"
          stickyHeader={stickyHeader}
        >
          <TableHead>
            <TableRow>
              {selectable && (
                <TableCell padding="checkbox">
                  <Checkbox
                    indeterminate={
                      selectedIds &&
                      selectedIds.length > 0 &&
                      !allSelected
                    }
                    checked={allSelected}
                    onChange={handleToggleAll}
                  />
                </TableCell>
              )}
              {columns.map((col) => (
                <TableCell
                  key={col.key as string}
                  width={col.width}
                  align={col.align ?? 'left'}
                  sortDirection={
                    sortKey === col.key ? sortDir : false
                  }
                >
                  {col.sortable ? (
                    <TableSortLabel
                      active={sortKey === col.key}
                      direction={
                        sortKey === col.key ? sortDir : 'asc'
                      }
                      onClick={() =>
                        handleSort(col.key as string)
                      }
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
              ? Array.from({ length: rowsPerPage }).map(
                  (_, idx) => (
                    <TableRow key={idx}>
                      {selectable && (
                        <TableCell padding="checkbox">
                          <Skeleton
                            variant="rectangular"
                            width={24}
                            height={24}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => (
                        <TableCell key={col.key as string}>
                          <Skeleton variant="text" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ),
                )
              : showEmpty ? (
                  <TableRow>
                    <TableCell
                      colSpan={
                        columns.length + (selectable ? 1 : 0)
                      }
                    >
                      <Box
                        sx={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          py: 4,
                          gap: 1,
                        }}
                      >
                        <TableRowsIcon
                          sx={{
                            fontSize: 32,
                            color: 'text.disabled',
                          }}
                        />
                        <Typography
                          variant="body2"
                          color="text.secondary"
                        >
                          {emptyMessage}
                        </Typography>
                      </Box>
                    </TableCell>
                  </TableRow>
                ) : (
                  pageRows.map((row) => (
                    <TableRow
                      key={row.id}
                      hover={Boolean(onRowClick)}
                      onClick={
                        onRowClick
                          ? () => onRowClick(row)
                          : undefined
                      }
                      sx={{
                        cursor: onRowClick
                          ? 'pointer'
                          : 'default',
                      }}
                    >
                      {selectable && (
                        <TableCell padding="checkbox">
                          <Checkbox
                            checked={
                              selectedIds?.includes(row.id) ??
                              false
                            }
                            onChange={(e) => {
                              e.stopPropagation();
                              handleToggleRow(row.id);
                            }}
                          />
                        </TableCell>
                      )}
                      {columns.map((col) => {
                        const value =
                          (row as unknown as Record<
                            string,
                            unknown
                          >)[col.key as string];
                        return (
                          <TableCell
                            key={col.key as string}
                            align={col.align ?? 'left'}
                          >
                            {col.render
                              ? col.render(
                                  value as T[keyof T],
                                  row,
                                )
                              : (value as React.ReactNode)}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))
                )}
          </TableBody>
        </MuiTable>
      </TableContainer>
      <TablePagination
        component="div"
        count={rows.length}
        page={page}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={rowsPerPageOptions}
        onPageChange={handleChangePage}
        onRowsPerPageChange={handleChangeRowsPerPage}
      />
    </Paper>
  );
}
