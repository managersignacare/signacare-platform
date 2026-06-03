# Non-medical AI scribe research — top 10 products (2025-2026)

## Feature matrix (condensed — see raw agent output for full detail)

- Cloud-first: Fireflies, Otter, Grain, Fathom, tl;dv, Gong, Zoom, Teams, Read AI
- Local-first: Granola (Mac-native, system audio, no bot)
- Offline-capable: Granola, Teams Copilot (partial)
- Two-party-consent lawsuits hit Otter 2025 (CA class action) → opt-in flow now mandatory
- Action-item → Jira/Asana: Fireflies, tl;dv, Gong, Zoom Tasks
- Local model: Granola; GPT-4o: Zoom/Teams; Claude+Gemini: Read AI; Claude+ChatGPT: Fathom
- 100+ language support: Fireflies, Read AI, Teams Copilot
- Agentic workflows (autonomous follow-up): Gong "Mission Andromeda", Zoom AI Companion 3.0, Read AI (Sep 2025)

## Translatable features worth porting to medical scribe

1. Live coaching / real-time metrics (talk-ratio, filler words, question frequency) — Grain pattern → clinical guideline adherence prompts
2. Action-item → task automation — port to EHR order/referral/med-rec queues
3. Speaker-label training over time (Otter voice-learning) → distinguish clinician/patient/family/interpreter/scribe
4. Semantic cross-meeting search (Read AI Search Copilot, Gong topic tracking) → cross-encounter search over patient history
5. Pre-meeting briefing (Teams Copilot auto-pulls agenda + docs) → pre-consult summary of prior visit + meds + labs
6. Custom vocabulary / pronunciation training — clinical lexicon (drug names, anatomy, patient names)
7. Agentic workflows (Gong Mission Andromeda) → autonomous follow-up scheduling, referral placement, lab order routing
8. Local-first + bot-free (Granola) — zero cloud data path for high-sensitivity encounters

## Privacy/consent patterns to borrow

- Pre-recording explicit consent banner (post-Otter 2025 CA class action)
- Audio-fingerprint consent receipt (not yet in mainstream; blockchain-signed receipts proposed)
- Participant opt-in not opt-out (current default is opt-out — medical must be opt-in)
- Configurable retention + auto-purge (Teams per-org, Fathom 5-meeting limit)
- Local device recording with no cloud round-trip (Granola) — applicable for high-sensitivity psych sessions
- EU data residency option (Teams Copilot)
- Participant-controlled redaction (NOT yet available anywhere — innovation opportunity)

## Gaps in the current medical-scribe market vs these non-medical features

| Gap | Why matters for Signacare | Leader to copy from |
|---|---|---|
| Pre-recording fingerprint + consent proof | Two-party consent jurisdictions | None — greenfield |
| Real-time clinical PII redaction | PHI handling during recording | Dialpad 2025 pilot |
| Clinician-specific talk ratios | Shared decision-making guideline | Grain |
| Medication vocabulary | Drug-name accuracy | Azure Custom Vocabulary |
| Family / interpreter role labels | Multi-party encounters | Otter (basic) |
| Native EHR task integration | Epic/Best Practice/MedicalDirector integration | Zoom Tasks pattern |
| Patient-viewable transcript | Transparency + accuracy check | Read AI (search) |
| Sensitive-topic detection | Suicide / abuse / substance use flags | Gong custom trackers |
| Agentic follow-up workflows | Automated referral / order placement | Gong Mission Andromeda |
| Cross-encounter semantic search | Find allergies/dx across patient history | Read AI Search Copilot |

