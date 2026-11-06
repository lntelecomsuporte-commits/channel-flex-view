# Roku monitoring

- [x] Reject ended heartbeat sessions so clients recreate a visible active session.
- [x] Add ended-session recovery regression tests and provide production diagnostics for the continuing Roku report.
- [x] Normalize heartbeat identity and expose safe response diagnostics.
- [x] Retry failed session starts and send the current channel immediately, retaining asynchronous tasks.
- [x] Run Roku regression tests and document deployment and real-device verification.
- [ ] Confirm presence in production Monitoramento after ZIP installation (blocked: requires the user's Roku and self-hosted server).