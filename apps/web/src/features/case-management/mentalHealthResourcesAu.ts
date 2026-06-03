export interface CommunityResource {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  website?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export const AUSTRALIAN_MENTAL_HEALTH_RESOURCES: CommunityResource[] = [
  {
    id: 'au-lifeline',
    name: 'Lifeline Australia',
    category: 'Crisis Support',
    description: '24/7 crisis support and suicide prevention.',
    website: 'https://www.lifeline.org.au/',
    phone: '13 11 14',
  },
  {
    id: 'au-beyond-blue',
    name: 'Beyond Blue',
    category: 'Depression & Anxiety',
    description: 'National support for depression, anxiety and wellbeing.',
    website: 'https://www.beyondblue.org.au/',
    phone: '1300 22 4636',
  },
  {
    id: 'au-suicide-callback-service',
    name: 'Suicide Call Back Service',
    category: 'Crisis Support',
    description: '24/7 telephone and online counselling for suicide-related distress.',
    website: 'https://www.suicidecallbackservice.org.au/',
    phone: '1300 659 467',
  },
  {
    id: 'au-13yarn',
    name: '13YARN',
    category: 'First Nations Support',
    description: '24/7 crisis support for Aboriginal and Torres Strait Islander peoples.',
    website: 'https://www.13yarn.org.au/',
    phone: '13 92 76',
  },
  {
    id: 'au-headspace',
    name: 'headspace',
    category: 'Youth Mental Health',
    description: 'Mental health support services for young people and families.',
    website: 'https://headspace.org.au/',
    phone: '1800 650 890',
  },
  {
    id: 'au-kids-helpline',
    name: 'Kids Helpline',
    category: 'Child & Youth',
    description: '24/7 counselling service for children and young people.',
    website: 'https://kidshelpline.com.au/',
    phone: '1800 55 1800',
  },
  {
    id: 'au-sane',
    name: 'SANE Australia',
    category: 'Complex Mental Health',
    description: 'Support for people with complex mental health needs and carers.',
    website: 'https://www.sane.org/',
    phone: '1800 187 263',
  },
  {
    id: 'au-medicare-mental-health',
    name: 'Medicare Mental Health',
    category: 'Service Navigation',
    description: 'Find local mental health services and supports in Australia.',
    website: 'https://www.medicarementalhealth.gov.au/',
  },
  {
    id: 'au-open-arms',
    name: 'Open Arms — Veterans & Families Counselling',
    category: 'Veteran Support',
    description: '24/7 counselling and support for Australian veterans and families.',
    website: 'https://www.openarms.gov.au/',
    phone: '1800 011 046',
  },
  {
    id: 'au-butterfly',
    name: 'Butterfly National Helpline',
    category: 'Eating Disorders',
    description: 'Support and referral for eating disorders and body image concerns.',
    website: 'https://butterfly.org.au/',
    phone: '1800 33 4673',
  },
];
