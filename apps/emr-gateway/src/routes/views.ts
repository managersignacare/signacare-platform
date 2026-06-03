/**
 * Server-rendered HTML views for EMR iframe embedding.
 * Auth via apiKey query param.
 */

import { Router } from 'express';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { Patient, User, Team } from '../models';
import { paginate } from '../services/pagination';
import mongoose from 'mongoose';

const router = Router();
router.use(apiKeyAuth);

interface PatientListQueryFilter {
  isDeleted: boolean;
  role: 'patient';
  $or?: Array<Record<string, { $regex: string; $options: 'i' }>>;
}

interface PatientListRow {
  _id: mongoose.Types.ObjectId;
  assignedDoctorId?: mongoose.Types.ObjectId | null;
  teamId?: mongoose.Types.ObjectId | null;
}

interface NamedLookupRow {
  _id: mongoose.Types.ObjectId;
  name?: string | null;
}

interface MoodEntryRow {
  mood?: number | null;
}

function toIdString(value: mongoose.Types.ObjectId | null | undefined): string | null {
  return value ? value.toString() : null;
}

// Patient List
router.get('/patients', async (req, res, next) => {
  try {
    const search = req.query.search as string | undefined;
    const filter: PatientListQueryFilter = { isDeleted: false, role: 'patient' };
    if (search) {
      filter.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { 'phone.number': { $regex: search, $options: 'i' } },
      ];
    }

    const result = await paginate(Patient, { filter, page: Number(req.query.page) || 1, limit: 25, sort: { createdAt: -1 } });
    const patientRows = result.data as PatientListRow[];

    // Populate names
    const doctorIds = [...new Set(patientRows.map((p) => toIdString(p.assignedDoctorId)).filter((id): id is string => Boolean(id)))];
    const teamIds = [...new Set(patientRows.map((p) => toIdString(p.teamId)).filter((id): id is string => Boolean(id)))];
    const [doctors, teams] = await Promise.all([
      doctorIds.length ? User.find({ _id: { $in: doctorIds } }).lean() : [],
      teamIds.length ? Team.find({ _id: { $in: teamIds } }).lean() : [],
    ]);
    const dMap = Object.fromEntries((doctors as NamedLookupRow[]).map((d) => [d._id.toString(), d.name]));
    const tMap = Object.fromEntries((teams as NamedLookupRow[]).map((t) => [t._id.toString(), t.name]));
    const patients = patientRows.map((p) => {
      const assignedDoctorId = toIdString(p.assignedDoctorId);
      const teamId = toIdString(p.teamId);
      return {
        ...p,
        assignedDoctorName: assignedDoctorId ? (dMap[assignedDoctorId] ?? null) : null,
        teamName: teamId ? (tMap[teamId] ?? null) : null,
      };
    });

    res.render('patients/list', { patients, meta: result.meta, search, apiKey: req.query.apiKey ?? req.headers['x-api-key'] });
  } catch (err) { next(err); }
});

// Patient Detail (summary view)
router.get('/patients/:patientId', async (req, res, next) => {
  try {
    const id = new mongoose.Types.ObjectId(req.params.patientId);
    const apiKey = (req.query.apiKey ?? req.headers['x-api-key']) as string;

    // Direct DB queries (same as summary route)
    const {
      Patient: PatientModel, WeightVital, HeartRateVital, BloodPressureVital, BloodSugarVital,
      TemperatureVital, AbdominalCircumferenceVital, Medication, Allergy, HealthCondition,
      HealthRecord, Alert, Reminder, MoodEntry, SupportPerson, User: UserModel, Team: TeamModel,
    } = await import('../models');

    const patient = await PatientModel.findOne({ _id: id, isDeleted: false }).lean();
    if (!patient) { res.status(404).send('Patient not found'); return; }

    const p = patient as PatientListRow;
    const [doctor, team] = await Promise.all([
      p.assignedDoctorId ? UserModel.findById(p.assignedDoctorId).lean() : null,
      p.teamId ? TeamModel.findById(p.teamId).lean() : null,
    ]);

    const MOOD_LABELS: Record<number, string> = { 1:'Very Poor', 2:'Poor', 3:'Slightly Unhappy', 4:'Somewhat Unhappy', 5:'Neutral', 6:'Slightly Happy', 7:'Somewhat Happy', 8:'Good', 9:'Very Good', 10:'Excellent' };

    const [weight, heartRate, bp, sugar, temp, abdominal, meds, allergies, conditions, healthRecord, alerts, moods, supportPersons, reminders] = await Promise.all([
      WeightVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      HeartRateVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      BloodPressureVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      BloodSugarVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      TemperatureVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      AbdominalCircumferenceVital.findOne({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
      Medication.find({ patientId: id, isActive: true, isDeleted: false }).lean(),
      Allergy.find({ patientId: id, isActive: true, isDeleted: false }).lean(),
      HealthCondition.find({ patientId: id, status: 'active', isDeleted: false }).lean(),
      HealthRecord.findOne({ patientId: id }).lean(),
      Alert.find({ patientId: id, isDeleted: false }).sort({ dateTime: -1 }).limit(5).lean(),
      MoodEntry.find({ patientId: id, isDeleted: false }).sort({ recordedAt: -1 }).limit(5).lean(),
      SupportPerson.find({ patientId: id, isDeleted: false }).lean(),
      Reminder.find({ patientId: id, isActive: true, reminderTime: { $gt: new Date() } }).sort({ reminderTime: 1 }).limit(5).lean(),
    ]);

    const data = {
      patient: { ...p, assignedDoctorName: (doctor as NamedLookupRow | null)?.name ?? null, teamName: (team as NamedLookupRow | null)?.name ?? null },
      latestVitals: { weight, heartRate, bloodPressure: bp, bloodSugar: sugar, temperature: temp, abdominalCircumference: abdominal },
      activeMedications: meds, activeAllergies: allergies, activeHealthConditions: conditions,
      healthRecord, recentAlerts: alerts,
      recentMoodEntries: (moods as MoodEntryRow[]).map((m) => ({ ...m, moodLabel: MOOD_LABELS[m.mood ?? 0] ?? 'Unknown' })),
      supportPersons, upcomingReminders: reminders,
    };

    res.render('patients/detail', { data, apiKey });
  } catch (err) { next(err); }
});

export default router;
