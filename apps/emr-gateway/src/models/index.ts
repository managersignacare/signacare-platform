/**
 * Mongoose Read-Only Models — Zitavi MongoDB Collections
 *
 * ALL models are read-only. No write operations allowed.
 * Collection names match the existing Zitavi database exactly (including typos).
 * Field names are camelCase to match source data.
 */

import mongoose, { Schema } from 'mongoose';

const ObjectId = Schema.Types.ObjectId;
const opts = (collection: string): { collection: string; timestamps: false; versionKey: false } => ({ collection, timestamps: false, versionKey: false });

// ── Patients ──────────────────────────────────────────────────────────────────
export const Patient = mongoose.model('Patient', new Schema({
  firstName: String, lastName: String, email: String,
  phone: { countryCode: String, number: String },
  gender: String, dateOfBirth: Date, age: Number, urNumber: Number,
  profileImage: ObjectId, emergencyContacts: [{ name: String, relation: String, phone: { countryCode: String, number: String } }],
  notificationPreferences: Schema.Types.Mixed,
  role: String, assignedDoctorId: ObjectId, teamId: ObjectId,
  medicationFrequency: [String],
  campaignDetails: Schema.Types.Mixed,
  isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('patients')));

// ── Vitals ────────────────────────────────────────────────────────────────────
export const WeightVital = mongoose.model('WeightVital', new Schema({
  patientId: ObjectId, value: Number, unit: String, note: String, bmi: Number,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('weightvitals')));

export const HeartRateVital = mongoose.model('HeartRateVital', new Schema({
  patientId: ObjectId, value: Number, notes: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('heartratevitals')));

export const BloodPressureVital = mongoose.model('BloodPressureVital', new Schema({
  patientId: ObjectId, systolic: Number, diastolic: Number, pulse: Number, position: String, arm: String, notes: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('bloodpressurevitals')));

export const BloodSugarVital = mongoose.model('BloodSugarVital', new Schema({
  patientId: ObjectId, value: Number, unit: String, mealTime: String, notes: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('bloodsugarvitals')));

export const TemperatureVital = mongoose.model('TemperatureVital', new Schema({
  patientId: ObjectId, value: Number, unit: String, note: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('temperaturevitals')));

export const AbdominalCircumferenceVital = mongoose.model('AbdominalCircumferenceVital', new Schema({
  patientId: ObjectId, value: Number, unit: String, notes: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('abdominalcircumferencevitals')));

// ── Clinical ──────────────────────────────────────────────────────────────────
export const Medication = mongoose.model('Medication', new Schema({
  patientId: ObjectId, medicationName: String, dosage: String, frequency: String, route: String,
  isActive: Boolean, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('medications')));

export const Allergy = mongoose.model('Allergy', new Schema({
  patientId: ObjectId, Anaphylaxis: String, AllergicReactionADR: String, // Capital A — matching source
  isActive: Boolean, isDeleted: Boolean, updatedBy: ObjectId, createdAt: Date, updatedAt: Date,
}, opts('allergies')));

export const HealthCondition = mongoose.model('HealthCondition', new Schema({
  patientId: ObjectId, healthConditionDiagnosis: String, healthConditionDescription: String,
  diagnosisDate: Date, status: String, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('healthconditions')));

export const HealthRecord = mongoose.model('HealthRecord', new Schema({
  patientId: ObjectId, pronouns: String, signacareEMRNumber: String,
  medicareNumber: String, medicareIndividualReference: String, reminderExpiry: Date,
  healthFundName: String, healthFundNumber: String, healthFundPlan: String, healthFundExpiry: Date,
  dvaNumber: String, dvaCardType: String, ihiNumber: String,
  updatedBy: ObjectId, createdAt: Date, updatedAt: Date,
}, opts('healthrecords')));

// ── Alerts & Reminders ────────────────────────────────────────────────────────
export const Alert = mongoose.model('Alert', new Schema({
  patientId: ObjectId, message: String, dateTime: Date, msgType: String, status: String,
  isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('alerts')));

export const Reminder = mongoose.model('Reminder', new Schema({
  patientId: ObjectId, title: String, message: String, reminderTime: Date, type: String,
  isActive: Boolean, createdAt: Date, updatedAt: Date,
}, opts('reminders')));

// ── Mood & Journal ────────────────────────────────────────────────────────────
export const MoodEntry = mongoose.model('MoodEntry', new Schema({
  patientId: ObjectId, mood: Number, notes: String,
  recordedAt: Date, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('moodentries')));

export const JournalEntry = mongoose.model('JournalEntry', new Schema({
  patientId: ObjectId, title: String, content: String,
  attachments: [{ fileId: ObjectId, fileName: String, fileType: String, fileSize: Number, uploadedAt: Date }],
  isPrivate: Boolean, recordedBy: ObjectId, isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('journalentries')));

// ── Personal ──────────────────────────────────────────────────────────────────
export const SupportPerson = mongoose.model('SupportPerson', new Schema({
  patientId: ObjectId, name: String, relationship: String,
  phone: { countryCode: String, number: String }, email: String, shareConsent: String,
  isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('supportpeople')));

export const PersonalInfo = mongoose.model('PersonalInfo', new Schema({
  patientId: ObjectId, education: String, maritalStatus: String, profession: String, employmentStatus: String,
  isDeleted: Boolean, updatedBy: ObjectId, deletedAt: Date, createdAt: Date, updatedAt: Date,
}, opts('personalinfos')));

export const Lifestyle = mongoose.model('Lifestyle', new Schema({
  patientId: ObjectId, substanceUse: String, exercise: String, diet: String,
  height: String, weight: String, bmi: String, legalIssues: String,
  isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('lifestyles')));

// ── Highlights & Ratings ──────────────────────────────────────────────────────
export const Highlight = mongoose.model('Highlight', new Schema({
  callDate: String, callResponse: String, alertFlag: String, adherence: String,
  sideEffects: String, sideEffectDetails: String, sentiment: String, messagesExchanged: String,
  patientId: ObjectId, callId: String, createdAt: Date, updatedAt: Date,
}, opts('highlights')));

export const RatingCategory = mongoose.model('RatingCategory', new Schema({
  name: String, description: String, patientId: ObjectId,
  isDeleted: Boolean, deletedAt: Date, createdAt: Date, updatedAt: Date,
}, opts('ratingcategories')));

export const RatingEntry = mongoose.model('RatingEntry', new Schema({
  patientId: ObjectId, categoryId: ObjectId,
  ratings: [{ id: String, rating: Number, note: String, createdAt: Date, updatedAt: Date }],
  isDeleted: Boolean, deletedAt: Date, createdAt: Date, updatedAt: Date,
}, opts('ratingentries')));

// ── Reference (for lookups) ───────────────────────────────────────────────────
export const User = mongoose.model('User', new Schema({
  name: String, email: String, role: String, gender: String,
  isDeleted: Boolean, createdAt: Date, updatedAt: Date,
}, opts('users')));

export const Team = mongoose.model('Team', new Schema({
  name: String, hospitalId: ObjectId, createdAt: Date, updatedAt: Date,
}, opts('teams')));

export const Hospital = mongoose.model('Hospital', new Schema({
  name: String, phone: { countryCode: String, number: String }, createdAt: Date, updatedAt: Date,
}, opts('hospitals')));
