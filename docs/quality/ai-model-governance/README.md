# AI Model Governance Evidence

Store reviewed AI model-governance records here for production deploys.
Real model changes use `decision: "promote"`; non-model production releases
use `decision: "no_change"` with identical `fromDeploymentRef` and
`toDeploymentRef`.

Records must satisfy `AiModelPromotionRecordSchema` and pass:

```bash
npm run ai:model-promotion:validate -- --alias <alias> --record docs/quality/ai-model-governance/<record>.json
```

Do not add placeholder JSON. Each record must point to a real shadow-run
evidence bundle in this directory and include its SHA-256. The validator
recomputes aggregate quality from that bundle before accepting the record.
Each record must also point to adapter compatibility evidence, approval
identity, rollback plan, and the exact baseline/candidate deployment
references. For `decision: "no_change"`, the baseline and candidate references
must be identical all the way down to the per-run metrics.
