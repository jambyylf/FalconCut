# FalconCut: bash скрипттеріне арналған аударма функциялары.
# Қолданылуы: SCRIPT_DIR анықталғаннан кейін `source "$SCRIPT_DIR/i18n.sh"`, содан соң
#   t <кілт> [арг...]   → locales/<тіл>.json ішіндегі мәтін, {0}, {1} орындары толтырылады
#
# Мәтіндер бір рет node арқылы жүктеледі. Node жоқ болса, t кілттің өзін қайтарады,
# сондықтан node-ды тексеретін хабарлама скрипттің өзінде екі тілде жазылған.

FALCONCUT_I18N_READY=false
if command -v node >/dev/null 2>&1; then
  if FALCONCUT_I18N_EXPORT="$(node "$SCRIPT_DIR/i18n.cjs" --export-sh 2>/dev/null)"; then
    eval "$FALCONCUT_I18N_EXPORT"
    FALCONCUT_I18N_READY=true
  fi
  unset FALCONCUT_I18N_EXPORT
fi

t() {
  local key="$1"
  shift
  local var="FCL_${key//./__}"
  local text="${!var:-$key}"
  # {0}, {1} ... орындарын кезекпен толтыру. Мәтінге қойылған аргумент қайта
  # қаралмайды, сондықтан жолдың ішіндегі таңбалар ештеңені бұзбайды.
  local index=0 arg placeholder out
  for arg in "$@"; do
    placeholder="{$index}"
    out=""
    while [[ "$text" == *"$placeholder"* ]]; do
      out="$out${text%%"$placeholder"*}$arg"
      text="${text#*"$placeholder"}"
    done
    text="$out$text"
    index=$((index + 1))
  done
  printf '%s' "$text"
}
