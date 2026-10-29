# Architecture rules

- External playlist requests (`pt` + `ch`, without `st`) resolve through the existing hls-proxy URL and return uncached redirects after account/channel validation; signed browser requests remain proxied to preserve URL protection and installed playlist compatibility.
- Keep hls-proxy routing self-contained in its entrypoint because self-hosted deployment copies that file individually.