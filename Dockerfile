FROM node:20-alpine

WORKDIR /app
COPY package.json ./ 
RUN npm install --omit=dev

COPY app.js ./

# 缩小镜像体积，提升安全性
USER node
CMD ["node", "app.js"]
