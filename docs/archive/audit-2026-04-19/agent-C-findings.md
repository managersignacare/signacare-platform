# Agent C — React Query hooks audit (COMPLETED)

## HIGH findings

**[HIGH-C1]** apps/web/src/features/patients/components/detail/tabs/MedicationsTab.tsx — clozapine `createRegMut` and `adminMut` mutations may lack `onSuccess` invalidation. Clinician saves registration/administration but list doesn't refresh. NEEDS VERIFICATION.

## MEDIUM findings

**[MED-C1]** 19 literal query-key spreads (factory + literal suffix) bypass the queryKeys.ts factory pattern. CLAUDE.md §11 violation. Files:
- PatientList.tsx:77,110,118,128,137
- ReferralsTab.tsx:64
- PathwaysTab.tsx:282
- SummaryTab.tsx:1021,1026,1031,1045,1570,1575,1585
- NinetyOneDayReviewTab.tsx:73
- useProviderSearch.ts:34
- useCalendarBlocks.ts:35,52,63

## BENIGN (no action needed)

- 0 `_patientId` alias bugs (not present in Signacare)
- setQueryData usages (useNotifications, useReferralDecision, useUpdateEpisode/useCloseEpisode) all paired with invalidateQueries — correct optimistic-update pattern

## Gold-standard fix priorities
1. HIGH: verify MedicationsTab clozapine mutations have onSuccess invalidation; add if missing.
2. MEDIUM: extend queryKeys.ts factories to include the 19 literal-suffix variants; refactor spreads to factory calls.
3. Structural: wire a pre-commit grep that rejects `queryKey: \[` outside queryKeys.ts (catches drift).
