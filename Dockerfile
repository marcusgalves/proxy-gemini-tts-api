# Estágio 1: Builder - Instala dependências
# Usamos uma imagem base que tem suporte a múltiplas arquiteturas (linux/amd64, linux/arm64)
FROM --platform=$BUILDPLATFORM node:18-alpine AS builder

WORKDIR /usr/src/app

# Copia package.json e package-lock.json (se existir)
COPY package*.json ./

# Instala as dependências de produção
RUN npm ci --only=production

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