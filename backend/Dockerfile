# 1. Fase de Build (Usa o SDK do .NET para compilar)
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app/publish

# 2. Fase de Execução (Usa a imagem oficial do Playwright com o Linux Jammy e .NET 8)
FROM mcr.microsoft.com/playwright/dotnet:1.42.0-jammy AS final
WORKDIR /app
COPY --from=build /app/publish .

# Define que o app deve rodar no ambiente de Produção
ENV ASPNETCORE_ENVIRONMENT=Production

# O comando que liga o servidor
ENTRYPOINT ["dotnet", "backend.dll"]
