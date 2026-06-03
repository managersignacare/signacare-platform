#!/bin/bash
# ============================================================
# Signacare EMR — Local LLM Model Setup
# ============================================================
# This script downloads and configures all local AI models.
# Requires: Ollama installed (https://ollama.com)
#
# Usage: ./setup-models.sh [--all | --minimal]
#   --minimal : Only Llama 3.2 (fastest setup, ~4GB)
#   --all     : All models including MentalLLaMA, EmoLLM, MentalBERT (~20GB)
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "============================================"
echo "  Signacare EMR — Local LLM Setup"
echo "============================================"

# Check Ollama is installed
if ! command -v ollama &> /dev/null; then
    echo -e "${RED}Ollama not found.${NC}"
    echo "Install from: https://ollama.com"
    echo "  macOS:  brew install ollama"
    echo "  Linux:  curl -fsSL https://ollama.com/install.sh | sh"
    exit 1
fi

echo -e "${GREEN}Ollama found.${NC}"

# Check Ollama is running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo -e "${YELLOW}Starting Ollama...${NC}"
    ollama serve &
    sleep 3
fi

MODE="${1:---minimal}"

# ── 1. Llama 3.2 (Default — General Clinical) ──
echo ""
echo -e "${GREEN}[1/4] Pulling Llama 3.2 (General Clinical)...${NC}"
ollama pull llama3.2
echo -e "${GREEN}  ✓ llama3.2 ready${NC}"

if [ "$MODE" = "--all" ]; then

    # ── 2. MentalLLaMA ──
    echo ""
    echo -e "${GREEN}[2/4] Setting up MentalLLaMA...${NC}"
    echo -e "${YELLOW}  Note: Full MentalLLaMA requires manual GGUF download from HuggingFace.${NC}"
    echo "  For now, creating from Modelfile with llama3.2 base + MH prompting..."
    # If GGUF weights exist, use them; otherwise create from llama3.2 with MH system prompt
    if [ -f "$SCRIPT_DIR/mentallama-13b-chat.Q4_K_M.gguf" ]; then
        ollama create mentallama -f "$SCRIPT_DIR/Modelfile.mentallama"
    else
        echo "  GGUF not found — creating MentalLLaMA proxy from llama3.2..."
        cat > /tmp/signacare_mentallama_modelfile << 'EOF'
FROM llama3.2
PARAMETER temperature 0.25
SYSTEM """You are MentalLLaMA, a specialised mental health clinical assistant.
You excel at psychiatric formulations, risk assessment, and mental health documentation.
Use Australian mental health terminology. Reference the Mental Health Act 2014 (Vic).
Do not fabricate information. Only summarise and analyse what is provided."""
EOF
        ollama create mentallama -f /tmp/signacare_mentallama_modelfile
    fi
    echo -e "${GREEN}  ✓ mentallama ready${NC}"

    # ── 3. EmoLLM ──
    echo ""
    echo -e "${GREEN}[3/4] Setting up EmoLLM (Emotion-Aware)...${NC}"
    ollama create emollm -f "$SCRIPT_DIR/Modelfile.emollm"
    echo -e "${GREEN}  ✓ emollm ready${NC}"

    # ── 4. MentalBERT (Classification proxy) ──
    echo ""
    echo -e "${GREEN}[4/4] Setting up MentalBERT (Classification)...${NC}"
    ollama pull phi3:mini 2>/dev/null || true
    ollama create mentalbert -f "$SCRIPT_DIR/Modelfile.mentalbert"
    echo -e "${GREEN}  ✓ mentalbert ready${NC}"

else
    echo ""
    echo -e "${YELLOW}Minimal mode — skipping MentalLLaMA, EmoLLM, MentalBERT.${NC}"
    echo "Run with --all to install all models."
fi

echo ""
echo "============================================"
echo -e "${GREEN}  Setup complete!${NC}"
echo ""
echo "  Installed models:"
ollama list
echo ""
echo "  To verify: curl http://localhost:11434/api/tags"
echo "============================================"
