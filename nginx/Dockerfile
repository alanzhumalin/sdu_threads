FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY frontend/package*.json ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi
COPY frontend/ .
RUN npm run build

FROM nginx:1.25-alpine
WORKDIR /usr/share/nginx/html
RUN apk add --no-cache openssl
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY nginx/99-gen-cert.sh /docker-entrypoint.d/99-gen-cert.sh
RUN chmod +x /docker-entrypoint.d/99-gen-cert.sh
COPY --from=frontend-build /app/dist /usr/share/nginx/html
EXPOSE 80 443
