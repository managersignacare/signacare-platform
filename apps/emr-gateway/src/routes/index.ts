/**
 * EMR Gateway API Routes — All Read-Only
 *
 * Every endpoint returns JSON in the standard envelope:
 *   { success: true, data: T, meta?: PaginationMeta }
 *   { success: false, error: { code: string, message: string } }
 */

import { Router, type Request, type Response } from 'express';
import mongoose from 'mongoose';
import {
  Patient, WeightVital, HeartRateVital, BloodPressureVital, BloodSugarVital,
  TemperatureVital, AbdominalCircumferenceVital, Medication, Allergy,
  HealthCondition, HealthRecord, Alert, Reminder, MoodEntry, JournalEntry,
  SupportPerson, PersonalInfo, Lifestyle, Highlight, RatingCategory, RatingEntry, User, Team,
} from '../models';
import { paginate, dateFilter } from '../services/pagination';

const router = Router();

type GatewayRecord = Record<string, unknown>;

const asRecord = (value: unknown): GatewayRecord => (
  value != null && typeof value === 'object' ? (value as GatewayRecord) : {}
);

const readIdString = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'object' && 'toString' in value && typeof value.toString === 'function') {
    return value.toString();
  }
  return null;
};

const readEntityName = (value: unknown): string | null => {
  const name = asRecord(value).name;
  return typeof name === 'string' ? name : null;
};

const ok = (res: Response, data: unknown, meta?: unknown) => res.json({ success: true, data, ...(meta ? { meta } : {}) });
const notFound = (res: Response, msg: string) => res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: msg } });
const toId = (id: string) => { try { return new mongoose.Types.ObjectId(id); } catch { return null; } };

const MOOD_LABELS: Record<number, string> = {
  1: 'Very Poor', 2: 'Poor', 3: 'Slightly Unhappy', 4: 'Somewhat Unhappy',
  5: 'Neutral', 6: 'Slightly Happy', 7: 'Somewhat Happy', 8: 'Good',
  9: 'Very Good', 10: 'Excellent',
};

// ── Health Check ──────────────────────────────────────────────────────────────
router.get('/health', (_req, res) => res.json({ status: 'ok', service: 'emr-gateway', timestamp: new Date() }));

// ── Patients ──────────────────────────────────────────────────────────────────
router.get('/patients', async (req: Request, res: Response) => {
  const { search } = req.query;
  const filter: GatewayRecord = { isDeleted: false, role: 'patient' };
  if (search) {
    const s = String(search);
    filter.$or = [
      { firstName: { $regex: s, $options: 'i' } },
      { lastName: { $regex: s, $options: 'i' } },
      { email: { $regex: s, $options: 'i' } },
      { 'phone.number': { $regex: s, $options: 'i' } },
    ];
  }
  const result = await paginate(Patient, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { createdAt: -1 } });

  // Populate doctor and team names
  const doctorIds = [...new Set(result.data.map((p) => readIdString(asRecord(p).assignedDoctorId)).filter(Boolean))];
  const teamIds = [...new Set(result.data.map((p) => readIdString(asRecord(p).teamId)).filter(Boolean))];
  const [doctors, teams] = await Promise.all([
    doctorIds.length ? User.find({ _id: { $in: doctorIds } }).lean() : [],
    teamIds.length ? Team.find({ _id: { $in: teamIds } }).lean() : [],
  ]);
  const doctorMap = Object.fromEntries((doctors as unknown[]).map((d) => {
    const row = asRecord(d);
    return [readIdString(row._id) ?? '', readEntityName(row) ?? null];
  }));
  const teamMap = Object.fromEntries((teams as unknown[]).map((t) => {
    const row = asRecord(t);
    return [readIdString(row._id) ?? '', readEntityName(row) ?? null];
  }));

  const enriched = result.data.map((p) => {
    const row = asRecord(p);
    const assignedDoctorId = readIdString(row.assignedDoctorId);
    const teamId = readIdString(row.teamId);
    return {
      ...row,
      assignedDoctorName: assignedDoctorId ? (doctorMap[assignedDoctorId] ?? null) : null,
      teamName: teamId ? (teamMap[teamId] ?? null) : null,
    };
  });

  ok(res, enriched, result.meta);
});

router.get('/patients/:patientId', async (req, res) => {
  const id = toId(req.params.patientId);
  if (!id) return notFound(res, 'Invalid patient ID');
  const patient = await Patient.findOne({ _id: id, isDeleted: false }).lean();
  if (!patient) return notFound(res, 'Patient not found');

  const p = asRecord(patient);
  const [doctor, team] = await Promise.all([
    p.assignedDoctorId ? User.findById(p.assignedDoctorId).lean() : null,
    p.teamId ? Team.findById(p.teamId).lean() : null,
  ]);

  ok(res, { ...p, assignedDoctorName: readEntityName(doctor), teamName: readEntityName(team) });
});

// ── Vitals (generic helper) ───────────────────────────────────────────────────
function vitalRoute(path: string, model: unknown, dateField: string = 'recordedAt') {
  router.get(`/patients/:patientId/vitals/${path}`, async (req, res) => {
    const pid = toId(req.params.patientId);
    if (!pid) return notFound(res, 'Invalid patient ID');
    const filter = { patientId: pid, isDeleted: false, ...dateFilter(req.query.startDate as string, req.query.endDate as string, dateField) };
    const result = await paginate(model as Parameters<typeof paginate>[0], { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { [dateField]: -1 } });
    ok(res, result.data, result.meta);
  });
}

vitalRoute('weight', WeightVital);
vitalRoute('heart-rate', HeartRateVital);
vitalRoute('blood-pressure', BloodPressureVital);
vitalRoute('blood-sugar', BloodSugarVital);
vitalRoute('temperature', TemperatureVital);
vitalRoute('abdominal-circumference', AbdominalCircumferenceVital);

// Weight chart data
router.get('/patients/:patientId/vitals/weight/chart', async (req, res) => {
  const pid = toId(req.params.patientId);
  if (!pid) return notFound(res, 'Invalid patient ID');
  const { startDate, endDate } = req.query;
  if (!startDate || !endDate) return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'startDate and endDate required' } });
  const rows = await WeightVital.find({ patientId: pid, isDeleted: false, recordedAt: { $gte: new Date(startDate as string), $lte: new Date(endDate as string) } }).sort({ recordedAt: 1 }).lean();
  ok(res, (rows as unknown[]).map((r) => {
    const row = asRecord(r);
    const recordedAt = row.recordedAt instanceof Date ? row.recordedAt : null;
    return {
      date: recordedAt?.toISOString().split('T')[0],
      time: recordedAt?.toISOString().split('T')[1]?.substring(0, 5),
      value: row.value,
      unit: row.unit ?? 'kg',
      bmi: row.bmi ?? null,
    };
  }));
});

// Blood pressure stats
router.get('/patients/:patientId/vitals/blood-pressure/stats', async (req, res) => {
  const pid = toId(req.params.patientId);
  if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false };
  const recordedAt: GatewayRecord = {};
  if (req.query.startDate) recordedAt.$gte = new Date(req.query.startDate as string);
  if (req.query.endDate) recordedAt.$lte = new Date(req.query.endDate as string);
  if (Object.keys(recordedAt).length > 0) filter.recordedAt = recordedAt;

  const [stats] = await BloodPressureVital.aggregate([
    { $match: filter },
    { $group: {
      _id: null,
      sysAvg: { $avg: '$systolic' }, sysMin: { $min: '$systolic' }, sysMax: { $max: '$systolic' },
      diaAvg: { $avg: '$diastolic' }, diaMin: { $min: '$diastolic' }, diaMax: { $max: '$diastolic' },
      pulseAvg: { $avg: '$pulse' }, pulseMin: { $min: '$pulse' }, pulseMax: { $max: '$pulse' },
      totalReadings: { $sum: 1 },
    }},
  ]);
  ok(res, stats ? {
    systolic: { avg: Math.round(stats.sysAvg), min: stats.sysMin, max: stats.sysMax },
    diastolic: { avg: Math.round(stats.diaAvg), min: stats.diaMin, max: stats.diaMax },
    pulse: { avg: Math.round(stats.pulseAvg), min: stats.pulseMin, max: stats.pulseMax },
    totalReadings: stats.totalReadings,
  } : { systolic: null, diastolic: null, pulse: null, totalReadings: 0 });
});

// Blood sugar stats
router.get('/patients/:patientId/vitals/blood-sugar/stats', async (req, res) => {
  const pid = toId(req.params.patientId);
  if (!pid) return notFound(res, 'Invalid patient ID');
  const days = Number(req.query.days) || 30;
  const since = new Date(); since.setDate(since.getDate() - days);
  const filter = { patientId: pid, isDeleted: false, recordedAt: { $gte: since } };

  const stats = await BloodSugarVital.aggregate([
    { $match: filter },
    { $group: { _id: '$mealTime', avg: { $avg: '$value' }, min: { $min: '$value' }, max: { $max: '$value' }, count: { $sum: 1 } } },
  ]);
  const all = await BloodSugarVital.aggregate([
    { $match: filter },
    { $group: { _id: null, avg: { $avg: '$value' }, min: { $min: '$value' }, max: { $max: '$value' }, total: { $sum: 1 } } },
  ]);
  const byMealTime = Object.fromEntries(stats.map(s => [s._id, { avg: Math.round(s.avg), count: s.count }]));
  ok(res, { average: all[0] ? Math.round(all[0].avg) : null, min: all[0]?.min, max: all[0]?.max, totalReadings: all[0]?.total ?? 0, byMealTime });
});

// ── Medications ───────────────────────────────────────────────────────────────
router.get('/patients/:patientId/medications', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false };
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const result = await paginate(Medication, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50, sort: { createdAt: -1 } });
  ok(res, result.data, result.meta);
});

// ── Allergies ─────────────────────────────────────────────────────────────────
router.get('/patients/:patientId/allergies', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false };
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const result = await paginate(Allergy, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50, sort: { createdAt: -1 } });
  ok(res, result.data, result.meta);
});

// ── Health Conditions ─────────────────────────────────────────────────────────
router.get('/patients/:patientId/health-conditions', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  const result = await paginate(HealthCondition, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50, sort: { createdAt: -1 } });
  ok(res, result.data, result.meta);
});

// ── Health Record (single per patient) ────────────────────────────────────────
router.get('/patients/:patientId/health-record', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const record = await HealthRecord.findOne({ patientId: pid }).lean();
  ok(res, record);
});

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get('/patients/:patientId/alerts', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false, ...dateFilter(req.query.startDate as string, req.query.endDate as string, 'dateTime') };
  if (req.query.status && req.query.status !== 'all') filter.status = req.query.status;
  if (req.query.msgType && req.query.msgType !== 'all') filter.msgType = req.query.msgType;
  const result = await paginate(Alert, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { dateTime: -1 } });
  ok(res, result.data, result.meta);
});

// ── Reminders ─────────────────────────────────────────────────────────────────
router.get('/patients/:patientId/reminders', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid };
  if (req.query.type) filter.type = req.query.type;
  if (req.query.isActive !== undefined) filter.isActive = req.query.isActive === 'true';
  const result = await paginate(Reminder, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { reminderTime: -1 } });
  ok(res, result.data, result.meta);
});

// ── Mood Entries ──────────────────────────────────────────────────────────────
router.get('/patients/:patientId/mood-entries', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter = { patientId: pid, isDeleted: false, ...dateFilter(req.query.startDate as string, req.query.endDate as string) };
  const result = await paginate(MoodEntry, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { recordedAt: -1 } });
  const enriched = result.data.map((m) => {
    const row = asRecord(m);
    const mood = typeof row.mood === 'number' ? row.mood : Number(row.mood);
    return { ...row, moodLabel: MOOD_LABELS[mood] ?? 'Unknown' };
  });
  ok(res, enriched, result.meta);
});

// ── Journal Entries ───────────────────────────────────────────────────────────
router.get('/patients/:patientId/journal-entries', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false, ...dateFilter(req.query.startDate as string, req.query.endDate as string, 'createdAt') };
  if (req.query.isPrivate !== undefined) filter.isPrivate = req.query.isPrivate === 'true';
  const result = await paginate(JournalEntry, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { createdAt: -1 } });
  // Strip file URLs — only return metadata
  const sanitized = result.data.map((j) => {
    const row = asRecord(j);
    const attachments = Array.isArray(row.attachments) ? row.attachments : [];
    return {
      ...row,
      attachments: attachments.map((a) => {
        const attachment = asRecord(a);
        return {
          fileName: attachment.fileName,
          fileType: attachment.fileType,
          fileSize: attachment.fileSize,
          uploadedAt: attachment.uploadedAt,
        };
      }),
    };
  });
  ok(res, sanitized, result.meta);
});

// ── Support Persons ───────────────────────────────────────────────────────────
router.get('/patients/:patientId/support-persons', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const result = await paginate(SupportPerson, { filter: { patientId: pid, isDeleted: false }, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 50, sort: { createdAt: -1 } });
  ok(res, result.data, result.meta);
});

// ── Personal Info (single per patient) ────────────────────────────────────────
router.get('/patients/:patientId/personal-info', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const info = await PersonalInfo.findOne({ patientId: pid, isDeleted: false }).lean();
  ok(res, info);
});

// ── Lifestyle (single per patient) ────────────────────────────────────────────
router.get('/patients/:patientId/lifestyle', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const info = await Lifestyle.findOne({ patientId: pid, isDeleted: false }).lean();
  ok(res, info);
});

// ── Highlights ────────────────────────────────────────────────────────────────
router.get('/patients/:patientId/highlights', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter = { patientId: pid, ...dateFilter(req.query.startDate as string, req.query.endDate as string, 'createdAt') };
  const result = await paginate(Highlight, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { createdAt: -1 } });
  ok(res, result.data, result.meta);
});

// ── Ratings ───────────────────────────────────────────────────────────────────
router.get('/patients/:patientId/rating-categories', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const cats = await RatingCategory.find({ patientId: pid, isDeleted: false }).lean();
  ok(res, cats);
});

router.get('/patients/:patientId/ratings', async (req, res) => {
  const pid = toId(req.params.patientId); if (!pid) return notFound(res, 'Invalid patient ID');
  const filter: GatewayRecord = { patientId: pid, isDeleted: false };
  if (req.query.categoryId) { const cid = toId(req.query.categoryId as string); if (cid) filter.categoryId = cid; }
  const result = await paginate(RatingEntry, { filter, page: Number(req.query.page) || 1, limit: Number(req.query.limit) || 20, sort: { createdAt: -1 } });

  // Populate category names
  const catIds = [...new Set(result.data.map((r) => readIdString(asRecord(r).categoryId)).filter(Boolean))];
  const cats = catIds.length ? await RatingCategory.find({ _id: { $in: catIds } }).lean() : [];
  const catMap = Object.fromEntries((cats as unknown[]).map((c) => {
    const row = asRecord(c);
    return [readIdString(row._id) ?? '', readEntityName(row) ?? null];
  }));
  const enriched = result.data.map((r) => {
    const row = asRecord(r);
    const categoryId = readIdString(row.categoryId);
    return { ...row, categoryName: categoryId ? (catMap[categoryId] ?? null) : null };
  });
  ok(res, enriched, result.meta);
});

// ── Summary (combined overview) ───────────────────────────────────────────────
router.get('/patients/:patientId/summary', async (req, res) => {
  const pid = toId(req.params.patientId);
  if (!pid) return notFound(res, 'Invalid patient ID');
  const patient = await Patient.findOne({ _id: pid, isDeleted: false }).lean();
  if (!patient) return notFound(res, 'Patient not found');

  const p = asRecord(patient);
  const [doctor, team] = await Promise.all([
    p.assignedDoctorId ? User.findById(p.assignedDoctorId).lean() : null,
    p.teamId ? Team.findById(p.teamId).lean() : null,
  ]);

  const [weight, heartRate, bp, sugar, temp, abdominal, meds, allergies, conditions, healthRecord, personalInfo, lifestyle, alerts, moods, supportPersons, reminders] = await Promise.all([
    WeightVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    HeartRateVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    BloodPressureVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    BloodSugarVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    TemperatureVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    AbdominalCircumferenceVital.findOne({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).lean(),
    Medication.find({ patientId: pid, isActive: true, isDeleted: false }).lean(),
    Allergy.find({ patientId: pid, isActive: true, isDeleted: false }).lean(),
    HealthCondition.find({ patientId: pid, status: 'active', isDeleted: false }).lean(),
    HealthRecord.findOne({ patientId: pid }).lean(),
    PersonalInfo.findOne({ patientId: pid, isDeleted: false }).lean(),
    Lifestyle.findOne({ patientId: pid, isDeleted: false }).lean(),
    Alert.find({ patientId: pid, isDeleted: false }).sort({ dateTime: -1 }).limit(5).lean(),
    MoodEntry.find({ patientId: pid, isDeleted: false }).sort({ recordedAt: -1 }).limit(5).lean(),
    SupportPerson.find({ patientId: pid, isDeleted: false }).lean(),
    Reminder.find({ patientId: pid, isActive: true, reminderTime: { $gt: new Date() } }).sort({ reminderTime: 1 }).limit(5).lean(),
  ]);

  ok(res, {
    patient: { ...p, assignedDoctorName: readEntityName(doctor), teamName: readEntityName(team) },
    latestVitals: { weight, heartRate, bloodPressure: bp, bloodSugar: sugar, temperature: temp, abdominalCircumference: abdominal },
    activeMedications: meds,
    activeAllergies: allergies,
    activeHealthConditions: conditions,
    healthRecord, personalInfo, lifestyle,
    recentAlerts: alerts,
    recentMoodEntries: (moods as unknown[]).map((m) => {
      const row = asRecord(m);
      const mood = typeof row.mood === 'number' ? row.mood : Number(row.mood);
      return { ...row, moodLabel: MOOD_LABELS[mood] ?? 'Unknown' };
    }),
    supportPersons,
    upcomingReminders: reminders,
  });
});

export default router;
