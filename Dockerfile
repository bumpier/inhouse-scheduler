FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma
# devDependencies are needed to build; kept in the image for simplicity (prisma CLI for migrations)
RUN npm ci --include=dev

COPY . .
RUN npx prisma generate && npm run build && npm run worker:build

RUN mkdir -p /data/uploads
EXPOSE 3000
CMD ["npx", "next", "start", "-p", "3000"]
