// seed-mbs.ts — Seeds default psychiatry MBS items for a clinic.
// Schedule fees are approximate and should be verified against MBS Online.
// Call seedMbsItems(clinicId) to populate fee_schedules for a new clinic.

import { db } from './db/db';

interface MbsItem {
  item_number: string;
  description: string;
  schedule_fee_cents: number;
  category: string;
  modality: string | null;
  min_duration_mins: number | null;
  max_duration_mins: number | null;
  is_initial: boolean;
  sort_order: number;
}

const DEFAULT_MBS_ITEMS: MbsItem[] = [
  // In-rooms psychiatrist consultations
  { item_number: '296', description: 'Psychiatrist — initial consultation, 45+ mins', schedule_fee_cents: 34000, category: 'psychiatry_initial', modality: 'in_rooms', min_duration_mins: 45, max_duration_mins: null, is_initial: true, sort_order: 10 },
  { item_number: '300', description: 'Psychiatrist — subsequent attendance, up to 15 mins', schedule_fee_cents: 9500, category: 'psychiatry_subsequent', modality: 'in_rooms', min_duration_mins: 0, max_duration_mins: 15, is_initial: false, sort_order: 20 },
  { item_number: '302', description: 'Psychiatrist — subsequent attendance, 15–30 mins', schedule_fee_cents: 15500, category: 'psychiatry_subsequent', modality: 'in_rooms', min_duration_mins: 15, max_duration_mins: 30, is_initial: false, sort_order: 30 },
  { item_number: '304', description: 'Psychiatrist — subsequent attendance, 30–45 mins', schedule_fee_cents: 23000, category: 'psychiatry_subsequent', modality: 'in_rooms', min_duration_mins: 30, max_duration_mins: 45, is_initial: false, sort_order: 40 },
  { item_number: '306', description: 'Psychiatrist — subsequent attendance, 45+ mins', schedule_fee_cents: 30600, category: 'psychiatry_subsequent', modality: 'in_rooms', min_duration_mins: 45, max_duration_mins: null, is_initial: false, sort_order: 50 },

  // General specialist items (some psychiatrists use these)
  { item_number: '291', description: 'Specialist — initial referral consultation', schedule_fee_cents: 18530, category: 'psychiatry_initial', modality: 'in_rooms', min_duration_mins: 0, max_duration_mins: null, is_initial: true, sort_order: 5 },
  { item_number: '293', description: 'Specialist — subsequent consultation', schedule_fee_cents: 9500, category: 'psychiatry_subsequent', modality: 'in_rooms', min_duration_mins: 0, max_duration_mins: null, is_initial: false, sort_order: 6 },

  // Telehealth — phone
  { item_number: '2710', description: 'Psychiatrist — phone, initial consultation, 45+ mins', schedule_fee_cents: 34000, category: 'telehealth_phone', modality: 'phone', min_duration_mins: 45, max_duration_mins: null, is_initial: true, sort_order: 110 },
  { item_number: '2712', description: 'Psychiatrist — phone, subsequent, 30–45 mins', schedule_fee_cents: 23000, category: 'telehealth_phone', modality: 'phone', min_duration_mins: 30, max_duration_mins: 45, is_initial: false, sort_order: 120 },
  { item_number: '2713', description: 'Psychiatrist — phone, subsequent, 45+ mins', schedule_fee_cents: 30600, category: 'telehealth_phone', modality: 'phone', min_duration_mins: 45, max_duration_mins: null, is_initial: false, sort_order: 130 },

  // Telehealth — video
  { item_number: '2799', description: 'Psychiatrist — video, initial consultation, 45+ mins', schedule_fee_cents: 34000, category: 'telehealth_video', modality: 'video', min_duration_mins: 45, max_duration_mins: null, is_initial: true, sort_order: 210 },
  { item_number: '2801', description: 'Psychiatrist — video, subsequent, up to 15 mins', schedule_fee_cents: 9500, category: 'telehealth_video', modality: 'video', min_duration_mins: 0, max_duration_mins: 15, is_initial: false, sort_order: 220 },
  { item_number: '2803', description: 'Psychiatrist — video, subsequent, 15–30 mins', schedule_fee_cents: 15500, category: 'telehealth_video', modality: 'video', min_duration_mins: 15, max_duration_mins: 30, is_initial: false, sort_order: 230 },
  { item_number: '2805', description: 'Psychiatrist — video, subsequent, 30–45 mins', schedule_fee_cents: 23000, category: 'telehealth_video', modality: 'video', min_duration_mins: 30, max_duration_mins: 45, is_initial: false, sort_order: 240 },
  { item_number: '2807', description: 'Psychiatrist — video, subsequent, 45+ mins', schedule_fee_cents: 30600, category: 'telehealth_video', modality: 'video', min_duration_mins: 45, max_duration_mins: null, is_initial: false, sort_order: 250 },

  // Group therapy
  { item_number: '342', description: 'Group psychotherapy, per patient, 1+ hour', schedule_fee_cents: 6520, category: 'group_therapy', modality: 'group', min_duration_mins: 60, max_duration_mins: null, is_initial: false, sort_order: 310 },
  { item_number: '344', description: 'Group psychotherapy, per patient, subsequent', schedule_fee_cents: 6520, category: 'group_therapy', modality: 'group', min_duration_mins: 60, max_duration_mins: null, is_initial: false, sort_order: 320 },

  // ECT
  { item_number: '14224', description: 'Electroconvulsive therapy (ECT)', schedule_fee_cents: 22000, category: 'ect', modality: 'in_rooms', min_duration_mins: 0, max_duration_mins: null, is_initial: false, sort_order: 410 },

  // Case conferences
  { item_number: '319', description: 'Psychiatrist case conference, up to 15 mins', schedule_fee_cents: 6000, category: 'case_conference', modality: 'in_rooms', min_duration_mins: 0, max_duration_mins: 15, is_initial: false, sort_order: 510 },
  { item_number: '320', description: 'Psychiatrist case conference, 15–30 mins', schedule_fee_cents: 12000, category: 'case_conference', modality: 'in_rooms', min_duration_mins: 15, max_duration_mins: 30, is_initial: false, sort_order: 520 },
  { item_number: '322', description: 'Psychiatrist case conference, 30–45 mins', schedule_fee_cents: 18000, category: 'case_conference', modality: 'in_rooms', min_duration_mins: 30, max_duration_mins: 45, is_initial: false, sort_order: 530 },
  { item_number: '324', description: 'Psychiatrist case conference, 45+ mins', schedule_fee_cents: 24000, category: 'case_conference', modality: 'in_rooms', min_duration_mins: 45, max_duration_mins: null, is_initial: false, sort_order: 540 },
];

export async function seedMbsItems(clinicId: string): Promise<number> {
  let inserted = 0;
  for (const item of DEFAULT_MBS_ITEMS) {
    const exists = await db('fee_schedules')
      .where({ clinic_id: clinicId, item_number: item.item_number, source: 'mbs' })
      .first();

    if (!exists) {
      await db('fee_schedules').insert({
        clinic_id: clinicId,
        ...item,
        source: 'mbs',
        is_active: true,
      });
      inserted++;
    }
  }
  return inserted;
}
