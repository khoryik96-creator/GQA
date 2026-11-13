FROM golang:1.27.4-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download && go mod verify
COPY . .
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/gqa-api .

FROM alpine:3.24
RUN adduser -D -u 10001 gqa && mkdir -p /evidence && chown gqa:gqa /evidence
COPY --from=build /out/gqa-api /usr/local/bin/gqa-api
USER gqa
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gqa-api"]
