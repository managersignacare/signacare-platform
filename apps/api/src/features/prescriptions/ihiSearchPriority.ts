import {
  searchIhi,
  type IhiResult,
  type IhiSearchParams,
} from '../../integrations/hiService/hiServiceClient';

export type IhiSearchPath = 'medicare' | 'dva' | 'contact';

type Candidate = {
  path: IhiSearchPath;
  params: IhiSearchParams;
};

type SearchFn = (params: IhiSearchParams) => Promise<IhiResult>;

export type PrioritizedIhiSearchOutcome = {
  result: IhiResult;
  attempts: Array<{ path: IhiSearchPath; result: IhiResult }>;
  winningPath: IhiSearchPath | null;
  conflict: {
    winnerPath: IhiSearchPath;
    conflictingPath: IhiSearchPath;
    winnerIhi: string;
    conflictingIhi: string;
  } | null;
};

export function buildIhiSearchCandidates(params: IhiSearchParams): Candidate[] {
  const base = {
    familyName: params.familyName,
    givenName: params.givenName,
    dateOfBirth: params.dateOfBirth,
    gender: params.gender,
  } as const;

  const candidates: Candidate[] = [];
  if (params.medicareNumber && params.medicareIrn) {
    candidates.push({
      path: 'medicare',
      params: {
        ...base,
        medicareNumber: params.medicareNumber,
        medicareIrn: params.medicareIrn,
      },
    });
  }

  if (params.dvaNumber) {
    candidates.push({
      path: 'dva',
      params: {
        ...base,
        dvaNumber: params.dvaNumber,
      },
    });
  }

  if (params.mobile || params.email) {
    candidates.push({
      path: 'contact',
      params: {
        ...base,
        mobile: params.mobile,
        email: params.email,
      },
    });
  }

  return candidates;
}

export async function searchIhiWithPriority(
  params: IhiSearchParams,
  searchFn: SearchFn = searchIhi,
): Promise<PrioritizedIhiSearchOutcome> {
  const candidates = buildIhiSearchCandidates(params);
  if (candidates.length === 0) {
    return {
      result: {
        found: false,
        error: 'Provide one identity path: Medicare+IRN, DVA number, mobile, or email.',
      },
      attempts: [],
      winningPath: null,
      conflict: null,
    };
  }

  const attempts: Array<{ path: IhiSearchPath; result: IhiResult }> = [];
  for (const candidate of candidates) {
    const result = await searchFn(candidate.params);
    attempts.push({ path: candidate.path, result });
  }

  const successes = attempts.filter((attempt) => attempt.result.found && !!attempt.result.ihi);
  if (successes.length === 0) {
    return {
      result: attempts[0]?.result ?? { found: false, error: 'IHI not found' },
      attempts,
      winningPath: null,
      conflict: null,
    };
  }

  const winner = successes[0]!;
  const conflicting = successes.find(
    (attempt) => attempt.result.ihi && attempt.result.ihi !== winner.result.ihi,
  );
  if (conflicting?.result.ihi && winner.result.ihi) {
    return {
      result: {
        found: false,
        error: `HI identity conflict across search paths (${winner.path}:${winner.result.ihi} vs ${conflicting.path}:${conflicting.result.ihi})`,
      },
      attempts,
      winningPath: null,
      conflict: {
        winnerPath: winner.path,
        conflictingPath: conflicting.path,
        winnerIhi: winner.result.ihi,
        conflictingIhi: conflicting.result.ihi,
      },
    };
  }

  return {
    result: winner.result,
    attempts,
    winningPath: winner.path,
    conflict: null,
  };
}
