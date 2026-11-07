FROM node:22-bookworm-slim

WORKDIR /app

RUN groupadd --system --gid 1001 panbooru \
	&& useradd --system --uid 1001 --gid panbooru --home-dir /app --shell /usr/sbin/nologin panbooru

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build && chown -R panbooru:panbooru /app

USER panbooru

ENV NODE_ENV=production
ENV HOST=127.0.0.1
ENV PORT=3000
ENV PANBOORU_DATA_DIR=/data
ENV PANBOORU_SECRET_PATH=/run/panbooru-secrets/master.key

EXPOSE 3000

CMD ["node", "build"]
