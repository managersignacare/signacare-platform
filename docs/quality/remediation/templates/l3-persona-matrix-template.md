# L3 Persona Matrix Template (Per Module)

## Module
- `module_id`:
- `module_name`:
- `charter_path`:

## Required Personas
- `superadmin`
- `admin`
- `manager`
- `clinician`
- `receptionist`

## Matrix
| Persona | Workflow | Expected UI | Expected API | Negative-path check | Result |
|---|---|---|---|---|---|
| superadmin | | allow/deny + surface | 2xx/4xx expectation | explicit deny case | pass/fail |
| admin | | allow/deny + surface | 2xx/4xx expectation | explicit deny case | pass/fail |
| manager | | allow/deny + surface | 2xx/4xx expectation | explicit deny case | pass/fail |
| clinician | | allow/deny + surface | 2xx/4xx expectation | explicit deny case | pass/fail |
| receptionist | | allow/deny + surface | 2xx/4xx expectation | explicit deny case | pass/fail |

## Required Coverage Rules
- At least one allow path and one deny path for every persona.
- Every S0/S1 endpoint in module scope must have at least one deny assertion.
- Any policy mismatch automatically opens/links a BUG row before module closeout.

## Evidence Links
- `playwright_runs`:
- `integration_runs`:
- `screenshots_or_videos`:
- `log_extracts`:
