FROM mcr.microsoft.com/playwright:v1.64.1-noble
WORKDIR /worker
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY index.cjs ./index.cjs
COPY policy.cjs ./policy.cjs
COPY browser-flow.cjs ./browser-flow.cjs
COPY repair-hints.cjs ./repair-hints.cjs
USER pwuser
ENV PORT=8090
EXPOSE 8090
CMD ["node", "index.cjs"]
