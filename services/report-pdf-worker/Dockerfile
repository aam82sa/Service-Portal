# Playwright's image already carries a matching Chromium + all its system libs.
FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# Arabic script fonts so correspondence-quality PDFs render RTL text correctly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-noto-core \
  && (apt-get install -y --no-install-recommends fonts-inter fonts-jetbrains-mono || true) \
  && rm -rf /var/lib/apt/lists/*

COPY package.json ./
RUN npm install

COPY tsconfig.json server.ts template.ts ./
RUN npx tsc -p tsconfig.json

ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "dist/server.js"]
