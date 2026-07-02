# API Node — imagen ligera
FROM node:20-alpine

WORKDIR /app

# instala dependencias primero (mejor cacheo de capas)
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

# copia el resto del código
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "src/index.js"]
