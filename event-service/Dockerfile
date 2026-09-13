FROM node:18-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS builder
RUN npm ci
COPY . .
RUN npm run build

FROM node:18-alpine AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/package*.json ./
RUN npm ci --only=production
COPY --from=builder /usr/src/app/dist ./dist
EXPOSE 3011
CMD ["node", "dist/server.js"]
