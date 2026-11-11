/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { captureCredentials } from "./capture"

const values = (text: string, origin = "command") => captureCredentials(text, origin).map((entry) => `${entry.name}=${entry.value}`)

describe("passwords the agent sets are captured", () => {
  test.each([
    ["postgres CREATE USER", "psql -c \"CREATE USER app WITH PASSWORD 's3cret-app'\"", "postgres-user-app=s3cret-app"],
    ["postgres CREATE ROLE", "CREATE ROLE reporter LOGIN PASSWORD 'rep0rt!'", "postgres-user-reporter=rep0rt!"],
    ["postgres ALTER USER", "ALTER USER app WITH PASSWORD 'n3w-pass'", "postgres-user-app=n3w-pass"],
    ["mysql IDENTIFIED BY", "CREATE USER 'shop'@'%' IDENTIFIED BY 'sh0p-pw';", "mysql-user-shop=sh0p-pw"],
    ["mysql ALTER USER", "ALTER USER 'root'@'localhost' IDENTIFIED BY \"r00t-pw\"", "mysql-user-root=r00t-pw"],
    ["docker -e POSTGRES_PASSWORD", "docker run -d -e POSTGRES_PASSWORD=pg-dev-123 postgres:16", "postgres-POSTGRES_PASSWORD=pg-dev-123"],
    ["MYSQL_ROOT_PASSWORD", "docker run -e MYSQL_ROOT_PASSWORD='my root' mysql", "mysql-MYSQL_ROOT_PASSWORD=my root"],
    ["connection URL", "DATABASE_URL=postgresql://app:url-pass@localhost:5432/app bun run migrate", "postgres-url-app@localhost/app=url-pass"],
    ["redis URL", "redis-cli -u redis://:r3dis@127.0.0.1:6379", "redis-url-default@127.0.0.1=r3dis"],
    ["htpasswd", "htpasswd -bc .htpasswd admin adm1n-pw", "htpasswd-admin=adm1n-pw"],
  ])("%s", (_name, text, expected) => {
    expect(values(text)).toContain(expected)
  })

  test("a .env file the agent wrote", () => {
    const entries = captureCredentials("APP_NAME=shop\nDB_USERNAME=shop\nDB_PASSWORD=env-pass-1\n# REDIS_PASSWORD=old\n", ".env")
    expect(entries.map((entry) => `${entry.name}=${entry.value}@${entry.origin}`)).toEqual(["DB_PASSWORD=env-pass-1@.env:3"])
  })

  test("a compose file the agent wrote, both list and map styles", () => {
    const compose = "services:\n  db:\n    image: postgres:16\n    environment:\n      POSTGRES_PASSWORD: compose-pw\n  cache:\n    environment:\n      - REDIS_PASSWORD=redis-pw\n"
    expect(values(compose, "docker-compose.yml")).toEqual(["postgres-POSTGRES_PASSWORD=compose-pw", "redis-REDIS_PASSWORD=redis-pw"])
  })
})

describe("placeholders and references are not passwords", () => {
  test.each([
    "POSTGRES_PASSWORD=$PG_PASS",
    "POSTGRES_PASSWORD=${PG_PASS}",
    "DB_PASSWORD=${OMO_SECRET:db}",
    "CREATE USER app WITH PASSWORD '<password>'",
    "DATABASE_URL=postgres://app:${DB_PASS}@localhost/app",
    "DB_PASSWORD=",
    "DB_PASSWORD=***",
    "echo 'set POSTGRES_PASSWORD in your .env'",
  ])("%s", (text) => {
    expect(captureCredentials(text, "command")).toEqual([])
  })
})
