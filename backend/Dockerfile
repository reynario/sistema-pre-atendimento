FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
RUN npx prisma generate
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=America/Sao_Paulo
COPY package*.json ./
RUN npm ci --omit=dev
COPY prisma ./prisma
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3333
# db push sincroniza o schema no start (aditivo). Se um dia uma mudança for
# destrutiva, ele se recusa e loga — aí a alteração deve ser feita manualmente.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/index.js"]
