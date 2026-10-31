FROM node:20.19.5-alpine AS build
WORKDIR /app
RUN npm install --global pnpm@10.11.0
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY apps/client/package.json apps/client/package.json
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM build AS server
ENV NODE_ENV=production
EXPOSE 3000
USER node
CMD ["node", "apps/server/dist/apps/server/src/index.js"]

FROM nginx:1.28-alpine AS client
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/client/dist /usr/share/nginx/html
EXPOSE 5173
