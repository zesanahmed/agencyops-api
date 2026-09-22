import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });

type ExtractTransactionClient<T> = T extends {
  $transaction<R>(
    fn: (tx: infer TX) => Promise<R>,
    options?: unknown,
  ): Promise<R>;
}
  ? TX
  : never;

export type PrismaTransactionClient = ExtractTransactionClient<PrismaClient>;
