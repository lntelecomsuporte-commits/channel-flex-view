# Samsung Tizen

- [x] Allow Samsung pairing in the device endpoints, database and admin panel.
- [x] Enforce restricted-channel PIN with free zapping and cancellation staying on the locked channel.
- [x] Test Samsung PIN and heartbeat handling (30 focused tests; browser remote-key flow passed); provide self-hosted deployment commands.
- [ ] Verify activation and AVPlay on the physical Samsung (blocked: requires updated WGT installation and server deployment).

# Roku

- [x] Confirm presence and device activation in production Monitoramento.
- [x] Make remote signout recognize Roku response keys and immediately leave playback.
- [x] Add remote-signout regression tests.
- [x] Replace deprecated `InitClientCertificates()` in this Roku package update.
- [ ] Verify remote signout on the user's Roku after ZIP installation (blocked: requires the physical device).

# Admin app commands

- [x] Use the panel's self-hosted session for remote commands and reject unauthenticated sends.
- [x] Run regression tests for individual/global commands and missing sessions (15 tests passed including monitoring regressions).

# Device/session revocation without APK update

- [x] Return `force_close` together with remote signout and revoke removed/blocked devices in session-heartbeat.
- [x] Prevent Native/Roku heartbeat self-registration from recreating removed device bindings.
- [x] Add regression tests and verify the panel build (20 focused tests passed; panel build OK).
- [ ] Next Native APK release: handle `forceSignout` during start/heartbeat, clear saved tokens and return to login instead of only closing the process (deferred to avoid an APK release now).

# Bulk channel source switching

- [x] Add an atomic, permission-checked database operation for backup inversion and origin replacement.
- [x] Add the channel-source dialog with live preview, missing-backup warnings and optional app reload.
- [x] Run focused regression tests and check the deployed-panel build (46 tests passed; simulated panel flow verified).
- [ ] Verify the real switch on the self-hosted server (blocked until the user runs the migration and deploy commands).
