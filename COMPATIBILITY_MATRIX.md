# Compatibility Matrix

This table lists tested and supported combinations of MOVA Agent runtime, MOVA SDK CLI, and schema set (`@leryk1981/mova-spec`). Always align your versions with the latest row.

| mova_agent version | mova-sdk-cli version | schema-set version (@leryk1981/mova-spec) | Notes |
| --- | --- | --- | --- |
| 0.1.1 | 0.1.1 | 4.1.1 | Current stable set; used by CI and published CLI |

## Compatibility rules
- Patch (x.y.Z): bug fixes only; no breaking schema or CLI changes expected.
- Minor (x.Y.0): additive features; backward compatible with previous minor unless stated; update matrix row on release.
- Major (X.0.0): may introduce breaking changes; add a new row and document migration steps in `Notes`.
- Schema updates: bump `schema-set` when envelopes or ds schemas change; ensure both Agent and CLI are validated against the new schemas before updating the matrix.

### Release checklist
1) Bump versions in `package.json` (Agent), `sdk-cli/package.json` (CLI), and `@leryk1981/mova-spec` dependency.  
2) Update the top row of this matrix.  
3) Run `npm run verify:compat` (added to CI).  
4) Tag and publish (Agent + CLI).  
