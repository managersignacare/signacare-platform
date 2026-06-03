"""
Signacare EMR — HuggingFace Transformers Inference Server

Serves transformer models locally for the EMR AI pipeline.
Supports: text generation, classification, NER, embeddings.

Usage:
    pip install -r requirements.txt
    python server.py                          # CPU mode
    python server.py --device cuda            # GPU mode
    python server.py --port 8100 --device mps # Apple Silicon GPU

Models are auto-downloaded from HuggingFace Hub on first use.
All inference is local — no PHI leaves the network.
"""

import os
import sys
import json
import time
import logging
import argparse
from pathlib import Path
from typing import Optional

from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Setup ──
logging.basicConfig(level=logging.INFO, format='%(asctime)s [HF-Server] %(message)s')
log = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# Global state
LOADED_MODELS: dict = {}
DEVICE = 'cpu'
MODEL_CACHE_DIR = os.environ.get('HF_HOME', str(Path.home() / '.cache' / 'huggingface'))

# ── Model Loading ──

def get_device():
    """Detect best available device."""
    import torch
    if DEVICE != 'auto':
        return DEVICE
    if torch.cuda.is_available():
        return 'cuda'
    if hasattr(torch.backends, 'mps') and torch.backends.mps.is_available():
        return 'mps'
    return 'cpu'


def load_model(model_name: str, task: str = 'generate'):
    """Load a model from HuggingFace Hub (cached after first download)."""
    cache_key = f"{model_name}:{task}"
    if cache_key in LOADED_MODELS:
        return LOADED_MODELS[cache_key]

    log.info(f"Loading model: {model_name} (task={task}, device={get_device()})...")
    start = time.time()

    import torch
    from transformers import AutoTokenizer

    device = get_device()

    if task in ('classify', 'sentiment'):
        from transformers import AutoModelForSequenceClassification, pipeline
        try:
            pipe = pipeline(
                'text-classification',
                model=model_name,
                device=device if device != 'cpu' else -1,
                top_k=10,
                truncation=True,
                max_length=512,
            )
            LOADED_MODELS[cache_key] = ('pipeline', pipe)
        except Exception as e:
            log.warning(f"Pipeline failed for {model_name}: {e}. Trying direct load...")
            tokenizer = AutoTokenizer.from_pretrained(model_name)
            model = AutoModelForSequenceClassification.from_pretrained(model_name)
            model = model.to(device)
            model.eval()
            LOADED_MODELS[cache_key] = ('model', model, tokenizer)

    elif task == 'ner':
        from transformers import pipeline
        pipe = pipeline(
            'ner',
            model=model_name,
            device=device if device != 'cpu' else -1,
            aggregation_strategy='simple',
        )
        LOADED_MODELS[cache_key] = ('pipeline', pipe)

    elif task == 'embed':
        from transformers import AutoModel
        tokenizer = AutoTokenizer.from_pretrained(model_name)
        model = AutoModel.from_pretrained(model_name)
        model = model.to(device)
        model.eval()
        LOADED_MODELS[cache_key] = ('embedding', model, tokenizer)

    elif task == 'generate':
        from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

        tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)

        # Use 4-bit quantization for large models on limited hardware
        load_kwargs = {
            'trust_remote_code': True,
            'torch_dtype': torch.float16 if device != 'cpu' else torch.float32,
        }

        if device == 'cuda':
            try:
                bnb_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_compute_dtype=torch.float16,
                    bnb_4bit_quant_type='nf4',
                )
                load_kwargs['quantization_config'] = bnb_config
                load_kwargs['device_map'] = 'auto'
            except Exception:
                load_kwargs['device_map'] = 'auto'

        model = AutoModelForCausalLM.from_pretrained(model_name, **load_kwargs)
        if 'device_map' not in load_kwargs:
            model = model.to(device)
        model.eval()

        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token

        LOADED_MODELS[cache_key] = ('causal', model, tokenizer)

    elapsed = time.time() - start
    log.info(f"Model loaded: {model_name} in {elapsed:.1f}s")
    return LOADED_MODELS[cache_key]


# ── Inference Endpoints ──

@app.route('/inference', methods=['POST'])
def inference():
    """Run inference on a loaded model."""
    data = request.json
    model_name = data.get('model', '')
    text = data.get('text', '')
    task = data.get('task', 'generate')
    max_length = data.get('max_length', 512)
    temperature = data.get('temperature', 0.3)
    system_prompt = data.get('system_prompt', '')

    if not model_name or not text:
        return jsonify({'error': 'model and text are required'}), 400

    start = time.time()

    try:
        loaded = load_model(model_name, task)
    except Exception as e:
        return jsonify({'error': f'Failed to load model {model_name}: {str(e)}'}), 500

    try:
        import torch

        if loaded[0] == 'pipeline':
            pipe = loaded[1]
            if task in ('classify', 'sentiment'):
                results = pipe(text[:512])
                labels = [{'label': r['label'], 'score': round(r['score'], 4)} for r in (results[0] if isinstance(results[0], list) else results)]
                return jsonify({
                    'text': labels[0]['label'] if labels else '',
                    'labels': labels,
                    'tokens_used': len(text.split()),
                    'inference_time_ms': int((time.time() - start) * 1000),
                })
            elif task == 'ner':
                results = pipe(text[:512])
                entities = [{
                    'entity': r.get('entity_group', r.get('entity', '')),
                    'word': r.get('word', ''),
                    'score': round(r.get('score', 0), 4),
                    'start': r.get('start', 0),
                    'end': r.get('end', 0),
                } for r in results]
                return jsonify({
                    'text': '',
                    'entities': entities,
                    'tokens_used': len(text.split()),
                    'inference_time_ms': int((time.time() - start) * 1000),
                })

        elif loaded[0] == 'model':
            model, tokenizer = loaded[1], loaded[2]
            inputs = tokenizer(text[:512], return_tensors='pt', truncation=True, max_length=512)
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
            with torch.no_grad():
                outputs = model(**inputs)
            probs = torch.softmax(outputs.logits, dim=-1)[0]
            id2label = model.config.id2label if hasattr(model.config, 'id2label') else {}
            labels = [{'label': id2label.get(i, str(i)), 'score': round(p.item(), 4)} for i, p in enumerate(probs)]
            labels.sort(key=lambda x: x['score'], reverse=True)
            return jsonify({
                'text': labels[0]['label'] if labels else '',
                'labels': labels[:10],
                'tokens_used': inputs['input_ids'].shape[1],
                'inference_time_ms': int((time.time() - start) * 1000),
            })

        elif loaded[0] == 'embedding':
            model, tokenizer = loaded[1], loaded[2]
            inputs = tokenizer(text[:512], return_tensors='pt', truncation=True, max_length=512, padding=True)
            inputs = {k: v.to(model.device) for k, v in inputs.items()}
            with torch.no_grad():
                outputs = model(**inputs)
            # Mean pooling
            embeddings = outputs.last_hidden_state.mean(dim=1)[0].cpu().tolist()
            return jsonify({
                'text': '',
                'embeddings': embeddings,
                'tokens_used': inputs['input_ids'].shape[1],
                'inference_time_ms': int((time.time() - start) * 1000),
            })

        elif loaded[0] == 'causal':
            model, tokenizer = loaded[1], loaded[2]
            prompt = text
            if system_prompt:
                prompt = f"### System:\n{system_prompt}\n\n### User:\n{text}\n\n### Assistant:\n"

            inputs = tokenizer(prompt, return_tensors='pt', truncation=True, max_length=max_length)
            inputs = {k: v.to(model.device) for k, v in inputs.items()}

            with torch.no_grad():
                output_ids = model.generate(
                    **inputs,
                    max_new_tokens=min(max_length, 4096),
                    temperature=max(temperature, 0.01),
                    do_sample=temperature > 0,
                    top_p=0.95,
                    repetition_penalty=1.1,
                    pad_token_id=tokenizer.pad_token_id,
                )

            generated = tokenizer.decode(output_ids[0][inputs['input_ids'].shape[1]:], skip_special_tokens=True)
            return jsonify({
                'text': generated.strip(),
                'generated_text': generated.strip(),
                'tokens_used': output_ids.shape[1],
                'inference_time_ms': int((time.time() - start) * 1000),
            })

        return jsonify({'error': f'Unknown model type: {loaded[0]}'}), 500

    except Exception as e:
        log.error(f"Inference error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/models', methods=['GET'])
def list_models():
    """List downloaded and available models."""
    from huggingface_hub import scan_cache_dir
    try:
        cache_info = scan_cache_dir()
        downloaded = [repo.repo_id for repo in cache_info.repos]
    except Exception:
        downloaded = []

    return jsonify({
        'downloaded': downloaded,
        'loaded': list(LOADED_MODELS.keys()),
        'device': get_device(),
    })


@app.route('/download', methods=['POST'])
def download_model():
    """Download a model from HuggingFace Hub."""
    data = request.json
    model_name = data.get('model', '')
    if not model_name:
        return jsonify({'error': 'model is required'}), 400

    log.info(f"Downloading model: {model_name}...")
    try:
        from huggingface_hub import snapshot_download
        snapshot_download(model_name, cache_dir=MODEL_CACHE_DIR)
        return jsonify({'message': f'Successfully downloaded {model_name}', 'model': model_name})
    except Exception as e:
        return jsonify({'error': f'Download failed: {str(e)}'}), 500


@app.route('/unload', methods=['POST'])
def unload_model():
    """Unload a model from memory."""
    data = request.json
    model_name = data.get('model', '')

    keys_to_remove = [k for k in LOADED_MODELS if model_name in k]
    for k in keys_to_remove:
        del LOADED_MODELS[k]

    import gc
    gc.collect()

    try:
        import torch
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass

    return jsonify({'message': f'Unloaded {len(keys_to_remove)} model(s)', 'unloaded': keys_to_remove})


@app.route('/health', methods=['GET'])
def health():
    """Health check."""
    import torch
    return jsonify({
        'status': 'ok',
        'device': get_device(),
        'gpu_available': torch.cuda.is_available(),
        'mps_available': hasattr(torch.backends, 'mps') and torch.backends.mps.is_available(),
        'models_loaded': len(LOADED_MODELS),
        'cache_dir': MODEL_CACHE_DIR,
    })


# ── Main ──

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Signacare EMR HuggingFace Inference Server')
    parser.add_argument('--port', type=int, default=8100, help='Port to listen on')
    parser.add_argument('--host', type=str, default='127.0.0.1', help='Host to bind to')
    parser.add_argument('--device', type=str, default='auto', choices=['auto', 'cpu', 'cuda', 'mps'],
                       help='Device for inference')
    args = parser.parse_args()

    DEVICE = args.device
    log.info(f"Starting HF Inference Server on {args.host}:{args.port} (device={DEVICE})")
    log.info(f"Model cache: {MODEL_CACHE_DIR}")

    app.run(host=args.host, port=args.port, debug=False)
