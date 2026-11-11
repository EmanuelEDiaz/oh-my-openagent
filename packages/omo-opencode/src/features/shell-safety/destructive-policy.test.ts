/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import { destructiveFindings } from "./destructive-policy"

const files: Record<string, string> = {
  "/p/reset.sql": "-- reset\nDROP TABLE users;\n",
  "/p/seed.sql": "INSERT INTO users VALUES (1);\n",
  "/p/scripts/wipe.py": "cur.execute('DROP DATABASE app')\n",
  "/p/scripts/report.py": "cur.execute('SELECT * FROM users')\n",
}
const find = (command: string) => destructiveFindings(command, { directory: "/p", readFile: (path) => files[path] })
const risky = (command: string) => find(command).filter((finding) => !finding.test)

describe("destructive commands are found wherever they hide", () => {
  test.each([
    ["psql -c", "psql -U app -c 'DROP TABLE users'"],
    ["mysql -e", 'mysql -u root -e "TRUNCATE orders"'],
    ["sqlite3 positional SQL", "sqlite3 app.db 'DELETE FROM sessions'"],
    ["heredoc", "psql app <<'SQL'\nDROP SCHEMA public CASCADE;\nSQL"],
    ["here-string", "mysql app <<< 'DROP DATABASE shop'"],
    ["inside docker exec", "docker exec -it db psql -U postgres -c 'DROP DATABASE app'"],
    ["inside compose exec", "docker compose exec db mysql -e 'DROP USER bob'"],
    ["a .sql file the agent runs", "psql app -f reset.sql"],
    ["a script the agent runs", "python scripts/wipe.py"],
    ["inline python", `python -c "import db; db.run('DROP TABLE x')"`],
    ["UPDATE without WHERE", "psql -c 'UPDATE users SET admin = true'"],
    ["ALTER TABLE DROP", "psql -c 'ALTER TABLE users DROP COLUMN email'"],
    ["mongo dropDatabase", "mongosh app --eval 'db.dropDatabase()'"],
    ["redis FLUSHALL", "redis-cli FLUSHALL"],
    ["dropdb", "dropdb app"],
    ["sudo dropdb", "sudo -u postgres dropdb app"],
    ["prisma reset", "npx prisma migrate reset --force"],
    ["prisma force reset", "bunx prisma db push --force-reset"],
    ["laravel fresh", "php artisan migrate:fresh --seed"],
    ["laravel wipe", "php artisan db:wipe"],
    ["rails drop", "bin/rails db:drop"],
    ["django flush", "python manage.py flush --no-input"],
    ["typeorm drop", "npx typeorm schema:drop"],
    ["sequelize drop", "npx sequelize-cli db:drop"],
    ["docker volume rm", "docker volume rm pgdata"],
    ["docker volume prune", "docker volume prune -f"],
    ["docker system prune", "docker system prune -a --volumes"],
    ["compose down -v", "docker compose down -v"],
    ["old compose down --volumes", "docker-compose down --volumes"],
    ["rm -rf a data dir", "rm -rf ./data/postgres"],
    ["rm -rf a sqlite file", "rm -f app.sqlite3"],
    ["rm -rf home", "rm -rf ~"],
    ["uninstall postgres", "sudo apt-get purge -y postgresql-16"],
    ["brew uninstall mysql", "brew uninstall mysql"],
    ["git reset --hard", "git reset --hard HEAD~3"],
    ["git clean", "git clean -fdx"],
    ["git push --force", "git push --force origin main"],
    ["git checkout .", "git checkout -- ."],
    ["git branch -D", "git branch -D feature"],
    ["git stash clear", "git stash clear"],
    ["behind bash -c", "bash -c 'docker volume rm data'"],
    ["a real database dropped next to a test one", "psql -c 'DROP DATABASE IF EXISTS app_test; DROP DATABASE app'"],
    ["a table that looks like a test one, in a real database", "psql -d shop -c 'DROP TABLE test_results'"],
  ])("%s", (_name, command) => {
    expect(risky(command).length).toBeGreaterThan(0)
  })
})

describe("not destructive", () => {
  test.each([
    ["grep for SQL", "grep -rn 'DROP TABLE' migrations/"],
    ["commit message", "git commit -m 'drop table users from the docs'"],
    ["echo", "echo 'DELETE FROM x'"],
    ["select", "psql -c 'SELECT count(*) FROM users'"],
    ["delete with where", "psql -c \"DELETE FROM sessions WHERE expires < now()\""],
    ["update with where", "psql -c \"UPDATE users SET admin = false WHERE id = 3\""],
    ["a harmless .sql file", "psql app -f seed.sql"],
    ["a harmless script", "python scripts/report.py"],
    ["normal migrate", "php artisan migrate"],
    ["compose down without volumes", "docker compose down"],
    ["rm of build output", "rm -rf dist node_modules/.cache"],
    ["git push with lease", "git push --force-with-lease"],
    ["git reset soft", "git reset --soft HEAD~1"],
    ["git restore staged", "git restore --staged file.ts"],
    ["apt install", "sudo apt-get install -y postgresql-16"],
  ])("%s", (_name, command) => {
    expect(risky(command)).toEqual([])
  })
})

describe("clearly-test targets are allowed", () => {
  test.each([
    "psql app_test -c 'DROP TABLE users'",
    "dropdb shop_test",
    "psql -U postgres -c 'DROP DATABASE IF EXISTS app_test'",
    "sqlite3 :memory: 'DROP TABLE x'",
    "sqlite3 /tmp/scratch.db 'DROP TABLE x'",
    "php artisan migrate:fresh --env=testing",
    "RAILS_ENV=test bin/rails db:drop",
    "NODE_ENV=test npx prisma migrate reset --force",
  ])("%s", (command) => {
    const findings = find(command)
    expect(findings.length).toBeGreaterThan(0)
    expect(findings.every((finding) => finding.test)).toBe(true)
  })
})

describe("findings say what would be lost", () => {
  test("the finding names the operation and the command", () => {
    const [finding] = risky("docker exec db psql -c 'DROP DATABASE app'")
    expect(finding?.what).toContain("DROP DATABASE")
  })
})
