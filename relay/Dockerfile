FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY src ./src
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
