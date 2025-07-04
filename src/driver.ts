import { DefaultLogger } from "drizzle-orm/logger"
import {
	createTableRelationsHelpers,
	extractTablesRelationalConfig,
	type RelationalSchemaConfig,
	type TablesRelationalConfig,
} from "drizzle-orm/relations"
import { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core"
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core"
import type { DrizzleConfig } from "drizzle-orm/utils"
import { CRSQLiteSession } from "./session.js"
import type { DBAsync } from "@vlcn.io/xplat-api"

export type CRSQLiteDatabase<TSchema extends Record<string, unknown> = Record<string, never>> =
	BaseSQLiteDatabase<"async", void, TSchema>

export function drizzle<TSchema extends Record<string, unknown> = Record<string, never>>(
	client: DBAsync,
	config?: DrizzleConfig<TSchema>
): CRSQLiteDatabase<TSchema> {
	const dialect = new SQLiteAsyncDialect({ casing: config?.casing })
	let logger
	if (config?.logger === true) {
		logger = new DefaultLogger()
	} else if (config?.logger !== false) {
		logger = config?.logger
	}

	let schema: RelationalSchemaConfig<TablesRelationalConfig> | undefined
	if (config?.schema) {
		const tablesConfig = extractTablesRelationalConfig(
			config.schema,
			createTableRelationsHelpers
		)
		schema = {
			fullSchema: config.schema,
			schema: tablesConfig.tables,
			tableNamesMap: tablesConfig.tableNamesMap,
		}
	}

	const session = new CRSQLiteSession(client, dialect, schema, { logger })

	return new BaseSQLiteDatabase("async", dialect, session, schema) as CRSQLiteDatabase<TSchema>
}
