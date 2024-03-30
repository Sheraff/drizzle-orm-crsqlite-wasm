import type { MigrationMeta } from "drizzle-orm/migrator"
import type { CRSQLiteDatabase } from "./driver.js"
import { sql, type TablesRelationalConfig } from "drizzle-orm"
import type { SQLiteSession } from "drizzle-orm/sqlite-core"

type MigrationConfig = {
	/** @default "__drizzle_migrations" */
	migrationsTable?: string
	migrations: MigrationMeta[]
}

export async function migrate<TSchema extends Record<string, unknown>>(
	db: CRSQLiteDatabase<TSchema>,
	config: MigrationConfig = { migrations: [] }
) {
	const migrations = config.migrations
	const migrationsTable = config.migrationsTable ?? "__drizzle_migrations"
	const migrationTableIdent = sql.identifier(migrationsTable)
	const migrationTableCreate = sql`
		CREATE TABLE IF NOT EXISTS ${migrationTableIdent} (
			id TEXT NOT NULL PRIMARY KEY,
			hash text NOT NULL,
			created_at INTEGER
		)
	`

	// @ts-expect-error -- `session` exists but is marked as `@internal` on the type level
	await (db.session as SQLiteSession<"async", void, TSchema, TablesRelationalConfig>).run(
		migrationTableCreate
	)
	type MigrationEntry = { id: string; hash: string; created_at: number }

	const dbMigrations = await db.get<MigrationEntry | null>(
		sql`SELECT id, hash, created_at FROM ${migrationTableIdent} ORDER BY created_at DESC LIMIT 1`
	)

	const lastDbMigration = dbMigrations ?? undefined

	for (const migration of migrations) {
		if (!lastDbMigration || lastDbMigration.created_at < migration.folderMillis) {
			for (const stmt of migration.sql) {
				await db.run(sql.raw(stmt))
			}

			await db.run(
				sql`INSERT INTO ${migrationTableIdent} ("id", "hash", "created_at") VALUES(${crypto.randomUUID()}, ${migration.hash}, ${migration.folderMillis})`
			)
		}
	}
}
