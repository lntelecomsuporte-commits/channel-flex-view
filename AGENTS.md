# Architecture rules

- Keep manual-only monitoring query options scoped to the admin Monitoramento view; explicitly refetch all four queries together so player heartbeats and other admin screens retain their own update behavior.
- Keep monitoring queries bounded to the live snapshot windows (90s for app heartbeats, 6h for heartbeat-less M3U sessions reused per device until the next tune), including IP enrichment and traffic summaries; never load multi-day statistics or paginate historical sessions in the real-time view.
- External playlist requests (`pt` + `ch`, without `st`) resolve through the existing hls-proxy URL and return uncached redirects after account/channel validation; signed browser requests remain proxied to preserve URL protection and installed playlist compatibility.
- Keep hls-proxy routing self-contained in its entrypoint because self-hosted deployment copies that file individually.
- Admin capabilities are permission keys checked by `has_admin_permission` in the database and by manage-users per action; the panel only hides UI, so new sensitive actions need a key enforced server-side too.
- Roku login uses the normalized full GetChannelClientId with the existing device endpoints; only the active login scene persists successful sessions, so stopped background activation tasks cannot overwrite a manual login.
- Roku heartbeats reuse login device identity and retain one asynchronous Task at a time; failed starts retry on the timer and queued channel changes flush after success to keep monitoring accurate without overlapping requests.
- Roku remote signout accepts response keys regardless of case and removes playback immediately before showing the login screen, so revoked sessions cannot keep video running behind a confirmation dialog.
- Session heartbeats must reject ended sessions with 404 so clients recreate active presence instead of refreshing rows excluded from monitoring.
- session-heartbeat reads body fields ignoring case and underscores because Roku BrightScript lowercases associative-array keys.
- Remote app commands (reload_channels/force_close) are rows in app_commands delivered once per session via the session-heartbeat response, tracked by user_sessions.last_command_at; insert RLS enforces the per-command admin permission keys.
