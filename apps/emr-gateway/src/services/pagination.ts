interface PaginateOptions<TFilter extends object = Record<string, unknown>> {
  page?: number;
  limit?: number;
  sort?: Record<string, 1 | -1>;
  filter: TFilter;
}

interface PaginatedResult<TData> {
  data: TData[];
  meta: {
    totalRecords: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPrevPage: boolean;
  };
}

interface LeanQueryModel<TData, TFilter extends object = Record<string, unknown>> {
  find(filter: TFilter): {
    sort(sort: Record<string, 1 | -1>): {
      skip(value: number): {
        limit(value: number): {
          lean(): Promise<TData[]>;
        };
      };
    };
  };
  countDocuments(filter: TFilter): Promise<number>;
}

export async function paginate<TData, TFilter extends object = Record<string, unknown>>(
  model: LeanQueryModel<TData, TFilter>,
  opts: PaginateOptions<TFilter>,
): Promise<PaginatedResult<TData>> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const sort = opts.sort ?? { createdAt: -1 };
  const skip = (page - 1) * limit;

  const [data, totalRecords] = await Promise.all([
    model.find(opts.filter).sort(sort).skip(skip).limit(limit).lean(),
    model.countDocuments(opts.filter),
  ]);

  const totalPages = Math.ceil(totalRecords / limit);

  return {
    data,
    meta: { totalRecords, page, limit, totalPages, hasNextPage: page < totalPages, hasPrevPage: page > 1 },
  };
}

type DateBound = { $gte?: Date; $lte?: Date };

export function dateFilter(
  startDate?: string,
  endDate?: string,
  field: string = 'recordedAt',
): Record<string, DateBound> {
  const filter: Record<string, DateBound> = {};
  if (startDate || endDate) {
    filter[field] = {};
    if (startDate) filter[field].$gte = new Date(startDate);
    if (endDate) filter[field].$lte = new Date(endDate);
  }
  return filter;
}
