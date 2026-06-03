import { db } from '../../db/db';

export abstract class BaseRepository<T extends { id: string; deleted_at?: string | null }> {
  constructor(protected readonly tableName: string) {}

  async findById(id: string, clinicId: string): Promise<T | null> {
    const row = await db(this.tableName)
      .where({ id, clinic_id: clinicId })
      .whereNull('deleted_at')
      .first() as T | undefined;
    return row ?? null;
  }

  async findAll(clinicId: string): Promise<T[]> {
    return db(this.tableName)
      .where({ clinic_id: clinicId })
      .whereNull('deleted_at')
      .orderBy('created_at', 'desc') as Promise<T[]>;
  }

  async softDelete(id: string, clinicId: string): Promise<void> {
    await db(this.tableName)
      .where({ id, clinic_id: clinicId })
      .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() });
  }
}
