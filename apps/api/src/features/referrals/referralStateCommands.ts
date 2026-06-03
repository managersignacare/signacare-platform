// @jsonb-extraction-exempt: command module performs status/note mutations only; response mapping remains in referralService mappers.
import { db } from '../../db/db';
import { AppError } from '../../shared/errors';
import { assertReferralStatusTransition } from './referralStatusStateMachine';
import { REFERRAL_COLUMNS, REFERRAL_STATE_TRANSITION_COLUMNS } from './referralRepository';
import type { ReferralDbRow } from './referralRepository';

type AppendReferralNoteInput = {
  clinicId: string;
  referralId: string;
  actorId: string;
  note: string;
};

type UpdateReferralStatusByEpisodeInput = {
  clinicId: string;
  episodeId: string;
  status: string;
};

export const referralStateCommands = {
  async appendReferralNote(input: AppendReferralNoteInput) {
    const current = await db('referrals')
      .where({ id: input.referralId, clinic_id: input.clinicId })
      .whereNull('deleted_at')
      .first('task_status');

    if (!current) {
      throw new AppError('Referral not found', 404, 'NOT_FOUND');
    }

    const [row] = await db('referral_state_transitions')
      .insert({
        clinic_id: input.clinicId,
        referral_id: input.referralId,
        from_task_status: current.task_status,
        to_task_status: current.task_status,
        actor_id: input.actorId,
        reason: input.note,
        created_at: new Date(),
      })
      .returning(REFERRAL_STATE_TRANSITION_COLUMNS);

    return row;
  },

  async updateReferralStatusByEpisode(
    input: UpdateReferralStatusByEpisodeInput,
  ): Promise<ReferralDbRow | null> {
    const current = await db('referrals')
      .where({ linked_episode_id: input.episodeId, clinic_id: input.clinicId })
      .whereNull('deleted_at')
      .first('id', 'status');

    if (!current) {
      return null;
    }

    assertReferralStatusTransition(String(current.status), input.status);

    const [row] = await db('referrals')
      .where({ id: current.id, clinic_id: input.clinicId })
      .whereNull('deleted_at')
      .update({
        status: input.status,
        status_changed_at: new Date(),
        updated_at: new Date(),
      })
      .returning(REFERRAL_COLUMNS);

    return row ?? null;
  },
};
