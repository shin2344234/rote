FROM node:22-alpine
WORKDIR /app
COPY server.mjs ./
COPY src ./src
# Download and install totals live here. A new named volume copies this folder's owner, so node can write it.
RUN mkdir /data && chown node:node /data
USER node
ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.mjs"]
