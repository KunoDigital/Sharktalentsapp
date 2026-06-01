#!/bin/bash
# Genera los 4 audios del test de inglés llamando a ElevenLabs API.
#
# Uso:
#   export ELEVENLABS_API_KEY="tu-key-aqui"
#   ./scripts/generate-english-audios.sh
#
# Conseguir API key:
#   1. https://elevenlabs.io/app/settings/api-keys
#   2. "Create API Key" → copialo
#   3. Plan free: 10K chars/mes. Esta corrida usa ~3K (sobra para 3 retakes).
#
# Output: 4 archivos MP3 en english-listening/ (ignorado por git)
#   - english-listening-a2.mp3 (~30 seg, voz Rachel female)
#   - english-listening-b1.mp3 (~45 seg, voz Adam male)
#   - english-listening-b2.mp3 (~60 seg, voz Rachel female)
#   - english-listening-c1.mp3 (~90 seg, voz Adam male)
#
# Requisitos: curl, jq

set -euo pipefail

if [ -z "${ELEVENLABS_API_KEY:-}" ]; then
  echo "✕ ELEVENLABS_API_KEY no está seteada"
  echo ""
  echo "Conseguí tu key en: https://elevenlabs.io/app/settings/api-keys"
  echo "Después corré:"
  echo "  export ELEVENLABS_API_KEY=\"tu-key-aqui\""
  echo "  ./scripts/generate-english-audios.sh"
  exit 1
fi

if ! command -v jq &> /dev/null; then
  echo "✕ jq no está instalado. Instalá con: brew install jq"
  exit 1
fi

OUTPUT_DIR="english-listening"
mkdir -p "$OUTPUT_DIR"

# American English voices (probadas, suenan natural)
VOICE_RACHEL="21m00Tcm4TlvDq8ikWAM"  # female, conversacional, cálida
VOICE_ADAM="pNInz6obpgDQGcFmaJgB"     # male, profesional, claro

generate_audio() {
  local level="$1"
  local voice_id="$2"
  local script="$3"
  local output_file="$OUTPUT_DIR/english-listening-${level}.mp3"

  echo "▶ Generando ${level} (${#script} chars)..."

  local payload
  payload=$(jq -n \
    --arg text "$script" \
    '{
      text: $text,
      model_id: "eleven_multilingual_v2",
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        use_speaker_boost: true
      }
    }')

  local http_code
  http_code=$(curl -sS -w "%{http_code}" -X POST \
    "https://api.elevenlabs.io/v1/text-to-speech/${voice_id}" \
    -H "xi-api-key: $ELEVENLABS_API_KEY" \
    -H "Content-Type: application/json" \
    -H "Accept: audio/mpeg" \
    -o "$output_file" \
    -d "$payload")

  if [ "$http_code" != "200" ]; then
    echo "  ✕ Error HTTP $http_code"
    cat "$output_file"
    rm -f "$output_file"
    exit 1
  fi

  local size
  size=$(du -h "$output_file" | cut -f1)
  echo "  ✓ $output_file ($size)"
}

A2_SCRIPT="Hi, my name is Maria. I live in a small apartment in the city center. Every morning I wake up at 7 o'clock. I drink a cup of coffee and eat toast for breakfast. I walk to work because my office is very close — only ten minutes from my home. I usually arrive at 8:30. After work I like to go to the park or read at home."

B1_SCRIPT="Last summer I traveled to Mexico for two weeks. It was my first time visiting a country in Latin America. I stayed in three different cities — Mexico City, Oaxaca, and the coast of Yucatán. The food was amazing and the people were incredibly welcoming. I had wanted to learn some Spanish before the trip, so I spent a few months using a language app. It really helped me communicate, especially in smaller towns where fewer people spoke English. By the end of the trip, I was already planning my next visit."

B2_SCRIPT="At a recent team meeting, our manager announced that the company would be moving to a hybrid work model starting next quarter. From now on, everyone will be expected to come to the office at least three days a week, while having the option to work remotely for the other two. The decision generated mixed reactions. Some colleagues argued that being together more often will improve collaboration and team culture, especially for newer employees who are still building their networks. Others, however, expressed concerns about losing the flexibility that has helped them balance work with personal commitments. The leadership team asked for feedback before finalizing the policy, so we have until the end of the month to share our thoughts."

C1_SCRIPT="There has been growing debate about the role of artificial intelligence in the workplace. While some industries have embraced AI as a tool to streamline operations and reduce costs, others remain cautious about the potential consequences for employment. Critics argue that automation could displace millions of jobs, particularly those involving routine tasks, leaving workers without clear pathways to transition into new careers. Supporters, on the other hand, contend that history has consistently shown that technological progress, although disruptive in the short term, ultimately creates new categories of employment that we cannot yet imagine. What seems undeniable is that the nature of work itself is shifting. Roles that emphasize creativity, emotional intelligence, and ethical judgment are increasingly valued, while purely repetitive functions are gradually being delegated to machines. Companies that wish to remain competitive must therefore invest not only in technology but also in continuous learning programs that allow their workforce to adapt. The challenge for governments, meanwhile, is to design policies that protect workers during this transition without stifling innovation. How well societies navigate this balance will likely define economic outcomes for decades to come."

generate_audio "a2" "$VOICE_RACHEL" "$A2_SCRIPT"
generate_audio "b1" "$VOICE_ADAM" "$B1_SCRIPT"
generate_audio "b2" "$VOICE_RACHEL" "$B2_SCRIPT"
generate_audio "c1" "$VOICE_ADAM" "$C1_SCRIPT"

echo ""
echo "✓ 4 audios generados en $OUTPUT_DIR/"
echo ""
echo "Próximo paso:"
echo "  1. Escuchalos para verificar calidad (open $OUTPUT_DIR)"
echo "  2. Subilos a Catalyst Console → File Store → folder 'english-audios'"
echo "  3. Copiá los File IDs y guardalos para wirear el backend"
