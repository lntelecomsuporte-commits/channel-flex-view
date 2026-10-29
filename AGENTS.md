# Architecture rules

- Keep manual-only monitoring query options scoped to the admin Monitoramento view; explicitly refetch all four queries together so player heartbeats and other admin screens retain their own update behavior.
- Keep monitoring queries bounded to the live snapshot windows, including IP enrichment and traffic summaries; never load multi-day statistics or paginate historical sessions in the real-time view.
- External playlist requests (`pt` + `ch`, without `st`) resolve through the existing hls-proxy URL and return uncached redirects after account/channel validation; signed browser requests remain proxied to preserve URL protection and installed playlist compatibility.
- Keep hls-proxy routing self-contained in its entrypoint because self-hosted deployment copies that file individually.