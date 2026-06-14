
# ── Stage 1: Build ───────────────────────────────────────────────────────────
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build

WORKDIR /src
COPY . .
RUN dotnet restore
RUN dotnet publish -c Release -o /app/publish -r linux-x64 --self-contained true

# ── Stage 2: Runtime (Playwright image) ──────────────────────────────────────
FROM mcr.microsoft.com/playwright/dotnet:v1.60.0-noble AS final

WORKDIR /app
COPY --from=build /app/publish .

# Set ASP.NET Core environment
ENV ASPNETCORE_ENVIRONMENT=Production

# Connection string is injected at runtime via DATABASE_URL environment variable.
# Set it when running the container
# Example:
#   docker run -e DATABASE_URL="Host=...;Database=...;Username=...;Password=...;SSL Mode=VerifyFull;Channel Binding=Require;" ...

ENTRYPOINT ["dotnet", "backend.dll"]
