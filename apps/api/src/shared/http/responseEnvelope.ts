type EnvelopeMeta = Record<string, unknown>;

export type ListEnvelope<T> = {
  data: T[];
  pagination?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  meta?: EnvelopeMeta;
};

export type DetailEnvelope<T> = {
  data: T;
  meta?: EnvelopeMeta;
};

export type ActionEnvelope<T = unknown> = {
  ok: true;
  data?: T;
  message?: string;
  meta?: EnvelopeMeta;
};

export function buildListEnvelope<T>(input: ListEnvelope<T>): ListEnvelope<T> {
  return input;
}

export function buildDetailEnvelope<T>(input: DetailEnvelope<T>): DetailEnvelope<T> {
  return input;
}

export function buildActionEnvelope<T = unknown>(input: ActionEnvelope<T>): ActionEnvelope<T> {
  return input;
}
