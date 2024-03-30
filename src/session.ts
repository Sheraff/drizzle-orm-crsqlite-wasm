import { entityKind } from "drizzle-orm/entity"
import type { Logger } from "drizzle-orm/logger"
import { NoopLogger } from "drizzle-orm/logger"
import type { RelationalSchemaConfig, TablesRelationalConfig } from "drizzle-orm/relations"
import { fillPlaceholders, type Query } from "drizzle-orm/sql/sql"
import type { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core/dialect"
import { SQLiteTransaction } from "drizzle-orm/sqlite-core"
import type { SelectedFieldsOrdered } from "drizzle-orm/sqlite-core/query-builders/select.types"
import type { PreparedQueryConfig, SQLiteExecuteMethod } from "drizzle-orm/sqlite-core/session"
import { SQLitePreparedQuery, SQLiteSession } from "drizzle-orm/sqlite-core/session"
import type { DBAsync, StmtAsync, TXAsync } from "@vlcn.io/xplat-api"

interface CRSQLiteSessionOptions {
	logger?: Logger
}

export class CRSQLiteSession<
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig,
> extends SQLiteSession<"async", void, TFullSchema, TSchema> {
	static readonly [entityKind]: string = "CRSQLiteSession"

	private logger: Logger

	constructor(
		private client: DBAsync,
		private dialect: SQLiteAsyncDialect,
		private schema: RelationalSchemaConfig<TSchema> | undefined,
		private options: CRSQLiteSessionOptions,
		private tx?: TXAsync | undefined
	) {
		super(dialect)
		this.logger = options.logger ?? new NoopLogger()
	}

	prepareQuery<T extends PreparedQueryConfig>(
		query: Query,
		fields: SelectedFieldsOrdered | undefined,
		executeMethod: SQLiteExecuteMethod,
		_isResponseInArrayMode: boolean,
		customResultMapper?: (rows: unknown[][]) => unknown
	): CRSQLitePreparedQuery<T> {
		return new CRSQLitePreparedQuery(
			this.client,
			query,
			false,
			this.logger,
			fields,
			this.tx ?? null,
			executeMethod,
			customResultMapper
		)
	}

	prepareOneTimeQuery(
		query: Query,
		fields: SelectedFieldsOrdered | undefined,
		executeMethod: SQLiteExecuteMethod,
		_isResponseInArrayMode: boolean
	): SQLitePreparedQuery<PreparedQueryConfig & { type: "async" }> {
		return new CRSQLitePreparedQuery(
			this.client,
			query,
			true,
			this.logger,
			fields,
			this.tx ?? null,
			executeMethod
		)
	}

	override async transaction<T>(
		transaction: (db: CRSQLiteTransaction<TFullSchema, TSchema>) => Promise<T>
		// _config?: SQLiteTransactionConfig
	): Promise<T> {
		const [release, imperativeTx] = await this.client.imperativeTx()
		const session = new CRSQLiteSession(
			this.client,
			this.dialect,
			this.schema,
			this.options,
			imperativeTx
		)
		const tx = new CRSQLiteTransaction("async", this.dialect, session, this.schema)
		try {
			const result = await tx.transaction(transaction)
			release()
			return result
		} catch (err) {
			release()
			throw err
		}
	}

	exec(query: string) {
		this.logger.logQuery(query, [])
		return (this.tx ?? this.client).exec(query)
	}

	// TODO: can we implement these methods without going through a prepared query? (they are called when doing "one time queries")
	// run(query: SQL) {
	// 	return this.client.run(query)
	// }
	// all<T = unknown>(query: SQL<unknown>): Promise<T[]> {
	// 	return this.client.all(query)
	// }
	// get<T = unknown>(query: SQL<unknown>): Promise<T> {
	// 	return this.client.get(query)
	// }
	// values<T extends any[] = unknown[]>(query: SQL<unknown>): Promise<T[]> {
	// 	return this.client.values(query)
	// }
}

// TODO: this interface augmentation doesn't work, why? we do get a `SQLitePreparedQuery` when calling `.prepare()` but it doesn't have the `finalize` method at the type level
declare module "drizzle-orm/session" {
	interface PreparedQuery {
		finalize(): Promise<void>
	}
}

export class CRSQLitePreparedQuery<
	T extends PreparedQueryConfig = PreparedQueryConfig,
> extends SQLitePreparedQuery<{
	type: "async"
	run: void
	all: T["all"]
	get: T["get"]
	values: T["values"]
	execute: T["execute"]
}> {
	static readonly [entityKind]: string = "CRSQLitePreparedQuery"

	private stmt: Promise<StmtAsync>

	constructor(
		private client: DBAsync,
		query: Query,
		private oneTime: boolean,
		private logger: Logger,
		fields: SelectedFieldsOrdered | undefined,
		private tx: TXAsync | null,
		executeMethod: SQLiteExecuteMethod,
		private customResultMapper?: (rows: unknown[][]) => unknown
	) {
		super("async", executeMethod, query)
		this.stmt = (this.tx ?? this.client).prepare(query.sql)
	}

	/**
	 * execute query, no result expected
	 */
	async run(placeholderValues?: Record<string, unknown>): Promise<void> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {})
		this.logger.logQuery(this.query.sql, params)
		const stmt = await this.stmt
		await stmt.run(this.tx, ...params)
		if (this.oneTime) {
			void stmt.finalize(this.tx)
		}
	}

	/**
	 * execute query and return all rows
	 */
	async all(placeholderValues?: Record<string, unknown>): Promise<unknown[]> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {})
		this.logger.logQuery(this.query.sql, params)
		const stmt = await this.stmt
		stmt.raw(Boolean(this.customResultMapper))
		const rows = await stmt.all(this.tx, ...params)
		if (this.oneTime) {
			void stmt.finalize(this.tx)
		}
		return this.customResultMapper ? (this.customResultMapper(rows) as unknown[]) : rows
	}

	/**
	 * only query first row
	 */
	async get(placeholderValues?: Record<string, unknown>): Promise<unknown | undefined> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {})
		this.logger.logQuery(this.query.sql, params)
		const stmt = await this.stmt
		stmt.raw(Boolean(this.customResultMapper))
		const row = await stmt.get(this.tx, ...params)
		if (this.oneTime) {
			void stmt.finalize(this.tx)
		}
		return this.customResultMapper ? this.customResultMapper([row]) : row
	}

	/**
	 * directly extract first column value from each row
	 */
	async values(placeholderValues?: Record<string, unknown>): Promise<unknown[]> {
		const params = fillPlaceholders(this.query.params, placeholderValues ?? {})
		this.logger.logQuery(this.query.sql, params)
		const stmt = await this.stmt
		stmt.raw(true)
		const rows = (await stmt.all(null, ...params)) as unknown[][]
		if (this.oneTime) {
			void stmt.finalize(this.tx)
		}
		return rows.map((row) => row[0])
	}

	async finalize(): Promise<void> {
		if (this.oneTime) {
			throw new Error("Cannot finalize one-time query")
		}
		const stmt = await this.stmt
		await stmt.finalize(this.tx)
	}
}

export class CRSQLiteTransaction<
	TFullSchema extends Record<string, unknown>,
	TSchema extends TablesRelationalConfig,
> extends SQLiteTransaction<"async", void, TFullSchema, TSchema> {
	static readonly [entityKind]: string = "CRSQLiteTransaction"

	override async transaction<T>(
		transaction: (tx: CRSQLiteTransaction<TFullSchema, TSchema>) => Promise<T>
	): Promise<T> {
		const savepointName = `sp${this.nestedIndex}`
		const tx = new CRSQLiteTransaction(
			"async",
			// @ts-expect-error -- it does exist, but we have to add a constructor for TS to recognize it
			this.dialect,
			// @ts-expect-error -- it does exist, but we have to add a constructor for TS to recognize it
			this.session,
			this.schema,
			this.nestedIndex + 1
		)
		// @ts-expect-error -- it does exist, but we have to add a constructor for TS to recognize it
		await this.session.exec(`SAVEPOINT ${savepointName};`)
		try {
			const result = await transaction(tx)
			// @ts-expect-error -- it does exist, but we have to add a constructor for TS to recognize it
			await this.session.exec(`RELEASE savepoint ${savepointName};`)
			return result
		} catch (err) {
			// @ts-expect-error -- it does exist, but we have to add a constructor for TS to recognize it
			await this.session.exec(`ROLLBACK TO savepoint ${savepointName};`)
			throw err
		}
	}
}
