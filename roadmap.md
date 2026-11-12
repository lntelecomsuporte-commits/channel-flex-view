# Roku

- [x] Confirm presence and device activation in production Monitoramento.
- [x] Make remote signout recognize Roku response keys and immediately leave playback.
- [x] Add remote-signout regression tests.
- [x] Replace deprecated `InitClientCertificates()` in this Roku package update.
- [ ] Verify remote signout on the user's Roku after ZIP installation (blocked: requires the physical device).

# Admin app commands

- [x] Use the panel's self-hosted session for remote commands and reject unauthenticated sends.
- [x] Run regression tests for individual/global commands and missing sessions (15 tests passed including monitoring regressions).

# Bulk channel source switching

- [x] Add an atomic, permission-checked database operation for backup inversion and origin replacement.
- [x] Add the channel-source dialog with live preview, missing-backup warnings and optional app reload.
- [x] Run focused regression tests and check the deployed-panel build (46 tests passed; simulated panel flow verified).
- [ ] Verify the real switch on the self-hosted server (blocked until the user runs the migration and deploy commands).
