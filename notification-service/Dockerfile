FROM node:18-alpine AS base
WORKDIR /usr/src/app
COPY package*.json ./

FROM base AS development
ENV NODE_ENV=development
RUN npm install
COPY . .
EXPOSE 3002
CMD ["npm", "run", "dev"]

FROM base AS builder
ENV NODE_ENV=production
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:18-alpine AS production
ENV NODE_ENV=production
WORKDIR /usr/src/app
COPY --from=builder /usr/src/app/node_modules ./node_modules
COPY --from=builder /usr/src/app/package*.json ./
COPY --from=builder /usr/src/app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/server.js"] 