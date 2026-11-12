FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY . .
RUN go mod tidy
RUN CGO_ENABLED=0 go build -o /out/gqa-api .

FROM alpine:3.21
RUN adduser -D -u 10001 gqa
COPY --from=build /out/gqa-api /usr/local/bin/gqa-api
USER gqa
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/gqa-api"]
