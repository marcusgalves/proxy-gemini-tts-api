# Estágio 1: Builder - Instala dependências
# Remove o --platform=$BUILDPLATFORM para permitir build nativo para cada arquitetura
FROM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copia package.json e também o package-lock.json se ele existir
COPY package*.json ./

# Instala as dependências
RUN npm install --only=production

# Estágio 2: Final - Cria a imagem final otimizada
FROM node:18-alpine

# Define o autor da imagem
LABEL author="Gemini"

WORKDIR /usr/src/app

# Copia as dependências instaladas do estágio builder
COPY --from=builder /usr/src/app/node_modules ./node_modules

# Copia o código da aplicação
COPY index.js .
COPY package.json .

# Expõe a porta que a aplicação vai rodar
EXPOSE 8698

# Comando para iniciar a aplicação
CMD [ "node", "index.js" ]