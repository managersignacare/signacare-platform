// Components
export { SignacareButton } from './components/Button';
export type { SignacareButtonProps } from './components/Button';

export { SignacareInput } from './components/Input';
export type { SignacareInputProps } from './components/Input';

export { SignacareSelect } from './components/Select';
export type {
  SignacareSelectProps,
  SignacareSelectOption,
  SignacareSelectGroup,
} from './components/Select';

export { SignacareModal } from './components/Modal';
export type { SignacareModalProps } from './components/Modal';

export { SignacareBadge } from './components/Badge';
export type { SignacareBadgeProps } from './components/Badge';

export { SignacareTable } from './components/Table';
export type {
  SignacareTableProps,
  SignacareTableColumn,
} from './components/Table';

export { SignacareTabs } from './components/Tabs';
export type {
  SignacareTabsProps,
  SignacareTabItem,
} from './components/Tabs';

export { SignacareCard } from './components/Card';
export type { SignacareCardProps } from './components/Card';

export { SignacareDatePicker } from './components/DatePicker';
export type {
  SignacareDatePickerProps,
} from './components/DatePicker';

export { SignacareStatusBadge } from './components/StatusBadge';
export type {
  SignacareStatusBadgeProps,
  ClinicalStatus,
} from './components/StatusBadge';

// Design tokens
export const SIGNACARE_COLORS = {
  primary: '#327C8D',
  secondary: '#4E9C82',
  dark: '#3D484B',
  background: '#FBF8F5',
  accent: '#F0852C',
  white: '#FFFFFF',
  error: '#D32F2F',
} as const;
