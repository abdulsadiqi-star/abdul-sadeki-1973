# اجرای فروشگاه با Docker:
#   docker build -t kalano-shop .
#   docker run -d -p 3000:3000 --env-file .env -v kalano-data:/app/data kalano-shop
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 DATA_DIR=/app/data
COPY package.json ./
COPY server ./server
COPY public ./public
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
