# 1. Fase de Build (Acompanhando o seu ambiente com .NET 10)
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app/publish -r linux-x64 --self-contained true

# 2. Fase de Execução (Imagem do Playwright mais recente)
FROM mcr.microsoft.com/playwright/dotnet:jammy AS final
WORKDIR /app
COPY --from=build /app/publish .

# Define que o app deve rodar no ambiente de Produção
ENV ASPNETCORE_ENVIRONMENT=Production

# O comando que liga o servidor
ENTRYPOINT ["dotnet", "backend.dll"]
