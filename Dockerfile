# Estágio de Build
FROM node:18-alpine as builder

WORKDIR /app

# Argumentos de build para injetar variáveis de ambiente do Vite
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY

ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

COPY package*.json ./
RUN npm install

COPY . .

# Build do projeto Vite
RUN npm run build

# Estágio de Produção com Nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# Configuração customizada do Nginx para SPA (opcional, mas recomendada para React Router)
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
