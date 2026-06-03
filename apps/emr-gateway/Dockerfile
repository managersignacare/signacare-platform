FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY src/views/ ./dist/views/
EXPOSE 4002
CMD ["node", "dist/app.js"]
