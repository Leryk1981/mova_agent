# ProofKit: OCP Evidence Hygiene v0

Минимальный набор для проверки, что секреты не попадают в артефакты доказательств (doctor, smoke, delivery, quality). Включает redaction-фильтр, secret scan и neg-кейс с явными секретами.

## Что проверяем
- Любые ключи token/secret/key/auth/password/authorization маскируются.
- URL-параметры скрываются (оставляем путь/хост).
- Доктор, staging smoke, delivery v1 evidence и quality отчёты не содержат секреты.
- Secret scanner подтверждает отсутствие утечек даже при подставленных фейковых секретах.

## Как запускать
- POS: 
pm run quality:ocp_evidence_hygiene
- NEG: 
pm run quality:ocp_evidence_hygiene:neg
- ProofKit: 
pm run proofkit:run -- ocp_evidence_hygiene_v0
