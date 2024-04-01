> [!TIP]
> The goal of this package is to get merged into the official `drizzle-orm` package. In the meantime it provides a way to use `crsqlite-wasm` as the underlying database engine for `drizzle`.

# What is this?

This package is an adapter for `drizzle` to use `crsqlite-wasm` as the underlying database engine. It is meant to work in the browser (uses web crypto for hashing). It is similar to the other adapters you might find in the official `drizzle-orm` package (like `drizzle-orm/libsql` or `drizzle-orm/better-sqlite3`).

# Quick start

```shell
npm i drizzle-orm-crsqlite-wasm
```

```ts
import { initWasm } from "@vlcn.io/crsqlite-wasm"
import * as schema from "my-regular-drizzle-schema.ts"
import { drizzle } from "drizzle-orm-crsqlite-wasm"

const sqlite = await initWasm()
const sql = await sqlite.open("test")
const db = drizzle(sql)
const countries = await db.select().from(schema.countries).all()
```

# How to use it?

1. export all migrations from the drizzle migrations folder (following example uses `Vite`)

   ```ts
   // <drizzle-migrations>/index.ts
   export const migrations = Object.fromEntries(
   	Object.entries(
   		import.meta.glob("./*.sql", {
   			eager: true,
   			query: "?raw",
   			import: "default",
   		})
   	).map(([key, value]) => [key.slice(2, -4), value])
   )
   ```

2. create browser equivalent of node's `crypto.createHash("sha256")`

   ```ts
   // <drizzle-migrations>/hash.ts
   async function createSha256Hash(query: string) {
   	const encoder = new TextEncoder()
   	const data = encoder.encode(query)
   	const hash = await globalThis.crypto.subtle.digest("SHA-256", data)
   	const hashArray = Array.from(new Uint8Array(hash))
   	const hashHex = hashArray
   		.map((b) => b.toString(16).padStart(2, "0"))
   		.join("")
   	return hashHex
   }
   ```

3. process all migration data into a format useable by `drizzle`

   ```ts
   import migrationJournal from "<drizzle-migrations>/meta/_journal.json"
   import { migrations } from "<drizzle-migrations>/index.ts"
   import { createSha256Hash } from "<drizzle-migrations>/hash.ts"

   function getMigrations() {
   	const journal = migrationJournal as {
   		entries: Array<{
   			idx: number
   			when: number
   			tag: string
   			breakpoints: boolean
   		}>
   	}
   	const migrationQueries: MigrationMeta[] = []
   	for (const journalEntry of journal.entries) {
   		const query = migrations[journalEntry.tag as keyof typeof migrations]
   		const result = query.split("--> statement-breakpoint")
   		migrationQueries.push({
   			sql: result,
   			bps: journalEntry.breakpoints,
   			folderMillis: journalEntry.when,
   			hash: await createSha256Hash(query),
   		})
   	}
   	return migrationQueries
   }
   ```

4. create a `drizzle` instance and run the migrations

   ```ts
   import { initWasm } from "@vlcn.io/crsqlite-wasm"
   import * as schema from "my-regular-drizzle-schema.ts"
   import { drizzle } from "drizzle-orm-crsqlite-wasm"
   import { migrate } from "drizzle-orm-crsqlite-wasm/migrator"

   const sqlite = await initWasm()
   const sql = await sqlite.open()
   const db = drizzle(sql, { schema, logger: true })
   await migrate(db, { migrations: await getMigrations() })
   ```

5. use as a regular `drizzle` instance

   ```ts
   const [country] = await db
   	.select()
   	.from(schema.countries)
   	.where(eq(schema.countries.name, "Peru"))
   ```
