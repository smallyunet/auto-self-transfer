FROM node:20-alpine

WORKDIR /app
COPY package.json ./ 
RUN npm install --omit=dev

COPY app.js ./

# Reduce image size and improve security
USER node
CMD ["node", "app.js"]
