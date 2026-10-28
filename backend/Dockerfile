FROM golang:1.26-bookworm AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -trimpath -o /out/api ./cmd/api && \
    CGO_ENABLED=0 go build -trimpath -o /out/migrate ./cmd/migrate

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget && \
    rm -rf /var/lib/apt/lists/* && \
    useradd --system --uid 10001 --create-home app && \
    mkdir -p /var/lib/nir/media && chown -R app:app /var/lib/nir
COPY --from=build /out/ /app/
USER app
WORKDIR /app
EXPOSE 8081
CMD ["/app/api"]
