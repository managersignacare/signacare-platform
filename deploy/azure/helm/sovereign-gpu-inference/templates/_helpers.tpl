{{- define "signacare-sovereign-gpu-inference.name" -}}
signacare-sovereign-gpu-inference
{{- end -}}

{{- define "signacare-sovereign-gpu-inference.fullname" -}}
{{- printf "%s" (include "signacare-sovereign-gpu-inference.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "signacare-sovereign-gpu-inference.labels" -}}
app.kubernetes.io/name: {{ include "signacare-sovereign-gpu-inference.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: ai-inference
app.kubernetes.io/part-of: signacare
signacare.io/lane: sovereign-gpu
signacare.io/runtime-engine: {{ .Values.runtime.engine | quote }}
{{- end -}}
