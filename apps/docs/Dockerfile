# The docs site as a static Caddy image. Build the site first (`pnpm build`); this only copies it in.
FROM caddy:2.11-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY build/client /srv
EXPOSE 8080
