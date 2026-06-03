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
  label: string;
  items: number;
  maxPerItem: number;
}

export const MEASURE_TYPES: OutcomeMeasureTypeDef[] = [
  { id: 'honos', label: 'HoNOS (Adult)', items: 12, maxPerItem: 4 },
  { id: 'honos65', label: 'HoNOS 65+ (Older Persons)', items: 12, maxPerItem: 4 },
  { id: 'honosca', label: 'HoNOSCA (Child & Adolescent)', items: 13, maxPerItem: 4 },
  { id: 'k10', label: 'K10 (Psychological Distress)', items: 10, maxPerItem: 5 },
  { id: 'k10plus', label: 'K10+ (Extended)', items: 14, maxPerItem: 5 },
  { id: 'lsp16', label: 'LSP-16 (Life Skills Profile)', items: 16, maxPerItem: 4 },
];

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

export function buildDefaultOutcomeItems(itemCount: number): Record<string, number> {
  const items: Record<string, number> = {};
  for (let i = 1; i <= itemCount; i += 1) items[String(i)] = 0;
  return items;
}
