"""
Signacare EMR — Whisper Large V3 Turbo Transcription Server

2-pass clinical transcription pipeline:
  1. Whisper large-v3-turbo with clinical vocabulary boosting
  2. Speaker diarization (clinician vs patient) via energy-based detection
  3. Post-processing: medication name correction, timestamps

All processing is local — no audio data leaves the network.

Usage:
    gunicorn --bind 0.0.0.0:8080 server:app
    python server.py                    # Local dev only

First run will download whisper-large-v3-turbo (~1.6GB).
"""

import os
import sys
import time
import logging
import argparse
import hashlib
import tempfile
import re
from pathlib import Path
from difflib import get_close_matches

from flask import Flask, request, jsonify
from flask_cors import CORS

logging.basicConfig(level=logging.INFO, format='%(asctime)s [Whisper] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# ── Global state ─────────────────────────────────────────────────────────────
# WHISPER_MODEL: lazy-loaded torch model.
# DEVICE: 'auto' | 'cpu' | 'cuda' | 'mps' (auto-detect default).
# MODEL_NAME: tag for the loaded weights. Override via WHISPER_MODEL env-var.
# MODEL_DIGEST: SHA-256 of the loaded weights file in the torch cache.
#   Computed once at load_whisper() and cached. Surfaced via /health and
#   every /inference response as the audit identity (BUG-424). Stored as
#   bare 64-hex digest; the TS audit helper composes the canonical
#   `<name>@sha256:<digest>` string before writing to llm_interactions.
WHISPER_MODEL = None
DEVICE = os.environ.get('WHISPER_DEVICE', 'auto')
MODEL_NAME = os.environ.get('WHISPER_MODEL', 'large-v3-turbo')
MODEL_DIGEST = None  # set by load_whisper(); None until weights loaded

# ── Clinical Vocabulary ──────────────────────────────────────────────────────
# Passed as initial_prompt to Whisper to dramatically improve med-term accuracy

CLINICAL_VOCAB_PROMPT = (
    "Clinical consultation. Psychiatrist and patient discussing mental health treatment. "
    # Antipsychotics
    "olanzapine, clozapine, risperidone, quetiapine, aripiprazole, paliperidone, "
    "ziprasidone, lurasidone, brexpiprazole, cariprazine, amisulpride, "
    # LAI (Long-Acting Injectables)
    "paliperidone palmitate, Invega Sustenna, Invega Trinza, aripiprazole lauroxil, "
    "Aristada, Abilify Maintena, risperidone LAI, Risperdal Consta, "
    "zuclopenthixol decanoate, Clopixol Depot, flupentixol decanoate, Fluanxol Depot, "
    "haloperidol decanoate, "
    # Antidepressants
    "sertraline, fluoxetine, escitalopram, citalopram, paroxetine, venlafaxine, "
    "desvenlafaxine, duloxetine, mirtazapine, amitriptyline, nortriptyline, "
    "bupropion, agomelatine, vortioxetine, moclobemide, phenelzine, tranylcypromine, "
    # Mood Stabilisers
    "lithium, lithium carbonate, sodium valproate, valproate, carbamazepine, lamotrigine, "
    # Benzodiazepines
    "diazepam, lorazepam, clonazepam, oxazepam, temazepam, nitrazepam, alprazolam, "
    # Other Psych
    "methylphenidate, dexamfetamine, lisdexamfetamine, Vyvanse, atomoxetine, "
    "naltrexone, acamprosate, disulfiram, buprenorphine, methadone, "
    "melatonin, prazosin, propranolol, benztropine, "
    # Clinical terms
    "Mental State Examination, MSE, SOAP note, psychosis, schizophrenia, "
    "schizoaffective, bipolar, mania, hypomania, depression, anxiety, "
    "PTSD, post-traumatic stress, borderline personality, BPD, "
    "obsessive compulsive, OCD, anorexia nervosa, bulimia, ADHD, "
    "autism spectrum, intellectual disability, substance use disorder, "
    "suicidal ideation, self-harm, deliberate self-harm, DSH, "
    "auditory hallucinations, command hallucinations, paranoid ideation, "
    "thought disorder, formal thought disorder, flight of ideas, "
    "loosening of associations, thought blocking, ideas of reference, "
    "persecutory delusions, grandiose delusions, nihilistic delusions, "
    "euthymic, dysphoric, labile, congruent, incongruent, blunted affect, flat affect, "
    "insight, judgement, cognition, orientation, "
    # Australian terms
    "Mental Health Act, community treatment order, CTO, "
    "involuntary treatment order, ITO, assessment order, temporary treatment order, "
    "tribunal, MHRT, Mental Health Review Tribunal, "
    "CAT team, crisis assessment, ACIS, PARC, CCU, IPU, HDU, "
    "HoNOS, Health of the Nation Outcome Scales, "
    "K10, Kessler, LSP, Life Skills Profile, BASIS-32, "
    "NDIS, National Disability Insurance Scheme, "
    "PBS, Pharmaceutical Benefits Scheme, "
    # ICD-10 codes
    "F20, F20.0, F20.1, F25, F31, F32, F33, F40, F41, F42, F43, F60, F84, "
    # Clozapine monitoring
    "clozapine monitoring, ANC, absolute neutrophil count, white cell count, WCC, "
    "metabolic syndrome, HbA1c, fasting glucose, lipid profile, prolactin, "
    "QTc interval, ECG, electrocardiogram, BMI, body mass index, "
    "agranulocytosis, neutropenia, myocarditis, "
    # Common phrases
    "milligrams, twice daily, three times daily, once daily, every morning, "
    "at night, nocte, mane, PRN, as needed, as required, "
    "intramuscular, IM, subcutaneous, oral, "
    "blood test, pathology, full blood count, FBC, liver function, LFT, "
    "urea electrolytes, UEC, thyroid function, TFT, drug screen, UDS"
)

# ── Medication Spell-Check Dictionary ─────────────────────────────────────────

MEDICATION_NAMES = [
    # Antipsychotics
    "olanzapine", "clozapine", "risperidone", "quetiapine", "aripiprazole",
    "paliperidone", "ziprasidone", "lurasidone", "brexpiprazole", "cariprazine",
    "amisulpride", "haloperidol", "chlorpromazine", "trifluoperazine",
    "zuclopenthixol", "flupentixol", "fluphenazine", "pimozide",
    # Antidepressants
    "sertraline", "fluoxetine", "escitalopram", "citalopram", "paroxetine",
    "fluvoxamine", "venlafaxine", "desvenlafaxine", "duloxetine", "mirtazapine",
    "amitriptyline", "nortriptyline", "imipramine", "clomipramine",
    "bupropion", "agomelatine", "vortioxetine", "moclobemide",
    "phenelzine", "tranylcypromine",
    # Mood Stabilisers
    "lithium", "valproate", "carbamazepine", "lamotrigine", "topiramate",
    # Benzodiazepines
    "diazepam", "lorazepam", "clonazepam", "oxazepam", "temazepam",
    "nitrazepam", "alprazolam", "midazolam",
    # Stimulants / ADHD
    "methylphenidate", "dexamfetamine", "lisdexamfetamine", "atomoxetine",
    "guanfacine", "modafinil",
    # Other
    "naltrexone", "acamprosate", "disulfiram", "buprenorphine", "methadone",
    "melatonin", "prazosin", "propranolol", "benztropine", "biperiden",
    "promethazine", "cyproheptadine", "gabapentin", "pregabalin",
]


def correct_medication_names(text: str) -> str:
    """Fix common Whisper misspellings of medication names."""
    words = text.split()
    corrected = []
    for word in words:
        clean = word.strip('.,;:!?()').lower()
        if len(clean) > 4 and clean not in MEDICATION_NAMES:
            matches = get_close_matches(clean, MEDICATION_NAMES, n=1, cutoff=0.8)
            if matches:
                # Preserve original capitalisation pattern
                replacement = matches[0]
                if word[0].isupper():
                    replacement = replacement.capitalize()
                corrected.append(word.replace(word.strip('.,;:!?()'), replacement))
                continue
        corrected.append(word)
    return ' '.join(corrected)


# ── Energy-Based Speaker Diarization ──────────────────────────────────────────

def simple_diarization(segments: list) -> list:
    """
    Simple energy/pause-based speaker diarization.

    Heuristic: In a clinical encounter, speakers alternate. Longer pauses
    (>1.5s) between segments suggest a speaker change. The clinician tends
    to ask shorter questions; the patient gives longer answers.

    Returns segments with 'speaker' field: 'CLINICIAN' or 'PATIENT'.
    """
    if not segments:
        return segments

    PAUSE_THRESHOLD = 1.5  # seconds — gap suggesting speaker change
    current_speaker = 'CLINICIAN'  # Clinician usually starts

    tagged = []
    for i, seg in enumerate(segments):
        if i > 0:
            gap = seg['start'] - segments[i - 1]['end']
            if gap > PAUSE_THRESHOLD:
                current_speaker = 'PATIENT' if current_speaker == 'CLINICIAN' else 'CLINICIAN'

        tagged.append({
            **seg,
            'speaker': current_speaker,
        })

    return tagged


def format_diarized_transcript(segments: list) -> str:
    """Format diarized segments into a readable transcript with speaker labels."""
    if not segments or 'speaker' not in segments[0]:
        return ' '.join(s.get('text', '') for s in segments)

    lines = []
    current_speaker = None
    current_text = []

    for seg in segments:
        speaker = seg.get('speaker', 'UNKNOWN')
        text = seg.get('text', '').strip()
        if not text:
            continue

        if speaker != current_speaker:
            if current_text:
                lines.append(f"[{current_speaker}]: {' '.join(current_text)}")
            current_speaker = speaker
            current_text = [text]
        else:
            current_text.append(text)

    if current_text:
        lines.append(f"[{current_speaker}]: {' '.join(current_text)}")

    return '\n\n'.join(lines)


def get_device():
    """Detect best available device."""
    import torch
    if DEVICE != 'auto':
        return DEVICE
    if torch.cuda.is_available():
        return 'cuda'
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return 'cpu'  # Whisper has issues with MPS, use CPU for stability
    return 'cpu'


def _compute_weights_digest(model_name):
    """
    BUG-424 — compute SHA-256 of the loaded Whisper weights file.

    Whisper weights are downloaded into the torch cache on first use
    (~/.cache/whisper/<MODEL>.pt by default). The on-disk file is the
    forensic identity of the running model — env-var pinning alone is
    aspirational because operators can re-download the same tag onto
    different machines and get different bytes.

    Returns the hex-encoded SHA-256 of the .pt file, or None if the
    cache file cannot be located. None is the explicit "unknown" signal;
    /health/inference handlers turn it into the `<name>@unknown`
    sentinel that the audit helper writes when /health is unreachable.

    Computed once at load_whisper() and cached in MODEL_DIGEST. Reading
    the .pt file is ~1.6GB on first call but happens during model load
    anyway, so no extra IO budget; subsequent /health calls are O(1).
    """
    try:
        import whisper as _whisper
        cache_dir = os.environ.get('WHISPER_CACHE_DIR') or os.path.join(
            os.path.expanduser('~'), '.cache', 'whisper')
        # Whisper saves weights as <model_name>.pt (with _MODELS dict
        # keying the canonical name). Walk the cache dir for any
        # filename matching the loaded model.
        candidates = [
            os.path.join(cache_dir, f'{model_name}.pt'),
            os.path.join(cache_dir, model_name, 'model.pt'),
        ]
        # Whisper's _MODELS dict maps tag → URL with a digest in path.
        # If we can introspect it we use the canonical filename.
        models_dict = getattr(_whisper, '_MODELS', None)
        if isinstance(models_dict, dict) and model_name in models_dict:
            url = models_dict[model_name]
            if isinstance(url, str):
                fname = os.path.basename(url)
                candidates.insert(0, os.path.join(cache_dir, fname))
        for p in candidates:
            if os.path.isfile(p):
                h = hashlib.sha256()
                with open(p, 'rb') as f:
                    for chunk in iter(lambda: f.read(1 << 20), b''):
                        h.update(chunk)
                return h.hexdigest()
        log.warning(f"weights digest: cache file not found in candidates for {model_name}")
        return None
    except Exception as e:
        log.warning(f"weights digest computation failed: {e}")
        return None


def load_whisper():
    """Load the Whisper model."""
    global WHISPER_MODEL, MODEL_DIGEST
    if WHISPER_MODEL is not None:
        return WHISPER_MODEL

    import whisper

    device = get_device()
    log.info(f"Loading Whisper {MODEL_NAME} on {device}...")
    start = time.time()

    WHISPER_MODEL = whisper.load_model(MODEL_NAME, device=device)

    elapsed = time.time() - start
    log.info(f"Whisper {MODEL_NAME} loaded in {elapsed:.1f}s on {device}")

    # BUG-424 — compute weights digest ONCE post-load. /health and every
    # /inference response surface `model_version` from this digest so the
    # llm_interactions audit row records the bytes that produced the
    # transcript, not just the aspirational tag.
    MODEL_DIGEST = _compute_weights_digest(MODEL_NAME)
    if MODEL_DIGEST:
        log.info(f"weights digest: {MODEL_NAME}@sha256:{MODEL_DIGEST[:12]}...")
    else:
        log.warning(f"weights digest unknown for {MODEL_NAME} — /health will report `@unknown` sentinel")

    return WHISPER_MODEL


def _model_version_string():
    """
    BUG-424 — canonical `<name>@sha256:<digest>` audit identity. Returns
    `<name>@unknown` when the weights digest could not be computed
    (cache file moved, IO error). The TS audit helper accepts both
    shapes per WHISPER_MODEL_VERSION_PATTERN — `@unknown` is the
    explicit graceful-degradation sentinel rather than an empty string.
    """
    if MODEL_DIGEST:
        return f'{MODEL_NAME}@sha256:{MODEL_DIGEST}'
    return f'{MODEL_NAME}@unknown'


@app.route('/inference', methods=['POST'])
def transcribe():
    """
    Transcribe audio with clinical vocabulary boosting and speaker diarization.

    Accepts multipart/form-data with:
    - file: audio file (webm, wav, mp3, m4a, ogg, flac)
    - language: (optional) 'en' default
    - response_format: 'text' | 'json' | 'verbose_json' | 'diarized'
    - task: 'transcribe' | 'translate'
    - diarize: 'true' to enable speaker diarization (default: true)
    - clinical_vocab: 'true' to enable clinical vocabulary boosting (default: true)
    """
    if 'file' not in request.files:
        return jsonify({'error': 'No audio file provided. Send as multipart form with field "file".'}), 400

    audio_file = request.files['file']
    language = request.form.get('language', 'en')
    response_format = request.form.get('response_format', 'json')
    task = request.form.get('task', 'transcribe')
    do_diarize = request.form.get('diarize', 'true').lower() == 'true'
    use_clinical_vocab = request.form.get('clinical_vocab', 'true').lower() == 'true'

    # Save to temp file
    suffix = Path(audio_file.filename or 'audio.webm').suffix or '.webm'
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        audio_file.save(tmp)
        tmp_path = tmp.name

    try:
        model = load_whisper()
        start = time.time()
        file_size = os.path.getsize(tmp_path)

        log.info(f"Transcribing {suffix} ({file_size} bytes) diarize={do_diarize} clinical_vocab={use_clinical_vocab}")

        # Build transcription options
        transcribe_opts = {
            'language': language,
            'task': task,
            'fp16': False,
            'verbose': False,
        }

        # Clinical vocabulary boosting via initial_prompt
        if use_clinical_vocab:
            transcribe_opts['initial_prompt'] = CLINICAL_VOCAB_PROMPT

        result = model.transcribe(tmp_path, **transcribe_opts)

        elapsed = time.time() - start
        raw_text = result.get('text', '').strip()
        segments = result.get('segments', [])

        # Post-process: correct medication spelling
        corrected_text = correct_medication_names(raw_text)

        # Speaker diarization
        diarized_segments = []
        diarized_text = corrected_text
        if do_diarize and segments:
            diarized_segments = simple_diarization(segments)
            # Correct medication names in each segment
            for seg in diarized_segments:
                seg['text'] = correct_medication_names(seg.get('text', ''))
            diarized_text = format_diarized_transcript(diarized_segments)

        log.info(f"Transcribed {len(corrected_text)} chars in {elapsed:.1f}s "
                 f"({len(segments)} segments, {len(diarized_segments)} diarized)")

        if response_format == 'text':
            return diarized_text if do_diarize else corrected_text, 200, {'Content-Type': 'text/plain'}

        if response_format == 'diarized':
            return jsonify({
                'text': corrected_text,
                'diarized_text': diarized_text,
                'segments': [{
                    'id': s.get('id', i),
                    'start': round(s['start'], 2),
                    'end': round(s['end'], 2),
                    'text': s['text'].strip(),
                    'speaker': s.get('speaker', 'UNKNOWN'),
                    'confidence': round(s.get('avg_logprob', 0), 3),
                } for i, s in enumerate(diarized_segments or segments)],
                'language': result.get('language', language),
                'duration_seconds': round(segments[-1]['end'], 1) if segments else 0,
                'transcription_time_seconds': round(elapsed, 1),
                'model': MODEL_NAME,
                # BUG-424 — forensic identity for the loaded weights.
                'model_version': _model_version_string(),
                'clinical_vocab_enabled': use_clinical_vocab,
                'diarization_enabled': do_diarize,
            })

        if response_format == 'verbose_json':
            return jsonify({
                'text': corrected_text,
                'diarized_text': diarized_text if do_diarize else None,
                'segments': [{
                    'id': s.get('id', i),
                    'start': round(s['start'], 2),
                    'end': round(s['end'], 2),
                    'text': s['text'].strip(),
                    'speaker': s.get('speaker'),
                    'confidence': round(s.get('avg_logprob', 0), 3),
                    'no_speech_prob': round(s.get('no_speech_prob', 0), 3),
                } for i, s in enumerate(diarized_segments if do_diarize else segments)],
                'language': result.get('language', language),
                'duration_seconds': round(segments[-1]['end'], 1) if segments else 0,
                'transcription_time_seconds': round(elapsed, 1),
                'model': MODEL_NAME,
                # BUG-424 — forensic identity for the loaded weights.
                'model_version': _model_version_string(),
                'clinical_vocab_enabled': use_clinical_vocab,
                'diarization_enabled': do_diarize,
            })

        # Default: json
        return jsonify({
            'text': corrected_text,
            'diarized_text': diarized_text if do_diarize else None,
            'language': result.get('language', language),
            'duration_seconds': round(segments[-1]['end'], 1) if segments else 0,
            'transcription_time_seconds': round(elapsed, 1),
            'model': MODEL_NAME,
            # BUG-424 — forensic identity for the loaded weights.
            'model_version': _model_version_string(),
        })

    except Exception as e:
        log.error(f"Transcription error: {e}")
        return jsonify({'error': str(e)}), 500

    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass


@app.route('/health', methods=['GET'])
def health():
    """Health check."""
    import torch
    return jsonify({
        'status': 'ok',
        'model': MODEL_NAME,
        # BUG-424 — forensic identity surfaced for the TS audit helper.
        # Format: `<name>@sha256:<64hex>` once weights are loaded;
        # `<name>@unknown` until first load_whisper() call OR if the
        # weights file cache lookup failed. The TS helper accepts both
        # shapes per WHISPER_MODEL_VERSION_PATTERN; @unknown is the
        # explicit graceful-degradation sentinel.
        'model_version': _model_version_string(),
        'loaded': WHISPER_MODEL is not None,
        'device': get_device(),
        'gpu_available': torch.cuda.is_available(),
        'mps_available': hasattr(torch.backends, 'mps') and torch.backends.mps.is_available(),
    })


@app.route('/models', methods=['GET'])
def models():
    """List available whisper models."""
    return jsonify({
        'current': MODEL_NAME,
        'available': [
            {'name': 'tiny', 'params': '39M', 'vram': '~1GB', 'speed': '~10x'},
            {'name': 'base', 'params': '74M', 'vram': '~1GB', 'speed': '~7x'},
            {'name': 'small', 'params': '244M', 'vram': '~2GB', 'speed': '~4x'},
            {'name': 'medium', 'params': '769M', 'vram': '~5GB', 'speed': '~2x'},
            {'name': 'large-v3', 'params': '1550M', 'vram': '~10GB', 'speed': '1x'},
            {'name': 'large-v3-turbo', 'params': '809M', 'vram': '~6GB', 'speed': '~3x (recommended)'},
        ],
    })


if os.environ.get('WHISPER_PRELOAD_MODEL', 'false').lower() in {'1', 'true', 'yes'}:
    try:
        load_whisper()
    except Exception as e:
        log.warning(f"Model pre-load failed during WSGI import (will retry on first request): {e}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Signacare EMR Whisper Transcription Server')
    parser.add_argument('--port', type=int, default=8080, help='Port (default: 8080)')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host (default: 127.0.0.1)')
    parser.add_argument('--device', type=str, default='auto', choices=['auto', 'cpu', 'cuda', 'mps'])
    parser.add_argument('--model', type=str, default='large-v3-turbo',
                       choices=['tiny', 'base', 'small', 'medium', 'large-v3', 'large-v3-turbo'])
    args = parser.parse_args()

    DEVICE = args.device
    MODEL_NAME = args.model

    log.info(f"Starting Whisper server ({MODEL_NAME}) on {args.host}:{args.port}")

    # Pre-load model
    try:
        load_whisper()
    except Exception as e:
        log.warning(f"Model pre-load failed (will retry on first request): {e}")

    app.run(host=args.host, port=args.port, debug=False)
