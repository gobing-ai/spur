# 1311 migration ownership

schemaVersion: 1
candidate: 0037-dimension-marts
status: go
sourceRevision: da6484006e41fbe7ed02d16792733acf223f8c65
command: `rm -f docs/reports/1311-migration-ownership.json docs/reports/1311-migration-ownership.md && cd packages/domain && bun test tests/dao/migration-ownership.test.ts`
fixtureSeed: 1311-offline-upgrade-v1
measuredAt: 2026-11-06T08:19:21.436Z

## Reason

0037 tracked SQL matches the embedded constant after comment and whitespace normalization, and the applied schema matches. Released SQL bytes were not rewritten. Fresh, previous-release, already-applied, interrupted, duplicate-column, and absent-column fixtures kept the current guards. The bundled CLI migrated a directory with no drizzle folder and no repository source. Audit SHA-256 values are evidence only; the runtime journal stores id and applied_at, not checksums. Other SQL mirrors are inventoried and not proposed. No package dependency changed. 1312 may consume this artifact; this task does not generate SQL.

Audit hashes are not runtime journal fields. `__spur_cli_migrations` stores `id` and `applied_at` only.

## Source digests

- `packages/domain/src/migrations.ts`: `e5e4353227193ba3cc084a5ab0f944998df305dac33197f0e585ab72302c153b`
- `drizzle/0037_spur_cli_history_dimension_marts.sql`: `bbbd92640d24a8f3f5ee1f19d22ed1846eaa6da750f86d676d76e8e61fcee0c4`
- `apps/cli/spur.js`: `639301ece63693159f835d4fd91497964d24bbd0b8214988cf6b24c45fa75239`
- `package.json`: `b2b8b1b5f82c8bcd651ea7227951e396692262eb04dab7fb8d4b5b7f7dfe7f7d`
- `bun.lock`: `0f3535d802331666993432e41b1729c7cbe68c6d749cb42468464cc7335fa56b`
- `packages/domain/package.json`: `6c358c14b50ec76ef927f5a75e49a589c696ba0372f035938cfed9c77e18471a`
- `packages/app/package.json`: `ab7bf0c6f7e2129922f1333460159a6a54a35b99e80668d6a1ee7bf2cc41e3d4`
- `apps/cli/package.json`: `1147ed718f56e3d42d570a937120cebc212e94d1a1b7925f19f4d7bef42997f2`
- `drizzle/0000_spur_cli_foundation.sql`: `a6428671b1929f29f43fe9a1a2e0dd7914c1dfa6a68a1eaa71ad1a8b75981410`
- `drizzle/0001_spur_cli_team_inbox.sql`: `95f5d1a7a674a8793db8bab6a87fc1ce999f43b7772e791af2d0a4555d2debba`
- `drizzle/0002_spur_cli_rule_history.sql`: `aaa5e4dee72a3a320e5464030ca6912729b89b50fdac1581d429f7cbce136e03`
- `drizzle/0003_spur_cli_planning.sql`: `9707e3c35ef629e85c80e6ed93bbace8f0cc4123b0ab9a48e777c4924755cc8a`
- `drizzle/0005_spur_cli_run_pid.sql`: `2c0092895982e0061878fb32072b73703ab87ff853586ee7e7f59f6b48d53f42`
- `drizzle/0006_spur_cli_system_events.sql`: `dcb2176274aca8290867b2ea9016f0c848c061ff441e2c921f7f4052616a4acb`
- `drizzle/0007_spur_cli_runs_external_key.sql`: `9308657ac9e166e9726c8e285fc8b3e6c667d3852cf899bf82165bf270939dee`
- `drizzle/0008_spur_cli_system_events_correlation.sql`: `7a203a7c8efa4a05433c82e9e82de8be3360690cc46e8bbe97e5f43560ca1750`
- `drizzle/0009_spur_cli_history_message_run_idx.sql`: `976b6843bf4a8889245820393e435bf5e79c4fb86705384b52225446596576cd`
- `drizzle/0011_spur_cli_system_events_sequence_idx.sql`: `e6a4415b7a338d55822bc2d9fcb79b550b28d9f804737e840fa251c4c6e82cc5`
- `drizzle/0014_spur_cli_system_events_name_occurred_idx.sql`: `60a17df8d3f815dc5222653cbc50e198090390fb5024b0c663eba748e25f7579`
- `drizzle/0020_spur_cli_history_board_query_indexes.sql`: `9c3cac800ba7c9cb3ceaa55a2caa3e7e98e73e845bf38eb9c85faf8e25059bf1`
- `drizzle/0021_spur_cli_history_board_rollups.sql`: `7d220eae3c62d04da507fc3fbfff51d295758fd6a05085261f2908727258727c`
- `drizzle/0022_spur_cli_history_performance_indexes.sql`: `7c4bf2e248815064aab35c7251636051657efb67a9d3e5007af3faa28ba91946`
- `drizzle/0024_spur_cli_history_checkpoint_identity.sql`: `80628f22667aef5a6e4e4816546ae1d83b9cf80563cd7b81f6f2a8db51814d99`
- `drizzle/0025_spur_cli_history_checkpoint_identity_mtime.sql`: `e64ac3e119ad7c28d1f74ce3872e33c5d859cbb98405d8b8d3081dc36e955308`
- `drizzle/0026_spur_cli_history_message_duration_source.sql`: `367081abdc3cc6b47fb29b6b7436fd8df68344e84d6cfe361e9417b2a18583c8`
- `drizzle/0027_spur_cli_history_refresh_active_unique.sql`: `3dd641419719a7d0ed3febafdf8807ec6dbd877555d9ad9f6531c703b7ec074f`
- `drizzle/0028_spur_cli_history_task_session.sql`: `fb7a3e6e5e8016c911c06e3d846f25eba25288106b60633da56004765d98d2e8`
- `drizzle/0029_spur_cli_history_tool_call_indexes.sql`: `69d8f6d22f31e4369d2832727e0a83d1282a005e4b1390daad12bfedfcd7384a`
- `drizzle/0030_spur_cli_history_board_covering_indexes.sql`: `94cc4a1fe5dafa2bf38cb29253e13b938936deb9b403449c4cbe1e5af1fe8a1b`
- `drizzle/0031_spur_cli_history_board_tool_stats_columns.sql`: `26195b17d5d4b4dbe6c718ace1779ddb8cdd82b87b2f5e6ebcc1d26e1bd00c3d`
- `drizzle/0033_spur_cli_importer_schema_version.sql`: `c83d4a25fb1d67c28ea8877663c96a04aa5d9d41470bfc554fc8a85db45dd422`
- `drizzle/0034_spur_cli_history_tool_identity.sql`: `f70d2ca3f6626f756e561d271b78d648a9983d667b9553316d682d0a73cb3a22`
- `drizzle/0035_spur_cli_history_measure_vector.sql`: `308cfd858487240c83649bd622583c7b84aa3a0e26ef24ea8c12375e0c5cfdfd`
- `drizzle/0036_spur_cli_history_rollup_watermark.sql`: `a031ebfcc341292afe08daae30af3c709ca592e72d8f37973ce1af9e103cc92c`
- `drizzle/0038_spur_cli_retention_compaction_meta.sql`: `92f48090de1d6c154a6f88c1d5571ed9fe64154b2f7649ff84f70af9d6e05121`
- `drizzle/0039_spur_cli_bounded_rollup_derivations.sql`: `317f5d565f1e8cc76847a87f1653a5e89e5c6ce1f3a1f180b48213f15d40e0f9`
- `drizzle/0040_spur_cli_agent_executor_updates.sql`: `b24dca5df3f24efefce7039410a5e63342827126ed1ab83bcc90ec5dcef0ce91`
- `drizzle/0041_spur_cli_queue_jobs_deadline_lease_columns.sql`: `859c3284782112d2a8da469812d3c74255b035c26961cb654ce93360f3ed9a6c`
- `drizzle/0042_spur_cli_history_model_fallback_index.sql`: `8bdea0193de6896ffcc5f289bb899e80a14116a6d78801ea47dbbd9b867213bf`
- `drizzle/0043_spur_cli_inbox_messages_request_key.sql`: `a053cf6f3f461dc154a516b271509379aa5416fe3be16f5f00961267028f1454`
- `drizzle/0044_spur_cli_coordination_runs_receipt_columns.sql`: `f015199ebc8d7f0cccf9e1c8bdd0c9a0ed78dfc506bf1fbc397eefc66181451a`
- `drizzle/0045_spur_cli_project_claims.sql`: `b6ff47463ce02711f714e88e71e3dc5868849d3a6c13e35cbad746ce23d98193`
- `drizzle/0046_spur_cli_project_strategy.sql`: `ab29e4e5ff14ad26326b4bdf2e632595330dea7e5bf1a218981f5dad50fc998a`
- `drizzle/0047_spur_cli_scheduler_custom_active_unique.sql`: `2d7b4532db2fe52e52b18bcf5c6f98865383baa28e8345bac0b2c634077d89c0`
- `drizzle/0048_spur_cli_agent_executor_updates_owner_columns.sql`: `6d0f78c30a80cce1c6470595a65329229728896270c44dd9b1376f0562019638`
- `drizzle/0049_spur_cli_runs_terminal_reason.sql`: `7e37409eee95ada438869a70fd539d5f8ce1fe375c2319e9649b80b6fd35a610`
- `drizzle/0051_spur_cli_coordination_runs_parent.sql`: `534bcec1f602dd829f62eab12414e5936c1966800ab64b13b7788cf4feb86ffd`
- `drizzle/0052_spur_cli_decision_logs.sql`: `9ddaff97af8c3e3e865f024f2beea4934888711a42c94c4a8cfd022cbf8b8bc1`
- `drizzle/0053_spur_cli_inbox_messages_read_at.sql`: `cba657e28c77f6c2de25df3b35b1db55a2869f5e0424b8aae3dadb5e97aeb681`
- `drizzle/0054_spur_cli_inbox_messages_rebuild.sql`: `371f8a9cc77b17d74087d4a61859ca537f16c68ad338204e357fa20ede8d3932`

## Identifiers

Count: 55. First: 0000_spur_cli_foundation. Last: 0054_spur_cli_inbox_messages_rebuild. Contiguous 0000..0054: true.

| guard id | table | column |
| --- | --- | --- |
| 0005_spur_cli_run_pid | runs | pid |
| 0007_spur_cli_runs_external_key | runs | external_key |
| 0008_spur_cli_system_events_correlation | system_events | sequence |
| 0012_spur_cli_history_tool_call_args_raw | history_tool_call | args_raw |
| 0015_spur_cli_history_tool_call_call_id | history_tool_call | call_id |
| 0018_spur_cli_history_message_request_id | history_message | request_id |
| 0024_spur_cli_history_checkpoint_identity | history_import_checkpoint | source_size |
| 0025_spur_cli_history_checkpoint_identity_mtime | history_import_checkpoint | source_mtime_ms |
| 0026_spur_cli_history_message_duration_source | history_message | duration_source |
| 0039_spur_cli_bounded_rollup_derivations | history_board_source_daily | raw_messages |
| 0041_spur_cli_queue_jobs_deadline_lease_columns | queue_jobs | timeout_ms |
| 0043_spur_cli_inbox_messages_request_key | inbox_messages | request_key |
| 0044_spur_cli_coordination_runs_receipt_columns | coordination_runs | message_ids_json |
| 0048_spur_cli_agent_executor_updates_owner_columns | agent_executor_updates | owner |
| 0049_spur_cli_runs_terminal_reason | runs | terminal_reason |
| 0051_spur_cli_coordination_runs_parent | coordination_runs | parent_run_id |
| 0053_spur_cli_inbox_messages_read_at | inbox_messages | read_at |

## 0037 hashes

- embedded: `34d7b3fb231cb9064be0bff18efccbebadfbe98e8e74895fb92ccb6c97db689f`
- tracked file: `bbbd92640d24a8f3f5ee1f19d22ed1846eaa6da750f86d676d76e8e61fcee0c4`
- normalized embedded: `2498116d0c0b09175ce4090e0ef0bb4c7fb93c82e49a2e28da9236d6aa541ab9`
- normalized tracked: `2498116d0c0b09175ce4090e0ef0bb4c7fb93c82e49a2e28da9236d6aa541ab9`

Normalized equal: true. Schema equal: true. Method: sql-comment-and-whitespace.

## Fixtures

| id | pass | detail |
| --- | --- | --- |
| fresh | true | applied 55; journal columns id,applied_at; nullable measures true |
| already-applied | true | second apply returned 0 |
| previous-release | true | upgrade from 0036 applied 18 |
| interrupted | true | 0037 SQL applied before its journal row; resume applied 18 |
| duplicate-column | true | 0007 journals when external_key is already present |
| absent-column | true | 0007 adds external_key when the column is absent |

## Offline proof

Bundle `apps/cli/spur.js` digest `639301ece63693159f835d4fd91497964d24bbd0b8214988cf6b24c45fa75239`.
Exit 0. Reported applied 0.
Temporary directory had drizzle: false. Had repository source: false.
Journal columns: id, applied_at.
Embedded ids present: 55. Importer ledger present: true.

## Other mirrors

Tracked files: 43. Disposition: inventory-only; no other mirror is proposed in this slice.
Embedded ids with no tracked file: 0004_spur_cli_queue_jobs, 0010_spur_cli_coordination_runs, 0012_spur_cli_history_tool_call_args_raw, 0013_spur_cli_history_run_session, 0015_spur_cli_history_tool_call_call_id, 0016_spur_cli_history_message_ts_nullable, 0017_spur_cli_runs_status_completed_to_done, 0018_spur_cli_history_message_request_id, 0019_spur_cli_history_etl_tables_drop, 0023_spur_cli_history_message_request_id_idx, 0032_spur_cli_history_board_skill_5m, 0050_spur_cli_history_board_skill_5m_capability_grain.
Normalized mismatches: 0000_spur_cli_foundation, 0003_spur_cli_planning, 0006_spur_cli_system_events, 0021_spur_cli_history_board_rollups, 0024_spur_cli_history_checkpoint_identity, 0025_spur_cli_history_checkpoint_identity_mtime, 0026_spur_cli_history_message_duration_source, 0028_spur_cli_history_task_session, 0033_spur_cli_importer_schema_version, 0040_spur_cli_agent_executor_updates.

## Provenance

bun 1.4.3; sqlite 3.54.0; domain 0.4.25; cli 0.4.25.

## Decision

1312 may consume this artifact after review.
