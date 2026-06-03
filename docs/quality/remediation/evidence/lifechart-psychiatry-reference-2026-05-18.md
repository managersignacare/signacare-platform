# Psychiatric Lifechart Reference Notes (2026-05-18)

## Purpose
Reference model used to refine Signacare Life Chart toward a disorder-agnostic, editable schema-driven view.

## Evidence Threads
1. **NIMH Life Chart Method (prospective validation)** supports longitudinal tracking of symptom polarity/severity and functional burden over time, with reproducible interval ratings.  
   Source: https://www.cambridge.org/core/journals/psychological-medicine/article/validation-of-the-prospective-nimhlifechart-method-nimhlcmp-for-longitudinal-assessment-of-bipolar-illness/8E493183C61D28841E09B22B51B01C3A

2. **NIMH-LCM in outcome studies** emphasizes multi-year course mapping with episode recurrence, treatment exposure, and inter-episode status as clinically relevant longitudinal layers.  
   Source: https://pubmed.ncbi.nlm.nih.gov/12571426/

3. **Daily lifechart data quality research** highlights inclusion of symptom course plus contextual modifiers (including substance use) as critical for interpretability of longitudinal trajectories.  
   Source: https://pubmed.ncbi.nlm.nih.gov/26403942/

4. **ChronoRecord-style bipolar course tracking** demonstrates practical layering of mood, medications, and life events across time in a patient-editable chronology.  
   Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC2912211/

## Translation Into Signacare Schema
The implemented textual schema uses a single timeline row model with:
- time interval + start/end
- primary symptom state + numeric severity
- medication footprint
- life events + triggers + interventions
- inter-episode functioning
- substance-use pattern
- hospitalization/acute escalation markers

This supports bipolar bidirectional curves and non-bipolar severity trajectories (psychosis/anxiety/other symptom domains) with the same schema contract.
