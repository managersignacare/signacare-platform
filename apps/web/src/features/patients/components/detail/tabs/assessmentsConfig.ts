export interface OutcomeMeasure {
  id: string;
  measureType: string;
  collectionOccasion: string;
  measureDate: string;
  totalScore: number;
  subscaleScores: Record<string, number>;
  items: Record<string, number>;
  isSigned: boolean;
  notes: string;
  createdAt: string;
}

export interface OutcomeMeasureTypeDef {
  id: string;
  items: number;
  minPerItem: number;
  maxPerItem: number;
}

// UI mechanics only. The canonical list of outcome measures and display
// names lives in packages/shared/src/assessmentTaxonomy.ts.
export const OUTCOME_MEASURE_FORM_CONFIG: Record<string, OutcomeMeasureTypeDef> = {
  honos: { id: 'honos', items: 12, minPerItem: 0, maxPerItem: 4 },
  honos65: { id: 'honos65', items: 12, minPerItem: 0, maxPerItem: 4 },
  honosca: { id: 'honosca', items: 13, minPerItem: 0, maxPerItem: 4 },
  k10: { id: 'k10', items: 10, minPerItem: 1, maxPerItem: 5 },
  k10plus: { id: 'k10plus', items: 14, minPerItem: 1, maxPerItem: 5 },
  lsp16: { id: 'lsp16', items: 16, minPerItem: 0, maxPerItem: 4 },
};

export const OCCASIONS = ['admission', 'review', '91day', 'discharge', 'other'] as const;

export const ITEM_LABELS: Record<string, string[]> = {
  honos: ['Overactive, aggressive, disruptive or agitated behaviour','Non-accidental self-injury','Problem drinking or drug-taking','Cognitive problems','Physical illness or disability problems','Problems associated with hallucinations and delusions','Problems with depressed mood','Other mental and behavioural problems','Problems with relationships','Problems with activities of daily living','Problems with living conditions','Problems with occupation and activities'],
  honos65: ['Overactive, aggressive, disruptive or agitated behaviour','Non-accidental self-injury','Problem drinking or drug-taking','Cognitive problems','Physical illness or disability problems','Problems associated with hallucinations and delusions','Problems with depressed mood','Other mental and behavioural problems','Problems with relationships','Problems with activities of daily living','Problems with living conditions','Problems with occupation and activities'],
  honosca: ['Disruptive, antisocial or aggressive behaviour','Overactivity, attention and concentration','Non-accidental self-injury','Problem alcohol or drug use','Scholastic or language difficulties','Physical illness or disability','Hallucinations and delusions','Non-organic somatic symptoms','Emotional and related symptoms','Peer relationships','Self-care and independence','Family life and relationships','Poor school attendance'],
  k10: ['Feeling tired out for no good reason','Feeling nervous','Feeling so nervous that nothing could calm you down','Feeling hopeless','Feeling restless or fidgety','Feeling so restless you could not sit still','Feeling depressed','Feeling that everything was an effort','Feeling so sad that nothing could cheer you up','Feeling worthless'],
  k10plus: ['Feeling tired out for no good reason','Feeling nervous','Feeling so nervous that nothing could calm you down','Feeling hopeless','Feeling restless or fidgety','Feeling so restless you could not sit still','Feeling depressed','Feeling that everything was an effort','Feeling so sad that nothing could cheer you up','Feeling worthless','How often did you visit a doctor or hospital for mental health?','How often did alcohol or drugs affect your daily activities?','How many days were you unable to engage in regular activities?','How much did emotional problems affect your work or social activities?'],
  lsp16: ['Gets lost in familiar places','Forgets to take medication or takes incorrect dose','Keeps accommodation reasonably clean and neat','Prepares adequate meals for themselves','Personal appearance is clean and neat','Able to shop for their own needs','Avoids social contact','Behaves appropriately in social situations','Gets along well with immediate family or close friends','Able to solve everyday practical problems','Gets along well with people generally','Takes good care of physical health','Takes responsibility for own behaviour','Emotional behaviour causes difficulties for others','Uses recreational or leisure facilities','Life is reasonably settled and stable'],
};

export const MAX_TOTAL: Record<string, number> = {
  honos: 48,
  honos65: 48,
  honosca: 52,
  k10: 50,
  k10plus: 70,
  lsp16: 48,
};

export function getK10Severity(score: number): { label: string; color: string } {
  if (score <= 19) return { label: 'Likely to be well', color: '#2E7D32' };
  if (score <= 24) return { label: 'Mild disorder', color: '#b8621a' };
  if (score <= 29) return { label: 'Moderate disorder', color: '#E65100' };
  return { label: 'Severe disorder', color: '#C62828' };
}

export function buildDefaultOutcomeItems(itemCount: number, defaultScore = 0): Record<string, number> {
  const items: Record<string, number> = {};
  for (let i = 1; i <= itemCount; i += 1) items[String(i)] = defaultScore;
  return items;
}
