"""
Signacare EMR — Local LLM Fine-Tuning Script

Fine-tunes a base model (Llama 3.2, Qwen 2.5, Mistral) on clinical feedback data
collected from the EMR using QLoRA (Quantized Low-Rank Adaptation).

Requirements:
  pip install unsloth transformers datasets peft trl bitsandbytes

Hardware:
  - Minimum: 8GB VRAM (RTX 3070/4060) for 7B model with QLoRA
  - Recommended: 16GB VRAM (RTX 4080/A4000) for 14B model
  - CPU-only: Possible but very slow (use GGML quantization instead)

Usage:
  1. Export training data from Signacare EMR:
     GET /api/v1/llm/training/export?format=alpaca > training_data.jsonl

  2. Run fine-tuning:
     python train.py --data training_data.jsonl --base llama3.2 --output signacare-clinical

  3. Convert to GGUF for Ollama:
     python -m llama_cpp.convert --outfile signacare-clinical.gguf ./signacare-clinical
     ollama create signacare-clinical -f Modelfile.signacare-clinical

  4. Test in Signacare EMR:
     Select "signacare-clinical" in the AI model dropdown
"""

import argparse
import json
import os

def main():
    parser = argparse.ArgumentParser(description='Fine-tune LLM for Signacare EMR')
    parser.add_argument('--data', required=True, help='Path to training JSONL file')
    parser.add_argument('--base', default='unsloth/llama-3.2-3b-instruct-bnb-4bit', help='Base model (HuggingFace ID or local path)')
    parser.add_argument('--output', default='./signacare-clinical', help='Output directory')
    parser.add_argument('--epochs', type=int, default=3, help='Training epochs')
    parser.add_argument('--lr', type=float, default=2e-4, help='Learning rate')
    parser.add_argument('--batch_size', type=int, default=4, help='Batch size')
    parser.add_argument('--lora_r', type=int, default=16, help='LoRA rank')
    parser.add_argument('--max_seq_len', type=int, default=2048, help='Max sequence length')
    args = parser.parse_args()

    # ── Load Data ──
    print(f"Loading training data from {args.data}...")
    examples = []
    with open(args.data, 'r') as f:
        for line in f:
            if line.strip():
                examples.append(json.loads(line))
    print(f"  Loaded {len(examples)} training examples")

    if len(examples) < 10:
        print("WARNING: Less than 10 examples. Collect more feedback before fine-tuning.")
        print("  Tip: Use the EMR for a few weeks, edit AI outputs, and rate them.")
        return

    # ── Setup Model ──
    try:
        from unsloth import FastLanguageModel
        from trl import SFTTrainer
        from transformers import TrainingArguments
        from datasets import Dataset
    except ImportError:
        print("ERROR: Required packages not installed.")
        print("  pip install unsloth transformers datasets peft trl bitsandbytes")
        return

    print(f"Loading base model: {args.base}...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq_len,
        dtype=None,  # Auto-detect
        load_in_4bit=True,  # QLoRA
    )

    # ── Add LoRA Adapters ──
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_r,
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        lora_alpha=args.lora_r * 2,
        lora_dropout=0.05,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    # ── Format Training Data ──
    ALPACA_TEMPLATE = """Below is an instruction that describes a task, paired with an input that provides further context. Write a response that appropriately completes the request.

### Instruction:
{instruction}

### Input:
{input}

### Response:
{output}"""

    def format_example(example):
        return {
            "text": ALPACA_TEMPLATE.format(
                instruction=example.get("instruction", ""),
                input=example.get("input", ""),
                output=example.get("output", ""),
            )
        }

    dataset = Dataset.from_list([format_example(ex) for ex in examples])
    print(f"  Dataset: {len(dataset)} examples")

    # ── Train ──
    print("Starting fine-tuning...")
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq_len,
        dataset_num_proc=2,
        args=TrainingArguments(
            output_dir=args.output,
            per_device_train_batch_size=args.batch_size,
            gradient_accumulation_steps=4,
            warmup_steps=10,
            num_train_epochs=args.epochs,
            learning_rate=args.lr,
            fp16=True,
            logging_steps=10,
            save_strategy="epoch",
            optim="adamw_8bit",
            seed=42,
        ),
    )

    trainer.train()

    # ── Save ──
    print(f"Saving fine-tuned model to {args.output}...")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)

    # ── Export to GGUF ──
    print("Exporting to GGUF for Ollama...")
    gguf_path = os.path.join(args.output, "signacare-clinical.Q4_K_M.gguf")
    try:
        model.save_pretrained_gguf(args.output, tokenizer, quantization_method="q4_k_m")
        print(f"  GGUF saved: {gguf_path}")
    except Exception as e:
        print(f"  GGUF export failed: {e}")
        print(f"  Manual conversion: python -m llama_cpp.convert --outfile {gguf_path} {args.output}")

    print(f"""
╔══════════════════════════════════════════╗
║  Fine-tuning complete!                    ║
╠══════════════════════════════════════════╣
║  Output:    {args.output:<29}║
║  Examples:  {len(examples):<29}║
║  Epochs:    {args.epochs:<29}║
╠══════════════════════════════════════════╣
║  Next steps:                              ║
║  1. Create Ollama model:                  ║
║     ollama create signacare-clinical \\         ║
║       -f Modelfile.signacare-clinical          ║
║  2. Select in EMR AI model dropdown       ║
╚══════════════════════════════════════════╝
""")

if __name__ == '__main__':
    main()
